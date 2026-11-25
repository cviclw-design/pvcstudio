export type TimeLagRule = 'M-0' | 'M-1' | 'M-2' | 'M-3' | 'M-4';

export type ForeignCurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CHF';

export type CurrencyCode = 'INR' | ForeignCurrencyCode;

export type ExchangeRatesByCurrency = Partial<Record<ForeignCurrencyCode, number>>;

export interface PVCComponent {
  name: string;
  weight: number; // Decimal weight (e.g., 0.40 for 40%)
  timelag: TimeLagRule;
  indexAuthority?: string; // e.g., "IEEMA", "EA WPI", "Labour Bureau"
}

export interface PLItem {
  pl: string;
  name: string;
  specification?: string;
  unit?: string;
  fixedFactor?: number;
  components: PVCComponent[];
}

export type POCategory = 'Regular' | 'Developmental';

export type DpAmendmentType =
  | 'Refixed DP'
  | 'Extended DP (With LD)'
  | 'Extended DP (Without LD)';

export interface DpHistoryEntry {
  id: string;
  seqNo: number; // Sequential amendment number (1, 2, 3...)
  type: DpAmendmentType;
  dpDate: string; // Full date YYYY-MM-DD
  applicableQty: number; // Specific quantity covered by this DP refixation / extension
  amendmentRef?: string; // e.g. "MA-01 / 12-01-2026"
  remarks?: string;
}

export interface POMilestone {
  poNo: string; // First 8 digits represent Tender No (e.g. "26251048/001")
  poSr: string; // Distinct PO Sr No attached to PO No ("01", "02", ...)
  pl: string;
  vendorName: string;
  category: POCategory;
  // PO Sr No–scoped delivery, DP history, and supply dates
  orderedQty: number;
  origDp: string; // Original DP for this PO Sr No (YYYY-MM-DD)
  refDp: string; // Latest Refixed DP synced from dpHistory (or "")
  extLd: string; // Latest Extended DP With LD synced from dpHistory (or "")
  extNoLd: string; // Latest Extended DP Without LD synced from dpHistory (or "")
  dpHistory: DpHistoryEntry[]; // Complete chronological history of all DP refixations/extensions with specific qty
  inspectionCallDate: string; // Distinct Inspection Call Date for this PO Sr No (YYYY-MM-DD)
  actualSupplyDate: string; // Distinct Actual Supply Date for this PO Sr No (YYYY-MM-DD)
  // Commercial rate & CIF terms
  baseDate: string; // YYYY-MM
  baseRate: number; // ₹ per unit (inclusive of CIF value)
  cifValue: number; // ₹ per unit CIF value included inside baseRate
  cifCurrency: CurrencyCode;
  cifLagRule: TimeLagRule;
  freight: number; // ₹ per unit
  gstPct: number; // %
  // Lower Rate PO Reference (includes Freight & GST %)
  lowerApplicable: 'Yes' | 'No';
  lowerPoNo?: string;
  lowerBaseDate?: string; // YYYY-MM
  lowerBaseRate?: number; // ₹
  lowerCifValue?: number; // ₹
  lowerFreight?: number; // ₹ per unit
  lowerGstPct?: number; // %
  remarks: string;
}

export interface DeemedPvcPoGroup {
  id: string;
  name: string;
  tenderNo?: string; // First 8 digits of PO No when auto-grouped by Tender No
  isAutoTenderGroup?: boolean;
  isAdminEdited?: boolean;
  memberPoKeys: string[]; // Format: `${poNo}___${poSr}`
  createdAt: string;
  remarks?: string;
}

export interface DeemedGroupPoComparisonEntry {
  poKey: string;
  poNo: string;
  poSr: string;
  vendorName: string;
  pl: string;
  category: POCategory;
  baseDate: string;
  baseRate: number;
  cifValue: number;
  origDpMonth: string;
  callDateMonth: string;
  rateAtOrigDp: number;
  pvFactorOrigDp: number;
  rateAtCallDate: number;
  pvFactorCallDate: number;
  lowestPoPvcRate: number;
  lowestPoScenarioDesc: string;
  isSubjectPo: boolean;
  isGroupLowest: boolean;
}

export interface MonthlyIndexEntry {
  [componentName: string]: number | string | ExchangeRatesByCurrency | undefined;
  exchangeRates?: ExchangeRatesByCurrency; // Monthly INR exchange rates for USD, EUR, GBP, JPY, CHF
  exchangeRate?: number; // Legacy single exchange rate fallback
  exciseDutyPct?: number; // Rate of Duty % (default 11%)
  source?: string;
  circularDate?: string;
  attachmentName?: string;
  verifiedBy?: string;
}

