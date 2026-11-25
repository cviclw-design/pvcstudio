import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXCISE_DUTY_PCT,
  INITIAL_DEEMED_GROUPS,
  INITIAL_ITEMS_MASTER,
  INITIAL_MONTHLY_INDICES,
  INITIAL_PO_LEDGER,
} from '../data/initialData';
import { ItemMonthlyIndicesMap, PLItem, POMilestone, ScrutinyTransactionInput } from '../types/pvc';
import {
  calculateDynamicPVC,
  computeLandedUnitRate,
  computeTargetLagMonth,
  evaluateScrutinyTransaction,
  findGroupsForPo,
  formatINR,
  getLagMonths,
  getPoKey,
  resolveCurrencyExchangeRate,
  resolveLaggedMonthForComponent,
} from './pvcEngine';

test('formatINR formats Indian currency grouping, negatives, and non-finite values safely', () => {
  assert.equal(formatINR(300000), '₹3,00,000.00');
  assert.equal(formatINR(-12500.5), '-₹12,500.50');
  assert.equal(formatINR(Number.NaN), '₹0.00');
  assert.equal(formatINR(Number.POSITIVE_INFINITY), '₹0.00');
});

test('getPoKey, computeLandedUnitRate, and getLagMonths map values accurately', () => {
  assert.equal(getPoKey('26251048/001', '01'), '26251048/001___01');
  assert.equal(computeLandedUnitRate(100000, 5000, 18), 123900);
  assert.equal(getLagMonths('M-0'), 0);
  assert.equal(getLagMonths('M-1'), 1);
  assert.equal(getLagMonths('M-2'), 2);
  assert.equal(getLagMonths('M-3'), 3);
  assert.equal(getLagMonths('M-4'), 4);
});

test('computeTargetLagMonth handles year rollovers cleanly', () => {
  assert.equal(computeTargetLagMonth('2026-01', 'M-2'), '2025-11');
  assert.equal(computeTargetLagMonth('2026-02', 'M-3'), '2025-11');
  assert.equal(computeTargetLagMonth('2026-03', 'M-0'), '2026-03');
  assert.equal(computeTargetLagMonth('invalid', 'M-2'), 'invalid');
});

test('resolveLaggedMonthForComponent falls back to preceding or earliest available month', () => {
  const exact = resolveLaggedMonthForComponent('29104820', '2026-03', 'M-2', INITIAL_MONTHLY_INDICES);
  assert.equal(exact.exactMatch, true);
  assert.equal(exact.resolvedMonth, '2026-01');

  const earliest = resolveLaggedMonthForComponent('29104820', '2025-02', 'M-3', INITIAL_MONTHLY_INDICES);
  assert.equal(earliest.exactMatch, false);
  assert.equal(earliest.targetMonth, '2024-11');
  assert.equal(earliest.resolvedMonth, '2025-02');

  const latest = resolveLaggedMonthForComponent('29104820', '2026-07', 'M-1', INITIAL_MONTHLY_INDICES);
  assert.equal(latest.exactMatch, false);
  assert.equal(latest.resolvedMonth, '2026-03');
});

