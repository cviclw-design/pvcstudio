import { DEFAULT_EXCISE_DUTY_PCT } from '../data/initialData';
import {
  CifAuditBreakdown,
  ComponentAuditBreakdown,
  CurrencyCode,
  DeemedGroupPoComparisonEntry,
  DeemedPvcPoGroup,
  DpHistoryEntry,
  ForeignCurrencyCode,
  ItemMonthlyIndicesMap,
  MonthlyIndexEntry,
  PLItem,
  POMilestone,
  ScenarioEvaluation,
  ScrutinyReportResult,
  ScrutinyTransactionInput,
  TimeLagRule,
} from '../types/pvc';

let reportIdCounter = 0;

export function resolveCurrencyExchangeRate(
  entry: MonthlyIndexEntry | undefined,
  currency: CurrencyCode,
  fallback = 1.0
): number {
  if (currency === 'INR') return 1.0;
  const fromMap = entry?.exchangeRates?.[currency as ForeignCurrencyCode];
  if (typeof fromMap === 'number' && Number.isFinite(fromMap) && fromMap > 0) {
    return fromMap;
  }
  if (typeof entry?.exchangeRate === 'number' && Number.isFinite(entry.exchangeRate) && entry.exchangeRate > 0) {
    return entry.exchangeRate;
  }
  return fallback;
}