export interface ItemMonthlyIndicesMap {
  [pl: string]: {
    [yearMonth: string]: MonthlyIndexEntry;
  };
}

export interface SuppliersByPlMap {
  [pl: string]: string[];
}

export interface ComponentAuditBreakdown {
  name: string;
  weight: number;
  timelag: TimeLagRule;
  lagBase: string;
  lagEval: string;
  baseIdxVal: number;
  evalIdxVal: number;
  exactBaseFound: boolean;
  exactEvalFound: boolean;
  ratio: number;
  weightedRatio: number;
}

export interface CifAuditBreakdown {
  cifValue: number;
  cifCurrency: CurrencyCode;
  cifLagRule: TimeLagRule;
  lagBaseMonth: string;
  lagEvalMonth: string;
  exactBaseFound: boolean;
  exactEvalFound: boolean;
  baseExchangeRate: number;
  evalExchangeRate: number;
  erRatio: number;
  baseExciseDutyPct: number;
  evalExciseDutyPct: number;
  edRatio: number;
  cifFactor: number;
  indigenousBaseRate: number;
  indigenousPvFactor: number;
  indigenousCalculatedRate: number;
  indigenousVariation: number;
  cifCalculatedRate: number;
  cifVariation: number;
}

export interface ScenarioEvaluation {
  id: string;
  sourcePoKey?: string;
  sourcePoLabel?: string;
  desc: string;
  clauseTag: string;
  baseM: string;
  evalM: string;
  inputBaseRate: number;
  inputCifValue: number;
  applicableFreight: number;
  applicableGstPct: number;
  applicableQty?: number;
  pvFactor: number;
  rate: number; // Passed PVC basic unit rate (Indigenous + CIF)
  landedUnitRate: number; // (rate + applicableFreight) * (1 + applicableGstPct / 100)
  variationPerUnit: number;
  variationPct: number;
  breakdown: ComponentAuditBreakdown[];
  cifBreakdown: CifAuditBreakdown;
  ldApplicable: boolean;
  status: string;
}

export interface ScrutinyTransactionInput {
  poNo: string;
  poSr: string;
  inspectionCallDate: string; // YYYY-MM-DD (connected with PO Sr No; governs PVC index evaluation month)
  actualSupplyDate: string; // YYYY-MM-DD (connected with PO Sr No; governs delivery completion & exact-day LD)
  billRef: string;
  rNoteNo: string;
  baseDate: string; // YYYY-MM
  baseRate: number; // ₹ per unit (inclusive of CIF value)
  cifValue: number; // ₹ per unit CIF portion included inside baseRate
  cifCurrency: CurrencyCode;
  cifLagRule: TimeLagRule;
  freight: number; // ₹ per unit
  gstPct: number; // %
  qty: number;
  isDeemedPvc: boolean;
  deemedGroupId?: string;
  useLowerRate: boolean;
  lowerPoNo: string;
  lowerBaseDate: string; // YYYY-MM
  lowerBaseRate: number; // ₹
  lowerCifValue?: number; // ₹
  lowerFreight?: number; // ₹ per unit
  lowerGstPct?: number; // %
  customFixedFactor?: number;
  auditorNotes?: string;
}

export interface ScrutinyReportResult {
  id: string;
  createdAt: string;
  input: ScrutinyTransactionInput;
  po: POMilestone;
  item: PLItem;
  callDateMonthNorm: string;
  actualSupplyMonthNorm: string;
  matrix: ScenarioEvaluation[];
  selectedScenario: ScenarioEvaluation;
  lowestRate: number;
  appliedFreight: number;
  appliedGstPct: number;
  activeDeemedGroup?: DeemedPvcPoGroup;
  deemedGroupComparisons: DeemedGroupPoComparisonEntry[];
  isDevelopmental: boolean;
  targetDpDateStr: string;
  targetDpLabel: string;
  exactDelayDays: number;
  ldWeeks: number;
  ldPct: number;
  ldAmount: number;
  ldExemptionReason: string | null;
  baseTotalValue: number;
  passedBasicValue: number;
  netPvcVariationTotal: number;
  freightTotal: number;
  subtotalBeforeGst: number;
  gstAmount: number;
  grossPayableBeforeLd: number;
  netPayable: number;
}