test('calculateDynamicPVC splits Basic Excl. CIF and multi-currency CIF FX + Rate of Duty accurately', () => {
  const item: PLItem = {
    pl: 'TEST-01',
    name: 'Test Converter',
    components: [
      { name: 'Copper', weight: 0.6, timelag: 'M-1' },
      { name: 'Fixed', weight: 0.4, timelag: 'M-0' },
    ],
  };

  const indices: ItemMonthlyIndicesMap = {
    'TEST-01': {
      '2025-07': {
        Copper: 100,
        Fixed: 100,
        exchangeRates: { USD: 80, EUR: 90, GBP: 100, JPY: 0.5, CHF: 95 },
        exciseDutyPct: DEFAULT_EXCISE_DUTY_PCT,
      },
      '2026-02': {
        Copper: 120,
        Fixed: 100,
        exchangeRates: { USD: 84, EUR: 99, GBP: 120, JPY: 0.55, CHF: 100 },
        exciseDutyPct: DEFAULT_EXCISE_DUTY_PCT,
      },
    },
  };

  assert.equal(resolveCurrencyExchangeRate(indices['TEST-01']['2025-07'], 'EUR'), 90);
  assert.equal(resolveCurrencyExchangeRate(indices['TEST-01']['2026-02'], 'GBP'), 120);
  assert.equal(resolveCurrencyExchangeRate(indices['TEST-01']['2026-02'], 'INR'), 1.0);

  const result = calculateDynamicPVC('2025-08', '2026-03', item, 300000, indices, {
    cifValue: 100000,
    cifCurrency: 'EUR',
    cifLagRule: 'M-1',
  });

  assert.equal(result.cifBreakdown.indigenousBaseRate, 200000);
  assert.equal(Number(result.indigenousPvFactor.toFixed(4)), 1.12);
  assert.equal(result.cifBreakdown.indigenousCalculatedRate, 224000);
  assert.equal(Number(result.cifBreakdown.erRatio.toFixed(4)), 1.1);
  assert.equal(Number(result.cifBreakdown.edRatio.toFixed(4)), 1.0);
  assert.equal(result.cifBreakdown.cifCalculatedRate, 110000);
  assert.equal(result.calculatedRate, 334000);
  assert.equal(result.variationPerUnit, 34000);

  const gbpResult = calculateDynamicPVC('2025-08', '2026-03', item, 300000, indices, {
    cifValue: 100000,
    cifCurrency: 'GBP',
    cifLagRule: 'M-1',
  });
  assert.equal(Number(gbpResult.cifBreakdown.erRatio.toFixed(4)), 1.2);
  assert.equal(gbpResult.calculatedRate, 344000);
});

test('calculateDynamicPVC applies Rate of Duty change and custom CIF lag rule', () => {
  const item: PLItem = {
    pl: 'TEST-02',
    name: 'Test Motor',
    components: [{ name: 'Steel', weight: 1.0, timelag: 'M-2' }],
  };

  const indices: ItemMonthlyIndicesMap = {
    'TEST-02': {
      '2025-06': { Steel: 200, exchangeRate: 80, exciseDutyPct: 11 },
      '2026-01': { Steel: 200, exchangeRate: 80, exciseDutyPct: 14 },
    },
  };

  const result = calculateDynamicPVC('2025-08', '2026-03', item, 211000, indices, {
    cifValue: 111000,
    cifCurrency: 'USD',
    cifLagRule: 'M-2',
  });

  assert.equal(result.cifBreakdown.lagBaseMonth, '2025-06');
  assert.equal(result.cifBreakdown.lagEvalMonth, '2026-01');
  assert.equal(result.cifBreakdown.cifCalculatedRate, 114000);
  assert.equal(result.calculatedRate, 214000);
});