export function formatINR(amount: number, decimals = 2): string {
  if (!Number.isFinite(amount)) return '₹0.00';
  const sign = amount < 0 ? '-' : '';
  const absVal = Math.abs(amount);
  return `${sign}₹${absVal.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function getPoKey(poNo: string, poSr: string): string {
  return `${poNo}___${poSr}`;
}

export function computeLandedUnitRate(rate: number, freight: number, gstPct: number): number {
  const safeRate = Number.isFinite(rate) ? rate : 0;
  const safeFreight = Number.isFinite(freight) && freight >= 0 ? freight : 0;
  const safeGst = Number.isFinite(gstPct) && gstPct >= 0 ? gstPct : 0;
  return Number(((safeRate + safeFreight) * (1 + safeGst / 100)).toFixed(2));
}

export function getLagMonths(rule: TimeLagRule): number {
  switch (rule) {
    case 'M-0':
      return 0;
    case 'M-1':
      return 1;
    case 'M-2':
      return 2;
    case 'M-3':
      return 3;
    case 'M-4':
      return 4;
    default:
      return 2;
  }
}

export function computeTargetLagMonth(monthStr: string, timelagRule: TimeLagRule): string {
  const parts = monthStr.split('-').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return monthStr;
  }
  let [year, month] = parts;
  const lag = getLagMonths(timelagRule);
  month -= lag;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  const mStr = month < 10 ? `0${month}` : `${month}`;
  return `${year}-${mStr}`;
}

export function resolveLaggedMonthForComponent(
  pl: string,
  monthStr: string,
  timelagRule: TimeLagRule,
  itemMonthlyIndices: ItemMonthlyIndicesMap
): { resolvedMonth: string; exactMatch: boolean; targetMonth: string } {
  const targetMonth = computeTargetLagMonth(monthStr, timelagRule);
  const indicesMap = itemMonthlyIndices[pl] || {};

  if (indicesMap[targetMonth]) {
    return { resolvedMonth: targetMonth, exactMatch: true, targetMonth };
  }

  const sortedMonths = Object.keys(indicesMap).sort();
  if (sortedMonths.length === 0) {
    return { resolvedMonth: targetMonth, exactMatch: false, targetMonth };
  }

  const preceding = sortedMonths.filter((m) => m <= targetMonth);
  if (preceding.length > 0) {
    return {
      resolvedMonth: preceding[preceding.length - 1],
      exactMatch: false,
      targetMonth,
    };
  }

  return {
    resolvedMonth: sortedMonths[0],
    exactMatch: false,
    targetMonth,
  };
}

function parseNumericField(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export interface DynamicPvcOptions {
  cifValue?: number;
  cifCurrency?: CurrencyCode;
  cifLagRule?: TimeLagRule;
}

/**
 * Calculates split PVC:
 * 1. Indigenous Basic Rate Excl. CIF = (baseRate - cifValue) * Σ(W_i * I1_i / I0_i)
 * 2. CIF Value PVC = cifValue * (ER1 / ER0) * ((1 + ED1/100) / (1 + ED0/100)) using cifLagRule
 * 3. Final PVC Rate = Indigenous PVC Rate + CIF PVC Rate
 */
export function calculateDynamicPVC(
  baseMonth: string,
  evalMonth: string,
  item: PLItem,
  baseRate: number,
  itemMonthlyIndices: ItemMonthlyIndicesMap,
  options: DynamicPvcOptions = {}
): {
  pvSum: number;
  indigenousPvFactor: number;
  calculatedRate: number;
  variationPerUnit: number;
  variationPct: number;
  componentBreakdown: ComponentAuditBreakdown[];
  cifBreakdown: CifAuditBreakdown;
} {
  const safeBaseRate = Number.isFinite(baseRate) && baseRate > 0 ? baseRate : 0;
  const rawCif = options.cifValue ?? 0;
  const safeCifValue = Math.min(
    safeBaseRate,
    Number.isFinite(rawCif) && rawCif > 0 ? rawCif : 0
  );
  const indigenousBaseRate = Number((safeBaseRate - safeCifValue).toFixed(2));
  const cifCurrency: CurrencyCode = options.cifCurrency || 'USD';
  const cifLagRule: TimeLagRule = options.cifLagRule || 'M-1';

  let indigenousPvFactor = 0;
  const componentBreakdown: ComponentAuditBreakdown[] = [];
  const indicesMap = itemMonthlyIndices[item.pl] || {};

  item.components.forEach((c) => {
    const baseLookup = resolveLaggedMonthForComponent(
      item.pl,
      baseMonth,
      c.timelag,
      itemMonthlyIndices
    );
    const evalLookup = resolveLaggedMonthForComponent(
      item.pl,
      evalMonth,
      c.timelag,
      itemMonthlyIndices
    );

    const bMonthObj = indicesMap[baseLookup.resolvedMonth] || {};
    const eMonthObj = indicesMap[evalLookup.resolvedMonth] || {};

    const baseIdxVal = parseNumericField(bMonthObj[c.name], 100.0);
    const evalIdxVal = parseNumericField(eMonthObj[c.name], baseIdxVal);

    const isFixed = c.timelag === 'M-0' || c.name.toLowerCase().includes('fixed');
    const ratio = isFixed ? 1.0 : baseIdxVal !== 0 ? evalIdxVal / baseIdxVal : 1.0;
    const weightedRatio = c.weight * ratio;
    indigenousPvFactor += weightedRatio;

    componentBreakdown.push({
      name: c.name,
      weight: c.weight,
      timelag: c.timelag,
      lagBase: baseLookup.resolvedMonth,
      lagEval: evalLookup.resolvedMonth,
      baseIdxVal,
      evalIdxVal,
      exactBaseFound: baseLookup.exactMatch || isFixed,
      exactEvalFound: evalLookup.exactMatch || isFixed,
      ratio,
      weightedRatio,
    });
  });

  if (item.components.length === 0) {
    indigenousPvFactor = 1.0;
  }

  // Part 1: Indigenous Basic Rate excluding CIF
  const indigenousCalculatedRate = Number(
    (indigenousBaseRate * indigenousPvFactor).toFixed(2)
  );
  const indigenousVariation = Number(
    (indigenousCalculatedRate - indigenousBaseRate).toFixed(2)
  );

  // Part 2: CIF PVC using Exchange Rate & Rate of Duty (with CIF Lag Rule)
  const cifBaseLookup = resolveLaggedMonthForComponent(
    item.pl,
    baseMonth,
    cifLagRule,
    itemMonthlyIndices
  );
  const cifEvalLookup = resolveLaggedMonthForComponent(
    item.pl,
    evalMonth,
    cifLagRule,
    itemMonthlyIndices
  );
  const cifBaseObj = indicesMap[cifBaseLookup.resolvedMonth] || {};
  const cifEvalObj = indicesMap[cifEvalLookup.resolvedMonth] || {};

  const baseExchangeRate = resolveCurrencyExchangeRate(cifBaseObj, cifCurrency, 1.0);
  const evalExchangeRate = resolveCurrencyExchangeRate(
    cifEvalObj,
    cifCurrency,
    baseExchangeRate
  );
  const baseExciseDutyPct = parseNumericField(
    cifBaseObj.exciseDutyPct,
    DEFAULT_EXCISE_DUTY_PCT
  );
  const evalExciseDutyPct = parseNumericField(
    cifEvalObj.exciseDutyPct,
    baseExciseDutyPct
  );

  const erRatio =
    safeCifValue > 0 && baseExchangeRate > 0 ? evalExchangeRate / baseExchangeRate : 1.0;
  const edDenominator = 1 + baseExciseDutyPct / 100;
  const edRatio =
    safeCifValue > 0 && edDenominator > 0
      ? (1 + evalExciseDutyPct / 100) / edDenominator
      : 1.0;
  const cifFactor = erRatio * edRatio;

  const cifCalculatedRate =
    safeCifValue > 0 ? Number((safeCifValue * cifFactor).toFixed(2)) : 0;
  const cifVariation = Number((cifCalculatedRate - safeCifValue).toFixed(2));

  // Part 3: Final PVC Rate = Sum of Indigenous PVC + CIF PVC
  const calculatedRate = Number((indigenousCalculatedRate + cifCalculatedRate).toFixed(2));
  const variationPerUnit = Number((calculatedRate - safeBaseRate).toFixed(2));
  const pvSum = safeBaseRate > 0 ? calculatedRate / safeBaseRate : indigenousPvFactor;
  const variationPct =
    safeBaseRate > 0 ? Number(((variationPerUnit / safeBaseRate) * 100).toFixed(4)) : 0;

  const cifBreakdown: CifAuditBreakdown = {
    cifValue: safeCifValue,
    cifCurrency,
    cifLagRule,
    lagBaseMonth: cifBaseLookup.resolvedMonth,
    lagEvalMonth: cifEvalLookup.resolvedMonth,
    exactBaseFound: cifBaseLookup.exactMatch || safeCifValue === 0,
    exactEvalFound: cifEvalLookup.exactMatch || safeCifValue === 0,
    baseExchangeRate,
    evalExchangeRate,
    erRatio,
    baseExciseDutyPct,
    evalExciseDutyPct,
    edRatio,
    cifFactor,
    indigenousBaseRate,
    indigenousPvFactor,
    indigenousCalculatedRate,
    indigenousVariation,
    cifCalculatedRate,
    cifVariation,
  };

  return {
    pvSum,
    indigenousPvFactor,
    calculatedRate,
    variationPerUnit,
    variationPct,
    componentBreakdown,
    cifBreakdown,
  };
}

export function findGroupsForPo(
  poNo: string,
  poSr: string,
  deemedGroups: DeemedPvcPoGroup[]
): DeemedPvcPoGroup[] {
  const key = getPoKey(poNo, poSr);
  return deemedGroups.filter((g) => g.memberPoKeys.includes(key));
}

function parseIsoDateSafe(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parsed = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEffectiveDpHistory(po: POMilestone): DpHistoryEntry[] {
  if (Array.isArray(po.dpHistory) && po.dpHistory.length > 0) {
    return [...po.dpHistory]
      .filter((e) => e && e.dpDate)
      .sort((a, b) => a.dpDate.localeCompare(b.dpDate))
      .map((e, idx) => ({ ...e, seqNo: idx + 1 }));
  }
  const fallbackQty = po.orderedQty || 1;
  const legacy: DpHistoryEntry[] = [];
  if (po.refDp) {
    legacy.push({
      id: `legacy-ref-${po.poNo}-${po.poSr}`,
      seqNo: legacy.length + 1,
      type: 'Refixed DP',
      dpDate: po.refDp,
      applicableQty: fallbackQty,
    });
  }
  if (po.extLd) {
    legacy.push({
      id: `legacy-extld-${po.poNo}-${po.poSr}`,
      seqNo: legacy.length + 1,
      type: 'Extended DP (With LD)',
      dpDate: po.extLd,
      applicableQty: fallbackQty,
    });
  }
  if (po.extNoLd) {
    legacy.push({
      id: `legacy-extnold-${po.poNo}-${po.poSr}`,
      seqNo: legacy.length + 1,
      type: 'Extended DP (Without LD)',
      dpDate: po.extNoLd,
      applicableQty: fallbackQty,
    });
  }
  return legacy;
}

export function evaluateScrutinyTransaction(
  input: ScrutinyTransactionInput,
  po: POMilestone,
  item: PLItem,
  itemMonthlyIndices: ItemMonthlyIndicesMap,
  deemedGroups: DeemedPvcPoGroup[] = [],
  poLedger: POMilestone[] = [],
  itemsMaster: PLItem[] = []
): ScrutinyReportResult {
  const isDevelopmental = po.category === 'Developmental';
  const safeInspectionDate =
    input.inspectionCallDate || po.inspectionCallDate || input.actualSupplyDate || po.origDp || '2026-03-15';
  const safeSupplyDate =
    input.actualSupplyDate || po.actualSupplyDate || input.inspectionCallDate || po.origDp || '2026-03-15';
  const callDateMonthNorm = safeInspectionDate.substring(0, 7);
  const actualSupplyMonthNorm = safeSupplyDate.substring(0, 7);
  const origMonth = (po.origDp || safeInspectionDate).substring(0, 7);
  const subjectPoKey = getPoKey(po.poNo, po.poSr);

  const safeQty = Number.isFinite(input.qty) && input.qty > 0 ? input.qty : 1;
  const safeFreight = Number.isFinite(input.freight) && input.freight >= 0 ? input.freight : 0;
  const safeGstPct = Number.isFinite(input.gstPct) && input.gstPct >= 0 ? input.gstPct : 0;

  const subjectCifOpts: DynamicPvcOptions = {
    cifValue: input.cifValue ?? po.cifValue ?? 0,
    cifCurrency: input.cifCurrency || po.cifCurrency || 'USD',
    cifLagRule: input.cifLagRule || po.cifLagRule || 'M-1',
  };

  // Resolve full PO Sr No DP history (supports multiple Refixed DP / Extended DP amendments with specific qty)
  const dpHistory = getEffectiveDpHistory(po);
  const latestRefixedEntry = [...dpHistory].reverse().find((e) => e.type === 'Refixed DP');
  const latestExtNoLdEntry = [...dpHistory]
    .reverse()
    .find((e) => e.type === 'Extended DP (Without LD)');
  const effectiveRefDp = latestRefixedEntry?.dpDate || po.refDp || '';
  const effectiveExtNoLd = latestExtNoLdEntry?.dpDate || po.extNoLd || '';

  const hasCoveringExtNoLd = Boolean(
    effectiveExtNoLd && safeSupplyDate <= effectiveExtNoLd
  );
  const isDelayedDelivery =
    !isDevelopmental &&
    safeSupplyDate > (effectiveRefDp || po.origDp) &&
    !hasCoveringExtNoLd;

  const matrix: ScenarioEvaluation[] = [];

  // 1. Subject PO Sr No: Base Date to Inspection Call Date
  const calcBaseCall = calculateDynamicPVC(
    input.baseDate,
    callDateMonthNorm,
    item,
    input.baseRate,
    itemMonthlyIndices,
    subjectCifOpts
  );
  matrix.push({
    id: 'base-to-call',
    sourcePoKey: subjectPoKey,
    sourcePoLabel: `${po.poNo} (Sr ${po.poSr})`,
    desc: input.isDeemedPvc
      ? `Tender Group [${po.poNo} Sr ${po.poSr}]: Base → Inspection Call`
      : `Sr ${po.poSr}: Base → Inspection Call`,
    clauseTag: 'Base → Call',
    baseM: input.baseDate,
    evalM: callDateMonthNorm,
    inputBaseRate: input.baseRate,
    inputCifValue: subjectCifOpts.cifValue || 0,
    applicableFreight: safeFreight,
    applicableGstPct: safeGstPct,
    applicableQty: po.orderedQty,
    pvFactor: calcBaseCall.pvSum,
    rate: calcBaseCall.calculatedRate,
    landedUnitRate: computeLandedUnitRate(calcBaseCall.calculatedRate, safeFreight, safeGstPct),
    variationPerUnit: calcBaseCall.variationPerUnit,
    variationPct: calcBaseCall.variationPct,
    breakdown: calcBaseCall.componentBreakdown,
    cifBreakdown: calcBaseCall.cifBreakdown,
    ldApplicable: isDelayedDelivery,
    status: 'Evaluated',
  });

  // 2. Subject PO Sr No: Base Date to Actual Supply Date (if month differs)
  if (actualSupplyMonthNorm !== callDateMonthNorm) {
    const calcBaseSupply = calculateDynamicPVC(
      input.baseDate,
      actualSupplyMonthNorm,
      item,
      input.baseRate,
      itemMonthlyIndices,
      subjectCifOpts
    );
    matrix.push({
      id: 'base-to-supply',
      sourcePoKey: subjectPoKey,
      sourcePoLabel: `${po.poNo} (Sr ${po.poSr})`,
      desc: input.isDeemedPvc
        ? `Tender Group [${po.poNo} Sr ${po.poSr}]: Base → Actual Supply`
        : `Sr ${po.poSr}: Base → Actual Supply`,
      clauseTag: 'Base → Supply',
      baseM: input.baseDate,
      evalM: actualSupplyMonthNorm,
      inputBaseRate: input.baseRate,
      inputCifValue: subjectCifOpts.cifValue || 0,
      applicableFreight: safeFreight,
      applicableGstPct: safeGstPct,
      applicableQty: po.orderedQty,
      pvFactor: calcBaseSupply.pvSum,
      rate: calcBaseSupply.calculatedRate,
      landedUnitRate: computeLandedUnitRate(calcBaseSupply.calculatedRate, safeFreight, safeGstPct),
      variationPerUnit: calcBaseSupply.variationPerUnit,
      variationPct: calcBaseSupply.variationPct,
      breakdown: calcBaseSupply.componentBreakdown,
      cifBreakdown: calcBaseSupply.cifBreakdown,
      ldApplicable: isDelayedDelivery,
      status: 'Evaluated',
    });
  }

  // 3. Subject PO Sr No: Base Date to Original DP
  const calcBaseOrig = calculateDynamicPVC(
    input.baseDate,
    origMonth,
    item,
    input.baseRate,
    itemMonthlyIndices,
    subjectCifOpts
  );
  matrix.push({
    id: 'base-to-orig-dp',
    sourcePoKey: subjectPoKey,
    sourcePoLabel: `${po.poNo} (Sr ${po.poSr})`,
    desc: input.isDeemedPvc
      ? `Tender Group [${po.poNo} Sr ${po.poSr}]: Base → Original DP (Qty ${po.orderedQty})`
      : `Sr ${po.poSr}: Base → Original DP (Qty ${po.orderedQty})`,
    clauseTag: `Orig DP (Qty ${po.orderedQty})`,
    baseM: input.baseDate,
    evalM: origMonth,
    inputBaseRate: input.baseRate,
    inputCifValue: subjectCifOpts.cifValue || 0,
    applicableFreight: safeFreight,
    applicableGstPct: safeGstPct,
    applicableQty: po.orderedQty,
    pvFactor: calcBaseOrig.pvSum,
    rate: calcBaseOrig.calculatedRate,
    landedUnitRate: computeLandedUnitRate(calcBaseOrig.calculatedRate, safeFreight, safeGstPct),
    variationPerUnit: calcBaseOrig.variationPerUnit,
    variationPct: calcBaseOrig.variationPct,
    breakdown: calcBaseOrig.componentBreakdown,
    cifBreakdown: calcBaseOrig.cifBreakdown,
    ldApplicable: isDelayedDelivery,
    status: 'Evaluated',
  });

  // 4. Subject PO Sr No: Evaluate EVERY Historical Refixed / Extended DP Entry (with Specific Qty)
  dpHistory.forEach((entry, idx) => {
    const evalM = entry.dpDate.substring(0, 7);
    const calcEntry = calculateDynamicPVC(
      input.baseDate,
      evalM,
      item,
      input.baseRate,
      itemMonthlyIndices,
      subjectCifOpts
    );
    const shortType =
      entry.type === 'Refixed DP'
        ? 'Refixed'
        : entry.type === 'Extended DP (With LD)'
          ? 'Ext LD'
          : 'Ext No-LD';
    const ldForEntry =
      entry.type === 'Extended DP (Without LD)'
        ? false
        : entry.type === 'Extended DP (With LD)'
          ? !isDevelopmental
          : !isDevelopmental && safeSupplyDate > entry.dpDate && !hasCoveringExtNoLd;

    matrix.push({
      id: `dp-hist-${entry.id || idx + 1}`,
      sourcePoKey: subjectPoKey,
      sourcePoLabel: `${po.poNo} (Sr ${po.poSr})`,
      desc: `Sr ${po.poSr} #${entry.seqNo} ${entry.type} (${entry.dpDate}, Qty ${entry.applicableQty})`,
      clauseTag: `${shortType} #${entry.seqNo} · Qty ${entry.applicableQty}`,
      baseM: input.baseDate,
      evalM,
      inputBaseRate: input.baseRate,
      inputCifValue: subjectCifOpts.cifValue || 0,
      applicableFreight: safeFreight,
      applicableGstPct: safeGstPct,
      applicableQty: entry.applicableQty,
      pvFactor: calcEntry.pvSum,
      rate: calcEntry.calculatedRate,
      landedUnitRate: computeLandedUnitRate(calcEntry.calculatedRate, safeFreight, safeGstPct),
      variationPerUnit: calcEntry.variationPerUnit,
      variationPct: calcEntry.variationPct,
      breakdown: calcEntry.componentBreakdown,
      cifBreakdown: calcEntry.cifBreakdown,
      ldApplicable: ldForEntry,
      status: 'DP History',
    });
  });

  // 5. TENDER AUTO-GROUP / MULTI-PO COMPARISON
  let activeDeemedGroup: DeemedPvcPoGroup | undefined;
  const deemedGroupComparisons: DeemedGroupPoComparisonEntry[] = [];

  if (input.isDeemedPvc && deemedGroups.length > 0) {
    activeDeemedGroup =
      (input.deemedGroupId
        ? deemedGroups.find((g) => g.id === input.deemedGroupId)
        : undefined) ||
      deemedGroups.find((g) => g.memberPoKeys.includes(subjectPoKey));

    if (activeDeemedGroup && activeDeemedGroup.memberPoKeys.length > 0) {
      const subjectScenarios = matrix.filter((m) => m.sourcePoKey === subjectPoKey);
      let subjLowest = subjectScenarios[0];
      subjectScenarios.forEach((s) => {
        if (s.landedUnitRate < subjLowest.landedUnitRate) subjLowest = s;
      });

      deemedGroupComparisons.push({
        poKey: subjectPoKey,
        poNo: po.poNo,
        poSr: po.poSr,
        vendorName: po.vendorName,
        pl: po.pl,
        category: po.category,
        baseDate: input.baseDate,
        baseRate: input.baseRate,
        cifValue: subjectCifOpts.cifValue || 0,
        origDpMonth: origMonth,
        callDateMonth: callDateMonthNorm,
        rateAtOrigDp: calcBaseOrig.calculatedRate,
        pvFactorOrigDp: calcBaseOrig.pvSum,
        rateAtCallDate: calcBaseCall.calculatedRate,
        pvFactorCallDate: calcBaseCall.pvSum,
        lowestPoPvcRate: subjLowest.rate,
        lowestPoScenarioDesc: subjLowest.desc,
        isSubjectPo: true,
        isGroupLowest: false,
      });

      activeDeemedGroup.memberPoKeys.forEach((memberKey) => {
        if (memberKey === subjectPoKey) return;
        const [mPoNo, mPoSr] = memberKey.split('___');
        const memberPo = poLedger.find((p) => p.poNo === mPoNo && p.poSr === mPoSr);
        if (!memberPo) return;

        const memberItem = itemsMaster.find((it) => it.pl === memberPo.pl) || item;
        const memberOrigMonth = memberPo.origDp.substring(0, 7);
        const memberFreight = Number.isFinite(memberPo.freight) && memberPo.freight >= 0 ? memberPo.freight : safeFreight;
        const memberGstPct = Number.isFinite(memberPo.gstPct) && memberPo.gstPct >= 0 ? memberPo.gstPct : safeGstPct;
        const memberCifOpts: DynamicPvcOptions = {
          cifValue: memberPo.cifValue ?? 0,
          cifCurrency: memberPo.cifCurrency || 'USD',
          cifLagRule: memberPo.cifLagRule || 'M-1',
        };

        const calcMemberCall = calculateDynamicPVC(
          memberPo.baseDate,
          callDateMonthNorm,
          memberItem,
          memberPo.baseRate,
          itemMonthlyIndices,
          memberCifOpts
        );
        const callScenario: ScenarioEvaluation = {
          id: `deemed-grp-${memberKey}-call`,
          sourcePoKey: memberKey,
          sourcePoLabel: `${memberPo.poNo} (Sr ${memberPo.poSr})`,
          desc: `Tender Group PO [${memberPo.poNo} Sr ${memberPo.poSr}]: Base → Call`,
          clauseTag: `Grp ${memberPo.poNo}/${memberPo.poSr}: Call`,
          baseM: memberPo.baseDate,
          evalM: callDateMonthNorm,
          inputBaseRate: memberPo.baseRate,
          inputCifValue: memberCifOpts.cifValue || 0,
          applicableFreight: memberFreight,
          applicableGstPct: memberGstPct,
          applicableQty: memberPo.orderedQty,
          pvFactor: calcMemberCall.pvSum,
          rate: calcMemberCall.calculatedRate,
          landedUnitRate: computeLandedUnitRate(calcMemberCall.calculatedRate, memberFreight, memberGstPct),
          variationPerUnit: calcMemberCall.variationPerUnit,
          variationPct: calcMemberCall.variationPct,
          breakdown: calcMemberCall.componentBreakdown,
          cifBreakdown: calcMemberCall.cifBreakdown,
          ldApplicable: false,
          status: 'Tender Group PO',
        };
        matrix.push(callScenario);

        const calcMemberOrig = calculateDynamicPVC(
          memberPo.baseDate,
          memberOrigMonth,
          memberItem,
          memberPo.baseRate,
          itemMonthlyIndices,
          memberCifOpts
        );
        const origScenario: ScenarioEvaluation = {
          id: `deemed-grp-${memberKey}-orig`,
          sourcePoKey: memberKey,
          sourcePoLabel: `${memberPo.poNo} (Sr ${memberPo.poSr})`,
          desc: `Tender Group PO [${memberPo.poNo} Sr ${memberPo.poSr}]: Base → Orig DP`,
          clauseTag: `Grp ${memberPo.poNo}/${memberPo.poSr}: Orig DP`,
          baseM: memberPo.baseDate,
          evalM: memberOrigMonth,
          inputBaseRate: memberPo.baseRate,
          inputCifValue: memberCifOpts.cifValue || 0,
          applicableFreight: memberFreight,
          applicableGstPct: memberGstPct,
          applicableQty: memberPo.orderedQty,
          pvFactor: calcMemberOrig.pvSum,
          rate: calcMemberOrig.calculatedRate,
          landedUnitRate: computeLandedUnitRate(calcMemberOrig.calculatedRate, memberFreight, memberGstPct),
          variationPerUnit: calcMemberOrig.variationPerUnit,
          variationPct: calcMemberOrig.variationPct,
          breakdown: calcMemberOrig.componentBreakdown,
          cifBreakdown: calcMemberOrig.cifBreakdown,
          ldApplicable: false,
          status: 'Tender Group PO',
        };
        matrix.push(origScenario);

        let lowestForMember =
          callScenario.landedUnitRate <= origScenario.landedUnitRate ? callScenario : origScenario;

        if (origMonth !== memberOrigMonth) {
          const calcMemberSubjOrig = calculateDynamicPVC(
            memberPo.baseDate,
            origMonth,
            memberItem,
            memberPo.baseRate,
            itemMonthlyIndices,
            memberCifOpts
          );
          const subjOrigScenario: ScenarioEvaluation = {
            id: `deemed-grp-${memberKey}-subj-orig`,
            sourcePoKey: memberKey,
            sourcePoLabel: `${memberPo.poNo} (Sr ${memberPo.poSr})`,
            desc: `Tender Group PO [${memberPo.poNo} Sr ${memberPo.poSr}]: Base → Subject DP`,
            clauseTag: `Grp ${memberPo.poNo}/${memberPo.poSr}: Subj DP`,
            baseM: memberPo.baseDate,
            evalM: origMonth,
            inputBaseRate: memberPo.baseRate,
            inputCifValue: memberCifOpts.cifValue || 0,
            applicableFreight: memberFreight,
            applicableGstPct: memberGstPct,
            applicableQty: memberPo.orderedQty,
            pvFactor: calcMemberSubjOrig.pvSum,
            rate: calcMemberSubjOrig.calculatedRate,
            landedUnitRate: computeLandedUnitRate(calcMemberSubjOrig.calculatedRate, memberFreight, memberGstPct),
            variationPerUnit: calcMemberSubjOrig.variationPerUnit,
            variationPct: calcMemberSubjOrig.variationPct,
            breakdown: calcMemberSubjOrig.componentBreakdown,
            cifBreakdown: calcMemberSubjOrig.cifBreakdown,
            ldApplicable: false,
            status: 'Tender Group PO',
          };
          matrix.push(subjOrigScenario);
          if (subjOrigScenario.landedUnitRate < lowestForMember.landedUnitRate) {
            lowestForMember = subjOrigScenario;
          }
        }

        deemedGroupComparisons.push({
          poKey: memberKey,
          poNo: memberPo.poNo,
          poSr: memberPo.poSr,
          vendorName: memberPo.vendorName,
          pl: memberPo.pl,
          category: memberPo.category,
          baseDate: memberPo.baseDate,
          baseRate: memberPo.baseRate,
          cifValue: memberCifOpts.cifValue || 0,
          origDpMonth: memberOrigMonth,
          callDateMonth: callDateMonthNorm,
          rateAtOrigDp: calcMemberOrig.calculatedRate,
          pvFactorOrigDp: calcMemberOrig.pvSum,
          rateAtCallDate: calcMemberCall.calculatedRate,
          pvFactorCallDate: calcMemberCall.pvSum,
          lowestPoPvcRate: lowestForMember.rate,
          lowestPoScenarioDesc: lowestForMember.desc,
          isSubjectPo: false,
          isGroupLowest: false,
        });
      });

      if (deemedGroupComparisons.length > 0) {
        let minGrpIdx = 0;
        deemedGroupComparisons.forEach((entry, idx) => {
          if (entry.lowestPoPvcRate < deemedGroupComparisons[minGrpIdx].lowestPoPvcRate) {
            minGrpIdx = idx;
          }
        });
        deemedGroupComparisons[minGrpIdx].isGroupLowest = true;
      }
    }
  }

  // 6. Lower Rate PO Clause (includes Lower PO Freight & GST % in landed evaluation)
  const rawLowerFreight = input.lowerFreight ?? po.lowerFreight ?? safeFreight;
  const rawLowerGstPct = input.lowerGstPct ?? po.lowerGstPct ?? safeGstPct;
  const safeLowerFreight = Number.isFinite(rawLowerFreight) && rawLowerFreight >= 0 ? rawLowerFreight : safeFreight;
  const safeLowerGstPct = Number.isFinite(rawLowerGstPct) && rawLowerGstPct >= 0 ? rawLowerGstPct : safeGstPct;

  if (
    input.useLowerRate &&
    input.lowerBaseDate &&
    Number.isFinite(input.lowerBaseRate) &&
    input.lowerBaseRate > 0
  ) {
    const lowerCifOpts: DynamicPvcOptions = {
      cifValue: input.lowerCifValue ?? po.lowerCifValue ?? 0,
      cifCurrency: subjectCifOpts.cifCurrency,
      cifLagRule: subjectCifOpts.cifLagRule,
    };
    const lowerBeyondOrig = input.lowerBaseDate > origMonth;
    const calcLowerCall = calculateDynamicPVC(
      input.lowerBaseDate,
      callDateMonthNorm,
      item,
      input.lowerBaseRate,
      itemMonthlyIndices,
      lowerCifOpts
    );

    if (lowerBeyondOrig) {
      matrix.push({
        id: 'lower-beyond-orig-call',
        sourcePoLabel: input.lowerPoNo,
        desc: `Lower Rate PO (${input.lowerPoNo}): Base → Call (Frt ${formatINR(safeLowerFreight, 0)}, GST ${safeLowerGstPct}%)`,
        clauseTag: 'Lower PO → Call (No LD)',
        baseM: input.lowerBaseDate,
        evalM: callDateMonthNorm,
        inputBaseRate: input.lowerBaseRate,
        inputCifValue: lowerCifOpts.cifValue || 0,
        applicableFreight: safeLowerFreight,
        applicableGstPct: safeLowerGstPct,
        pvFactor: calcLowerCall.pvSum,
        rate: calcLowerCall.calculatedRate,
        landedUnitRate: computeLandedUnitRate(calcLowerCall.calculatedRate, safeLowerFreight, safeLowerGstPct),
        variationPerUnit: calcLowerCall.variationPerUnit,
        variationPct: calcLowerCall.variationPct,
        breakdown: calcLowerCall.componentBreakdown,
        cifBreakdown: calcLowerCall.cifBreakdown,
        ldApplicable: false,
        status: 'Lower Rate Clause',
      });
    } else {
      const calcLowerOrig = calculateDynamicPVC(
        input.lowerBaseDate,
        origMonth,
        item,
        input.lowerBaseRate,
        itemMonthlyIndices,
        lowerCifOpts
      );
      matrix.push({
        id: 'lower-4way-call',
        sourcePoLabel: input.lowerPoNo,
        desc: `Lower Rate PO (${input.lowerPoNo}): Lower Base → Call (Frt ${formatINR(safeLowerFreight, 0)}, GST ${safeLowerGstPct}%)`,
        clauseTag: '4-Way: Lower → Call',
        baseM: input.lowerBaseDate,
        evalM: callDateMonthNorm,
        inputBaseRate: input.lowerBaseRate,
        inputCifValue: lowerCifOpts.cifValue || 0,
        applicableFreight: safeLowerFreight,
        applicableGstPct: safeLowerGstPct,
        pvFactor: calcLowerCall.pvSum,
        rate: calcLowerCall.calculatedRate,
        landedUnitRate: computeLandedUnitRate(calcLowerCall.calculatedRate, safeLowerFreight, safeLowerGstPct),
        variationPerUnit: calcLowerCall.variationPerUnit,
        variationPct: calcLowerCall.variationPct,
        breakdown: calcLowerCall.componentBreakdown,
        cifBreakdown: calcLowerCall.cifBreakdown,
        ldApplicable: false,
        status: 'Lower Rate 4-Way',
      });
      matrix.push({
        id: 'lower-4way-orig',
        sourcePoLabel: input.lowerPoNo,
        desc: `Lower Rate PO (${input.lowerPoNo}): Lower Base → Orig DP (Frt ${formatINR(safeLowerFreight, 0)}, GST ${safeLowerGstPct}%)`,
        clauseTag: '4-Way: Lower → Orig DP',
        baseM: input.lowerBaseDate,
        evalM: origMonth,
        inputBaseRate: input.lowerBaseRate,
        inputCifValue: lowerCifOpts.cifValue || 0,
        applicableFreight: safeLowerFreight,
        applicableGstPct: safeLowerGstPct,
        pvFactor: calcLowerOrig.pvSum,
        rate: calcLowerOrig.calculatedRate,
        landedUnitRate: computeLandedUnitRate(calcLowerOrig.calculatedRate, safeLowerFreight, safeLowerGstPct),
        variationPerUnit: calcLowerOrig.variationPerUnit,
        variationPct: calcLowerOrig.variationPct,
        breakdown: calcLowerOrig.componentBreakdown,
        cifBreakdown: calcLowerOrig.cifBreakdown,
        ldApplicable: false,
        status: 'Lower Rate 4-Way',
      });
    }
  }

  // Select governing lowest beneficial scenario by Landed Unit Rate (Basic + Freight + GST), tie-break by Basic Rate
  let selectedScenario = matrix[0];
  matrix.forEach((m) => {
    if (
      m.landedUnitRate < selectedScenario.landedUnitRate ||
      (m.landedUnitRate === selectedScenario.landedUnitRate && m.rate < selectedScenario.rate)
    ) {
      selectedScenario = m;
    }
  });
  const lowestRate = selectedScenario.rate;
  const appliedFreight = selectedScenario.applicableFreight;
  const appliedGstPct = selectedScenario.applicableGstPct;

  // Exact Day-Count LD Calculation using Actual Supply Date vs Target DP (0.5%/wk, max 10%)
  const referenceContractDp = effectiveRefDp || po.origDp;
  const targetDpDateStr = effectiveExtNoLd || referenceContractDp;
  const targetDpLabel = effectiveExtNoLd
    ? `Extended DP (Without LD): ${effectiveExtNoLd}`
    : effectiveRefDp
      ? `Refixed DP: ${effectiveRefDp}`
      : `Original DP: ${po.origDp}`;

  const supplyDateObj = parseIsoDateSafe(safeSupplyDate);
  const targetDpObj = parseIsoDateSafe(targetDpDateStr);
  const extNoLdObj = parseIsoDateSafe(effectiveExtNoLd);

  let exactDelayDays = 0;
  let ldWeeks = 0;
  let ldPct = 0;
  let ldAmount = 0;
  let ldExemptionReason: string | null = null;

  if (isDevelopmental) {
    ldExemptionReason = 'Developmental PO — LD Exempt (0%)';
  } else if (extNoLdObj && supplyDateObj && supplyDateObj <= extNoLdObj) {
    ldExemptionReason = `Supplied within Extended DP without LD (${effectiveExtNoLd})`;
  } else if (
    selectedScenario.desc.includes('Without LD') ||
    selectedScenario.desc.includes('No LD') ||
    selectedScenario.desc.includes('Lower Rate') ||
    !selectedScenario.ldApplicable
  ) {
    ldExemptionReason =
      selectedScenario.status === 'Tender Group PO'
        ? `Tender Group Lowest PO (${selectedScenario.sourcePoLabel}) — LD Nil`
        : 'Lower Rate / Without-LD Scenario — LD Nil';
  } else if (!supplyDateObj || !targetDpObj || supplyDateObj <= targetDpObj) {
    ldExemptionReason = `On-Time Supply (${safeSupplyDate} ≤ ${targetDpDateStr})`;
  } else {
    const diffTime = supplyDateObj.getTime() - targetDpObj.getTime();
    exactDelayDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    ldWeeks = Math.ceil(exactDelayDays / 7);
    ldPct = Math.min(10, ldWeeks * 0.5);
    ldAmount = Number((lowestRate * safeQty * (ldPct / 100)).toFixed(2));
  }

  const baseTotalValue = Number((input.baseRate * safeQty).toFixed(2));
  const passedBasicValue = Number((lowestRate * safeQty).toFixed(2));
  const netPvcVariationTotal = Number((passedBasicValue - baseTotalValue).toFixed(2));
  const freightTotal = Number((appliedFreight * safeQty).toFixed(2));
  const subtotalBeforeGst = Number(((lowestRate + appliedFreight) * safeQty).toFixed(2));
  const gstAmount = Number((subtotalBeforeGst * (appliedGstPct / 100)).toFixed(2));
  const grossPayableBeforeLd = Number((subtotalBeforeGst + gstAmount).toFixed(2));
  const netPayable = Number((grossPayableBeforeLd - ldAmount).toFixed(2));

  reportIdCounter += 1;

  return {
    id: `SCR-${Date.now()}-${reportIdCounter}`,
    createdAt: new Date().toISOString(),
    input: {
      ...input,
      inspectionCallDate: safeInspectionDate,
      actualSupplyDate: safeSupplyDate,
      qty: safeQty,
      freight: safeFreight,
      gstPct: safeGstPct,
      lowerFreight: safeLowerFreight,
      lowerGstPct: safeLowerGstPct,
    },
    po,
    item,
    callDateMonthNorm,
    actualSupplyMonthNorm,
    matrix,
    selectedScenario,
    lowestRate,
    appliedFreight,
    appliedGstPct,
    activeDeemedGroup,
    deemedGroupComparisons,
    isDevelopmental,
    targetDpDateStr,
    targetDpLabel,
    exactDelayDays,
    ldWeeks,
    ldPct,
    ldAmount,
    ldExemptionReason,
    baseTotalValue,
    passedBasicValue,
    netPvcVariationTotal,
    freightTotal,
    subtotalBeforeGst,
    gstAmount,
    grossPayableBeforeLd,
    netPayable,
  };
}