test('evaluateScrutinyTransaction evaluates multiple PO Sr No DP history entries with specific quantities', () => {
  const poWithMultiDp: POMilestone = {
    ...INITIAL_PO_LEDGER[3], // 26251412/001 Sr 01 (has Refixed DP Qty 4 + Ext LD Qty 2)
    lowerApplicable: 'No',
  };
  const item = INITIAL_ITEMS_MASTER.find((i) => i.pl === poWithMultiDp.pl)!;

  const input: ScrutinyTransactionInput = {
    poNo: poWithMultiDp.poNo,
    poSr: poWithMultiDp.poSr,
    inspectionCallDate: poWithMultiDp.inspectionCallDate,
    actualSupplyDate: poWithMultiDp.actualSupplyDate,
    billRef: 'INV-412-SR01',
    rNoteNo: 'RN-01',
    baseDate: poWithMultiDp.baseDate,
    baseRate: poWithMultiDp.baseRate,
    cifValue: poWithMultiDp.cifValue,
    cifCurrency: poWithMultiDp.cifCurrency,
    cifLagRule: poWithMultiDp.cifLagRule,
    freight: poWithMultiDp.freight,
    gstPct: poWithMultiDp.gstPct,
    qty: 4,
    isDeemedPvc: false,
    useLowerRate: false,
    lowerPoNo: '',
    lowerBaseDate: '',
    lowerBaseRate: 0,
  };

  const report = evaluateScrutinyTransaction(
    input,
    poWithMultiDp,
    item,
    INITIAL_MONTHLY_INDICES,
    [],
    [poWithMultiDp],
    INITIAL_ITEMS_MASTER
  );

  // Both DP history entries must be evaluated in the matrix with their specific quantities
  const histScenarios = report.matrix.filter((s) => s.status === 'DP History');
  assert.equal(histScenarios.length, 2);
  assert.equal(histScenarios[0].applicableQty, 4);
  assert.equal(histScenarios[1].applicableQty, 2);
  // Target LD baseline uses latest Refixed DP (2026-02-28)
  assert.equal(report.targetDpDateStr, '2026-02-28');
  assert.equal(report.exactDelayDays, 25); // 2026-03-25 vs 2026-02-28
});

test('evaluateScrutinyTransaction incorporates Lower Rate PO Freight & GST% in landed selection and final bill passing', () => {
  const po: POMilestone = {
    ...INITIAL_PO_LEDGER[0],
    dpHistory: [],
    extLd: '',
    extNoLd: '',
    refDp: '',
    origDp: '2025-12-15',
  };
  const item = INITIAL_ITEMS_MASTER[0];

  // Lower PO has slightly lower basic rate (295k vs 300k), LOWER freight (1000 vs 8500), and LOWER GST (12% vs 18%)
  const inputLowerWins: ScrutinyTransactionInput = {
    poNo: po.poNo,
    poSr: po.poSr,
    inspectionCallDate: '2026-03-10',
    actualSupplyDate: '2026-03-22',
    billRef: 'INV-LOWER-GST',
    rNoteNo: 'RN-01',
    baseDate: '2025-08',
    baseRate: 300000,
    cifValue: 0,
    cifCurrency: 'INR',
    cifLagRule: 'M-1',
    freight: 8500,
    gstPct: 18,
    qty: 2,
    isDeemedPvc: false,
    useLowerRate: true,
    lowerPoNo: '26251048/002',
    lowerBaseDate: '2025-08',
    lowerBaseRate: 295000,
    lowerCifValue: 0,
    lowerFreight: 1000,
    lowerGstPct: 12,
  };

  const repLowerWins = evaluateScrutinyTransaction(
    inputLowerWins,
    po,
    item,
    INITIAL_MONTHLY_INDICES,
    [],
    [po],
    INITIAL_ITEMS_MASTER
  );

  assert.equal(repLowerWins.selectedScenario.sourcePoLabel, '26251048/002');
  assert.equal(repLowerWins.appliedFreight, 1000);
  assert.equal(repLowerWins.appliedGstPct, 12);
  assert.equal(repLowerWins.freightTotal, 2000);

  // Now give Lower PO very high freight (40,000) & 28% GST -> Subject PO must win on Landed Unit Rate!
  const repSubjectWins = evaluateScrutinyTransaction(
    { ...inputLowerWins, lowerFreight: 40000, lowerGstPct: 28 },
    po,
    item,
    INITIAL_MONTHLY_INDICES,
    [],
    [po],
    INITIAL_ITEMS_MASTER
  );

  assert.equal(repSubjectWins.selectedScenario.sourcePoKey, getPoKey(po.poNo, po.poSr));
  assert.equal(repSubjectWins.appliedFreight, 8500);
  assert.equal(repSubjectWins.appliedGstPct, 18);
});

test('evaluateScrutinyTransaction enforces 10% LD cap and Developmental PO LD exemption', () => {
  const regularPo: POMilestone = {
    ...INITIAL_PO_LEDGER[0],
    origDp: '2025-09-01',
    dpHistory: [],
    extLd: '',
    extNoLd: '',
    lowerApplicable: 'No',
  };
  const devPo = INITIAL_PO_LEDGER.find((p) => p.category === 'Developmental')!;
  const item = INITIAL_ITEMS_MASTER[0];

  const lateInput: ScrutinyTransactionInput = {
    poNo: regularPo.poNo,
    poSr: regularPo.poSr,
    inspectionCallDate: '2026-03-10',
    actualSupplyDate: '2026-03-25',
    billRef: 'INV-LATE',
    rNoteNo: 'RN-LATE',
    baseDate: regularPo.baseDate,
    baseRate: regularPo.baseRate,
    cifValue: regularPo.cifValue,
    cifCurrency: regularPo.cifCurrency,
    cifLagRule: regularPo.cifLagRule,
    freight: regularPo.freight,
    gstPct: regularPo.gstPct,
    qty: 5,
    isDeemedPvc: false,
    useLowerRate: false,
    lowerPoNo: '',
    lowerBaseDate: '',
    lowerBaseRate: 0,
  };

  const cappedReport = evaluateScrutinyTransaction(
    lateInput,
    regularPo,
    item,
    INITIAL_MONTHLY_INDICES,
    [],
    [regularPo],
    INITIAL_ITEMS_MASTER
  );
  assert.equal(cappedReport.ldPct, 10);

  const devReport = evaluateScrutinyTransaction(
    { ...lateInput, poNo: devPo.poNo, poSr: devPo.poSr },
    devPo,
    item,
    INITIAL_MONTHLY_INDICES,
    [],
    [devPo],
    INITIAL_ITEMS_MASTER
  );
  assert.equal(devReport.isDevelopmental, true);
  assert.equal(devReport.ldAmount, 0);
  assert.equal(devReport.ldPct, 0);
  assert.match(devReport.ldExemptionReason || '', /Developmental/i);
});

test('evaluateScrutinyTransaction selects lowest landed rate across Tender Auto-Group POs', () => {
  const subjectPo = INITIAL_PO_LEDGER[0]; // 26251048/001
  const item = INITIAL_ITEMS_MASTER[0];
  const groups = findGroupsForPo(subjectPo.poNo, subjectPo.poSr, INITIAL_DEEMED_GROUPS);
  assert.equal(groups.length, 1);

  const input: ScrutinyTransactionInput = {
    poNo: subjectPo.poNo,
    poSr: subjectPo.poSr,
    inspectionCallDate: subjectPo.inspectionCallDate,
    actualSupplyDate: subjectPo.actualSupplyDate,
    billRef: 'INV-001',
    rNoteNo: 'RN-01',
    baseDate: subjectPo.baseDate,
    baseRate: subjectPo.baseRate,
    cifValue: subjectPo.cifValue,
    cifCurrency: subjectPo.cifCurrency,
    cifLagRule: subjectPo.cifLagRule,
    freight: subjectPo.freight,
    gstPct: subjectPo.gstPct,
    qty: 10,
    isDeemedPvc: true,
    deemedGroupId: groups[0].id,
    useLowerRate: false,
    lowerPoNo: '',
    lowerBaseDate: '',
    lowerBaseRate: 0,
  };

  const report = evaluateScrutinyTransaction(
    input,
    subjectPo,
    item,
    INITIAL_MONTHLY_INDICES,
    INITIAL_DEEMED_GROUPS,
    INITIAL_PO_LEDGER,
    INITIAL_ITEMS_MASTER
  );

  assert.equal(report.deemedGroupComparisons.length, 3);
  const winner = report.deemedGroupComparisons.find((c) => c.isGroupLowest);
  assert.ok(winner);
  assert.equal(winner.poNo, '26251048/002');
  assert.equal(report.lowestRate, winner.lowestPoPvcRate);
  assert.equal(report.ldAmount, 0);
});
