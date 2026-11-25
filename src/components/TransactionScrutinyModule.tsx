import React, { useEffect, useMemo } from 'react';
import {
  Calculator,
  Calendar,
  CheckCircle2,
  FileCheck2,
  FileSpreadsheet,
  Layers,
  RotateCcw,
  Scale,
} from 'lucide-react';
import {
  CurrencyCode,
  DeemedPvcPoGroup,
  ItemMonthlyIndicesMap,
  PLItem,
  POMilestone,
  ScrutinyReportResult,
  ScrutinyTransactionInput,
  TimeLagRule,
} from '../types/pvc';
import { extractTenderNo } from '../utils/navigation';
import {
  evaluateScrutinyTransaction,
  findGroupsForPo,
  formatINR,
  getPoKey,
} from '../utils/pvcEngine';

interface TransactionScrutinyModuleProps {
  itemsMaster: PLItem[];
  poLedger: POMilestone[];
  itemMonthlyIndices: ItemMonthlyIndicesMap;
  deemedGroups: DeemedPvcPoGroup[];
  transactionInput: ScrutinyTransactionInput;
  onChangeTransactionInput: (next: ScrutinyTransactionInput) => void;
  onSelectPoKey: (poNo: string, poSr: string) => void;
  onGenerateReport: (result: ScrutinyReportResult) => void;
  onResetToPoDefaults: () => void;
  onOpenIndicesForPl: (pl: string) => void;
  onNotify: (msg: string, type?: 'success' | 'warning' | 'error') => void;
}

const TIME_LAG_OPTIONS: TimeLagRule[] = ['M-0', 'M-1', 'M-2', 'M-3', 'M-4'];
const CURRENCY_OPTIONS: CurrencyCode[] = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'INR'];

export const TransactionScrutinyModule: React.FC<TransactionScrutinyModuleProps> = ({
  itemsMaster,
  poLedger,
  itemMonthlyIndices,
  deemedGroups,
  transactionInput,
  onChangeTransactionInput,
  onSelectPoKey,
  onGenerateReport,
  onResetToPoDefaults,
  onOpenIndicesForPl,
  onNotify,
}) => {
  const activePo = useMemo(
    () =>
      poLedger.find(
        (p) => p.poNo === transactionInput.poNo && p.poSr === transactionInput.poSr
      ) || poLedger[0],
    [poLedger, transactionInput.poNo, transactionInput.poSr]
  );

  const activeItem = useMemo(
    () => (activePo && itemsMaster.find((i) => i.pl === activePo.pl)) || itemsMaster[0],
    [itemsMaster, activePo]
  );

  const matchingGroupsForPo = useMemo(
    () => (activePo ? findGroupsForPo(activePo.poNo, activePo.poSr, deemedGroups) : []),
    [activePo, deemedGroups]
  );

  // Available already-added POs for Lower Rate PO comparison (same-PL POs first, excluding active PO Sr)
  const availableLowerPos = useMemo(() => {
    if (!activePo) return [];
    const others = poLedger.filter(
      (p) => !(p.poNo === activePo.poNo && p.poSr === activePo.poSr)
    );
    return [...others].sort((a, b) => {
      const aSame = a.pl === activePo.pl ? 0 : 1;
      const bSame = b.pl === activePo.pl ? 0 : 1;
      if (aSame !== bSame) return aSame - bSame;
      return a.baseRate - b.baseRate;
    });
  }, [poLedger, activePo]);

  useEffect(() => {
    if (!activePo) return;
    if (matchingGroupsForPo.length > 0) {
      const currentValid = matchingGroupsForPo.some(
        (g) => g.id === transactionInput.deemedGroupId
      );
      if (!currentValid) {
        onChangeTransactionInput({
          ...transactionInput,
          deemedGroupId: matchingGroupsForPo[0].id,
        });
      }
    }
  }, [activePo, matchingGroupsForPo, transactionInput, onChangeTransactionInput]);

  const livePreview: ScrutinyReportResult | null = useMemo(() => {
    if (!activePo || !activeItem) return null;
    return evaluateScrutinyTransaction(
      transactionInput,
      activePo,
      activeItem,
      itemMonthlyIndices,
      deemedGroups,
      poLedger,
      itemsMaster
    );
  }, [
    transactionInput,
    activePo,
    activeItem,
    itemMonthlyIndices,
    deemedGroups,
    poLedger,
    itemsMaster,
  ]);

  if (!activePo || !activeItem) {
    return (
      <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-sm text-slate-500">
        No PL Item or PO available.
      </div>
    );
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transactionInput.inspectionCallDate || !transactionInput.actualSupplyDate) {
      onNotify('Both Inspection Call Date and Actual Supply Date are required.', 'error');
      return;
    }
    if (!livePreview) return;
    onGenerateReport(livePreview);
  };

  const basicExclCif = Math.max(
    0,
    (transactionInput.baseRate || 0) - (transactionInput.cifValue || 0)
  );
  const selectedCif = livePreview?.selectedScenario.cifBreakdown;
  const activeTenderNo = extractTenderNo(activePo.poNo);

  return (
    <div className="space-y-6">
      {/* Compact Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-xl border border-slate-200">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
            03. Transaction & PVC Scrutiny Engine
          </h1>
          <span className="hidden md:inline text-xs font-mono text-blue-700 font-semibold shrink-0">
            PL {activeItem.pl} · Sr {activePo.poSr}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onOpenIndicesForPl(activeItem.pl)}
            className="px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Edit PL {activeItem.pl} Indices
          </button>
          <button
            type="button"
            onClick={onResetToPoDefaults}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
        </div>
      </div>

      {/* Main 2-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): Inputs */}
        <form
          onSubmit={handleFormSubmit}
          className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-5"
        >
          {/* PO & PO Sr Selection + Distinct Inspection Call Date & Actual Supply Date */}
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3.5">
            <div>
              <label
                htmlFor="scrutiny-po-select"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Purchase Order & PO Sr No *
              </label>
              <select
                id="scrutiny-po-select"
                value={`${activePo.poNo}___${activePo.poSr}`}
                onChange={(e) => {
                  const [poNo, poSr] = e.target.value.split('___');
                  onSelectPoKey(poNo, poSr);
                }}
                className="w-full max-w-full min-w-0 border border-slate-300 rounded-lg p-2.5 text-xs bg-white font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {poLedger.map((po) => {
                  const groups = findGroupsForPo(po.poNo, po.poSr, deemedGroups);
                  return (
                    <option
                      key={`${po.poNo}-${po.poSr}`}
                      value={`${po.poNo}___${po.poSr}`}
                    >
                      {po.poNo} (Sr {po.poSr} · Qty {po.orderedQty}) · PL {po.pl} · {po.vendorName}
                      {groups.length > 0 ? ` [Tender ${groups[0].tenderNo || 'Grp'}]` : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Distinct Dates Grid (Connected to PO Sr No) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label
                  htmlFor="scrutiny-inspection-call-date"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Inspection Call Date (Sr {activePo.poSr}) *
                </label>
                <input
                  id="scrutiny-inspection-call-date"
                  type="date"
                  required
                  value={transactionInput.inspectionCallDate}
                  onChange={(e) =>
                    onChangeTransactionInput({
                      ...transactionInput,
                      inspectionCallDate: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <div className="text-[11px] text-slate-500 mt-1 font-mono">
                  PVC Eval Month:{' '}
                  <span className="font-bold text-blue-700">
                    {transactionInput.inspectionCallDate.slice(0, 7) || '—'}
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="scrutiny-actual-supply-date"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Actual Supply Date (Sr {activePo.poSr}) *
                </label>
                <input
                  id="scrutiny-actual-supply-date"
                  type="date"
                  required
                  value={transactionInput.actualSupplyDate}
                  onChange={(e) =>
                    onChangeTransactionInput({
                      ...transactionInput,
                      actualSupplyDate: e.target.value,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <div className="text-[11px] text-slate-500 mt-1 font-mono">
                  LD Target DP:{' '}
                  <span className="font-bold text-slate-800">
                    {livePreview?.targetDpDateStr || activePo.origDp}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* PO Sr No Contract & Complete DP History Snapshot */}
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
              <div>
                <div className="text-slate-500 font-sans text-[11px]">Supplier</div>
                <div className="font-sans font-semibold text-slate-900 mt-0.5 truncate" title={activePo.vendorName}>
                  {activePo.vendorName}
                </div>
              </div>
              <div>
                <div className="text-slate-500 font-sans text-[11px]">Tender / Category</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {activeTenderNo || '—'} ·{' '}
                  <span className={activePo.category === 'Developmental' ? 'text-emerald-700' : ''}>
                    {activePo.category === 'Developmental' ? 'Dev (LD=0)' : 'Regular'}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-slate-500 font-sans text-[11px]">Original DP (Sr {activePo.poSr})</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {activePo.origDp} · Qty {activePo.orderedQty}
                </div>
              </div>
              <div>
                <div className="text-slate-500 font-sans text-[11px]">DP Amendments</div>
                <div className="font-bold text-blue-700 mt-0.5">
                  {(activePo.dpHistory || []).length} Recorded
                </div>
              </div>
            </div>

            {(activePo.dpHistory || []).length > 0 && (
              <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-1.5 font-mono text-[11px]">
                {activePo.dpHistory.map((h) => (
                  <span
                    key={h.id}
                    className="px-2 py-1 rounded bg-white border border-slate-200 text-slate-800"
                  >
                    #{h.seqNo} {h.type}: <strong>{h.dpDate}</strong> (Qty {h.applicableQty})
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Rate, CIF Value & Lag Month Inputs */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-bold text-slate-800">
                Basic Rate, CIF & Bill Parameters
              </h2>
              <span className="text-xs font-mono text-blue-700 font-semibold tabular-nums">
                Basic Excl. CIF: {formatINR(basicExclCif)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label htmlFor="tx-base-date" className="block font-semibold text-slate-700 mb-1">
                  Base Month *
                </label>
                <input
                  id="tx-base-date"
                  type="month"
                  required
                  value={transactionInput.baseDate}
                  onChange={(e) =>
                    onChangeTransactionInput({ ...transactionInput, baseDate: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
                />
              </div>

              <div>
                <label htmlFor="tx-base-rate" className="block font-semibold text-slate-700 mb-1">
                  Basic Rate Incl. CIF (₹) *
                </label>
                <input
                  id="tx-base-rate"
                  type="number"
                  step="any"
                  required
                  value={transactionInput.baseRate}
                  onChange={(e) =>
                    onChangeTransactionInput({
                      ...transactionInput,
                      baseRate: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 font-mono tabular-nums bg-white"
                />
              </div>

              <div>
                <label htmlFor="tx-cif-value" className="block font-semibold text-slate-700 mb-1">
                  CIF Value in Basic (₹)
                </label>
                <input
                  id="tx-cif-value"
                  type="number"
                  step="any"
                  min="0"
                  value={transactionInput.cifValue}
                  onChange={(e) =>
                    onChangeTransactionInput({
                      ...transactionInput,
                      cifValue: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full border border-blue-300 rounded-lg p-2 font-mono tabular-nums bg-blue-50/30"
                />
              </div>

              <div>
                <label htmlFor="tx-cif-currency" className="block font-semibold text-slate-700 mb-1">
                  CIF Currency
                </label>
                <select
                  id="tx-cif-currency"
                  value={transactionInput.cifCurrency}
                  onChange={(e) =>
                    onChangeTransactionInput({
                      ...transactionInput,
                      cifCurrency: e.target.value as CurrencyCode,
                    })
                  }
                  className="w-full border border-blue-300 rounded-lg p-2 font-mono font-semibold bg-white"
                >
                  {CURRENCY_OPTIONS.map((cur) => (
                    <option key={cur} value={cur}>
                      {cur}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="tx-cif-lag" className="block font-semibold text-slate-700 mb-1">
                  CIF FX & Duty Lag Month
                </label>
                <select
                  id="tx-cif-lag"
                  value={transactionInput.cifLagRule}
                  onChange={(e) =>
                    onChangeTransactionInput({
                      ...transactionInput,
                      cifLagRule: e.target.value as TimeLagRule,
                    })
                  }
                  className="w-full border border-blue-300 rounded-lg p-2 font-mono font-semibold bg-white"
                >
                  {TIME_LAG_OPTIONS.map((lag) => (
                    <option key={lag} value={lag}>
                      {lag}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="tx-qty" className="block font-semibold text-slate-700 mb-1">
                  Supply Qty *
                </label>
                <input
                  id="tx-qty"
                  type="number"
                  step="any"
                  min="1"
                  required
                  value={transactionInput.qty}
                  onChange={(e) =>
                    onChangeTransactionInput({
                      ...transactionInput,
                      qty: parseFloat(e.target.value) || 1,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 font-mono tabular-nums bg-white"
                />
              </div>

              <div>
                <label htmlFor="tx-freight" className="block font-semibold text-slate-700 mb-1">
                  Freight / Unit (₹)
                </label>
                <input
                  id="tx-freight"
                  type="number"
                  step="any"
                  value={transactionInput.freight}
                  onChange={(e) =>
                    onChangeTransactionInput({
                      ...transactionInput,
                      freight: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 font-mono tabular-nums bg-white"
                />
              </div>

              <div>
                <label htmlFor="tx-gst" className="block font-semibold text-slate-700 mb-1">
                  GST (%) *
                </label>
                <input
                  id="tx-gst"
                  type="number"
                  step="any"
                  required
                  value={transactionInput.gstPct}
                  onChange={(e) =>
                    onChangeTransactionInput({
                      ...transactionInput,
                      gstPct: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 font-mono tabular-nums bg-white"
                />
              </div>

              <div>
                <label htmlFor="tx-bill-ref" className="block font-semibold text-slate-700 mb-1">
                  Invoice / Bill No
                </label>
                <input
                  id="tx-bill-ref"
                  type="text"
                  value={transactionInput.billRef}
                  onChange={(e) =>
                    onChangeTransactionInput({ ...transactionInput, billRef: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
                />
              </div>

              <div className="col-span-2 sm:col-span-3">
                <label htmlFor="tx-rnote" className="block font-semibold text-slate-700 mb-1">
                  R-Note / Challan Ref
                </label>
                <input
                  id="tx-rnote"
                  type="text"
                  value={transactionInput.rNoteNo}
                  onChange={(e) =>
                    onChangeTransactionInput({ ...transactionInput, rNoteNo: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
                />
              </div>
            </div>
          </div>

          {/* Automatic Tender Group Comparison (8-Digit PO Prefix) */}
          <div className="p-4 rounded-lg bg-blue-50/50 border border-blue-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 text-xs font-bold text-slate-900">
                <input
                  id="tx-deemed-pvc-toggle"
                  type="checkbox"
                  checked={transactionInput.isDeemedPvc}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onChangeTransactionInput({
                      ...transactionInput,
                      isDeemedPvc: checked,
                      deemedGroupId:
                        transactionInput.deemedGroupId ||
                        matchingGroupsForPo[0]?.id ||
                        deemedGroups[0]?.id,
                    });
                  }}
                  className="w-4 h-4 text-blue-600 rounded border-blue-300 focus:ring-blue-600 cursor-pointer"
                />
                <label htmlFor="tx-deemed-pvc-toggle" className="cursor-pointer">
                  Tender Auto-Group Comparison (8-Digit Tender No)
                </label>
              </div>
              {activeTenderNo && (
                <span className="font-mono text-[11px] font-semibold text-blue-700">
                  Tender {activeTenderNo}
                </span>
              )}
            </div>

            {transactionInput.isDeemedPvc && (
              <div className="space-y-3 pt-2 border-t border-blue-200/80 text-xs">
                {deemedGroups.length === 0 ? (
                  <div className="text-slate-600">No active Tender Auto-Groups.</div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-700 shrink-0" />
                    <select
                      aria-label="Select Tender Auto-Group"
                      value={
                        livePreview?.activeDeemedGroup?.id ||
                        transactionInput.deemedGroupId ||
                        ''
                      }
                      onChange={(e) =>
                        onChangeTransactionInput({
                          ...transactionInput,
                          deemedGroupId: e.target.value,
                        })
                      }
                      className="flex-1 min-w-0 max-w-full border border-blue-300 rounded-lg px-2.5 py-1.5 text-xs bg-white font-semibold text-slate-900"
                    >
                      {deemedGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.memberPoKeys.length} POs)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {livePreview?.activeDeemedGroup &&
                  livePreview.deemedGroupComparisons.length > 0 && (
                    <div className="bg-white rounded-lg border border-blue-200 overflow-x-auto">
                      <table className="w-full min-w-[460px] text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                            <th className="py-2 px-3">PO No (Sr)</th>
                            <th className="py-2 px-2">Base</th>
                            <th className="py-2 px-2 text-right">Rate @ DP</th>
                            <th className="py-2 px-2 text-right">Rate @ Call</th>
                            <th className="py-2 px-3 text-right">Lowest PVC</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                          {livePreview.deemedGroupComparisons.map((entry) => (
                            <tr
                              key={entry.poKey}
                              className={
                                entry.isGroupLowest
                                  ? 'bg-emerald-50/80 font-bold text-emerald-950'
                                  : 'hover:bg-slate-50'
                              }
                            >
                              <td className="py-2 px-3 font-sans">
                                <div className="flex items-center gap-1.5">
                                  {entry.isGroupLowest && (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  )}
                                  <span className="font-mono font-semibold">
                                    {entry.poNo} (Sr {entry.poSr})
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-2 text-slate-600">{entry.baseDate}</td>
                              <td className="py-2 px-2 text-right text-slate-700">
                                {formatINR(entry.rateAtOrigDp)}
                              </td>
                              <td className="py-2 px-2 text-right text-slate-700">
                                {formatINR(entry.rateAtCallDate)}
                              </td>
                              <td className="py-2 px-3 text-right font-bold text-slate-900">
                                {formatINR(entry.lowestPoPvcRate)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* 4-Way Lower Rate PO Clause (with Available PO List, Freight & GST %) */}
          <div className="p-4 rounded-lg bg-amber-50/50 border border-amber-200/80 space-y-3">
            <div className="flex items-center gap-2.5 text-xs font-bold text-amber-950">
              <input
                id="tx-lower-rate-toggle"
                type="checkbox"
                checked={transactionInput.useLowerRate}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (checked && !transactionInput.lowerPoNo && availableLowerPos.length > 0) {
                    const first = availableLowerPos[0];
                    onChangeTransactionInput({
                      ...transactionInput,
                      useLowerRate: true,
                      lowerPoNo: first.poNo,
                      lowerBaseDate: first.baseDate,
                      lowerBaseRate: first.baseRate,
                      lowerCifValue: first.cifValue ?? 0,
                      lowerFreight: first.freight ?? 0,
                      lowerGstPct: first.gstPct ?? 18,
                    });
                  } else {
                    onChangeTransactionInput({
                      ...transactionInput,
                      useLowerRate: checked,
                    });
                  }
                }}
                className="w-4 h-4 text-amber-600 rounded border-amber-300 focus:ring-amber-600 cursor-pointer"
              />
              <label htmlFor="tx-lower-rate-toggle" className="cursor-pointer">
                Lower Rate PO Clause (incl. Freight & GST %)
              </label>
            </div>

            {transactionInput.useLowerRate && (
              <div className="space-y-3 pt-2 border-t border-amber-200/70 text-xs">
                <div>
                  <label
                    htmlFor="tx-available-lower-po"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Available POs ({availableLowerPos.length})
                  </label>
                  <select
                    id="tx-available-lower-po"
                    value={
                      availableLowerPos.find((p) => p.poNo === transactionInput.lowerPoNo)
                        ? getPoKey(
                            availableLowerPos.find((p) => p.poNo === transactionInput.lowerPoNo)!
                              .poNo,
                            availableLowerPos.find((p) => p.poNo === transactionInput.lowerPoNo)!
                              .poSr
                          )
                        : '__CUSTOM__'
                    }
                    onChange={(e) => {
                      const key = e.target.value;
                      if (key === '__CUSTOM__') return;
                      const found = availableLowerPos.find(
                        (p) => getPoKey(p.poNo, p.poSr) === key
                      );
                      if (found) {
                        onChangeTransactionInput({
                          ...transactionInput,
                          lowerPoNo: found.poNo,
                          lowerBaseDate: found.baseDate,
                          lowerBaseRate: found.baseRate,
                          lowerCifValue: found.cifValue ?? 0,
                          lowerFreight: found.freight ?? 0,
                          lowerGstPct: found.gstPct ?? 18,
                        });
                      }
                    }}
                    className="w-full border border-amber-300 rounded-lg p-2 bg-white font-mono text-xs font-semibold text-slate-900"
                  >
                    <option value="__CUSTOM__">-- Manual / Custom Lower PO --</option>
                    {availableLowerPos.map((p) => (
                      <option key={getPoKey(p.poNo, p.poSr)} value={getPoKey(p.poNo, p.poSr)}>
                        {p.poNo} (Sr {p.poSr}) · PL {p.pl} · {formatINR(p.baseRate, 0)} · Frt{' '}
                        {formatINR(p.freight, 0)} · GST {p.gstPct}%
                      </option>
                    ))}
                  </select>

                  {availableLowerPos.length > 0 && (
                    <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-amber-200 bg-white divide-y divide-slate-200">
                      {availableLowerPos.map((p) => {
                        const isSelected = p.poNo === transactionInput.lowerPoNo;
                        return (
                          <button
                            key={getPoKey(p.poNo, p.poSr)}
                            type="button"
                            onClick={() =>
                              onChangeTransactionInput({
                                ...transactionInput,
                                lowerPoNo: p.poNo,
                                lowerBaseDate: p.baseDate,
                                lowerBaseRate: p.baseRate,
                                lowerCifValue: p.cifValue ?? 0,
                                lowerFreight: p.freight ?? 0,
                                lowerGstPct: p.gstPct ?? 18,
                              })
                            }
                            className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-[11px] transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-amber-100/80 font-bold text-amber-950'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <span className="font-mono truncate">
                              {p.poNo} (Sr {p.poSr}) · PL {p.pl} · {p.vendorName}
                            </span>
                            <span className="font-mono tabular-nums shrink-0 font-semibold text-slate-900">
                              {formatINR(p.baseRate, 0)} · Frt {formatINR(p.freight, 0)} · GST{' '}
                              {p.gstPct}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="tx-lower-po" className="block font-semibold text-slate-700 mb-1">
                      Lower PO No
                    </label>
                    <input
                      id="tx-lower-po"
                      type="text"
                      value={transactionInput.lowerPoNo}
                      onChange={(e) =>
                        onChangeTransactionInput({ ...transactionInput, lowerPoNo: e.target.value })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="tx-lower-date" className="block font-semibold text-slate-700 mb-1">
                      Base Month
                    </label>
                    <input
                      id="tx-lower-date"
                      type="month"
                      value={transactionInput.lowerBaseDate}
                      onChange={(e) =>
                        onChangeTransactionInput({
                          ...transactionInput,
                          lowerBaseDate: e.target.value,
                        })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="tx-lower-rate" className="block font-semibold text-slate-700 mb-1">
                      Basic Rate (₹)
                    </label>
                    <input
                      id="tx-lower-rate"
                      type="number"
                      step="any"
                      value={transactionInput.lowerBaseRate}
                      onChange={(e) =>
                        onChangeTransactionInput({
                          ...transactionInput,
                          lowerBaseRate: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="tx-lower-cif" className="block font-semibold text-slate-700 mb-1">
                      CIF Value (₹)
                    </label>
                    <input
                      id="tx-lower-cif"
                      type="number"
                      step="any"
                      min="0"
                      value={transactionInput.lowerCifValue ?? 0}
                      onChange={(e) =>
                        onChangeTransactionInput({
                          ...transactionInput,
                          lowerCifValue: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 bg-white font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="tx-lower-freight" className="block font-semibold text-slate-700 mb-1">
                      Lower Freight / Unit (₹)
                    </label>
                    <input
                      id="tx-lower-freight"
                      type="number"
                      step="any"
                      min="0"
                      value={transactionInput.lowerFreight ?? 0}
                      onChange={(e) =>
                        onChangeTransactionInput({
                          ...transactionInput,
                          lowerFreight: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full border border-amber-300 rounded-lg p-2 bg-white font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="tx-lower-gst" className="block font-semibold text-slate-700 mb-1">
                      Lower GST (%)
                    </label>
                    <input
                      id="tx-lower-gst"
                      type="number"
                      step="any"
                      min="0"
                      value={transactionInput.lowerGstPct ?? 18}
                      onChange={(e) =>
                        onChangeTransactionInput({
                          ...transactionInput,
                          lowerGstPct: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full border border-amber-300 rounded-lg p-2 bg-white font-mono tabular-nums"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              className="w-full sm:w-auto px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <FileCheck2 className="w-4 h-4" />
              Generate Audit Statement
            </button>
          </div>
        </form>

        {/* Right Column (5 cols): Clear, Easy-to-Understand Output Panel */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
          {livePreview && selectedCif && (
            <>
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-blue-600" />
                  <h2 className="text-sm font-bold text-slate-900">PVC & Payable Output</h2>
                </div>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {livePreview.matrix.length} Scenarios
                </span>
              </div>

              {/* Governing Final Rate & Net Payable Card */}
              <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="truncate" title={livePreview.selectedScenario.desc}>
                    {livePreview.selectedScenario.desc}
                  </span>
                  <span className="font-mono text-emerald-400 font-semibold shrink-0">
                    PV {livePreview.selectedScenario.pvFactor.toFixed(4)}
                  </span>
                </div>

                {/* Clear 2-Part Split Addition Visual */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-lg bg-slate-800/80 font-mono tabular-nums text-xs">
                  <div>
                    <div className="text-[11px] font-sans text-slate-400">
                      1. Basic Excl. CIF PVC
                    </div>
                    <div className="font-bold text-white mt-0.5">
                      {formatINR(selectedCif.indigenousCalculatedRate)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {formatINR(selectedCif.indigenousBaseRate)} × {selectedCif.indigenousPvFactor.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-sans text-slate-400">
                      2. CIF PVC ({selectedCif.cifCurrency} · {selectedCif.cifLagRule})
                    </div>
                    <div className="font-bold text-sky-300 mt-0.5">
                      + {formatINR(selectedCif.cifCalculatedRate)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      FX {selectedCif.erRatio.toFixed(4)} · Duty {selectedCif.edRatio.toFixed(4)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-800 font-mono tabular-nums">
                  <div>
                    <div className="text-[11px] font-sans text-slate-400">
                      Final Passed PVC Rate (1 + 2)
                    </div>
                    <div className="text-lg font-bold text-white mt-0.5">
                      {formatINR(livePreview.lowestRate)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Landed {formatINR(livePreview.selectedScenario.landedUnitRate)} / unit
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-sans text-slate-400">
                      Net Payable ({livePreview.input.qty} {activeItem.unit || 'Units'})
                    </div>
                    <div className="text-lg font-bold text-emerald-400 mt-0.5">
                      {formatINR(livePreview.netPayable)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Frt {formatINR(livePreview.appliedFreight, 0)} · GST {livePreview.appliedGstPct}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Evaluated Scenarios Table (incl. DP History & Landed Unit Rate) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                  <span className="flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5 text-blue-600" />
                    Evaluated Scenarios
                  </span>
                  <span className="text-slate-500 font-normal">Lowest Landed Selected</span>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full min-w-[400px] text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="text-slate-500 font-semibold border-b border-slate-200">
                        <th className="py-2 px-2.5">Clause</th>
                        <th className="py-2 px-2">Period</th>
                        <th className="py-2 px-2 text-right">PVC Rate</th>
                        <th className="py-2 px-2.5 text-right">Landed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                      {livePreview.matrix.map((m) => {
                        const isSelected = m.id === livePreview.selectedScenario.id;
                        return (
                          <tr
                            key={m.id}
                            className={
                              isSelected
                                ? 'bg-blue-50/80 font-bold text-blue-950'
                                : 'text-slate-700'
                            }
                          >
                            <td className="py-2 px-2.5 font-sans">
                              <div className="flex items-center gap-1.5">
                                {isSelected && (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                )}
                                <span className="truncate max-w-[140px]" title={m.desc}>
                                  {m.clauseTag}
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-2 text-slate-500 whitespace-nowrap">
                              {m.baseM} → {m.evalM}
                            </td>
                            <td className="py-2 px-2 text-right whitespace-nowrap">
                              {formatINR(m.rate)}
                            </td>
                            <td className="py-2 px-2.5 text-right whitespace-nowrap font-semibold">
                              {formatINR(m.landedUnitRate)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bill & LD Summary */}
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs font-mono tabular-nums">
                <div className="flex items-center justify-between font-sans font-semibold border-b border-slate-200 pb-2">
                  <span className="flex items-center gap-1.5 text-slate-800">
                    <Calendar className="w-3.5 h-3.5 text-slate-600" />
                    Bill & LD Summary
                  </span>
                  <span
                    className={
                      livePreview.ldAmount > 0 ? 'text-amber-700' : 'text-emerald-700'
                    }
                  >
                    {livePreview.ldAmount > 0
                      ? `LD ${livePreview.ldPct}% (${livePreview.exactDelayDays}d)`
                      : 'LD Nil'}
                  </span>
                </div>

                <div className="space-y-1 text-slate-700">
                  <div className="flex justify-between">
                    <span className="font-sans">
                      Passed Basic ({livePreview.input.qty} × {formatINR(livePreview.lowestRate)}):
                    </span>
                    <span>{formatINR(livePreview.passedBasicValue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans">
                      Freight ({livePreview.input.qty} × {formatINR(livePreview.appliedFreight)}):
                    </span>
                    <span>{formatINR(livePreview.freightTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans">GST ({livePreview.appliedGstPct}%):</span>
                    <span>{formatINR(livePreview.gstAmount)}</span>
                  </div>
                  <div className="flex justify-between text-amber-700">
                    <span className="font-sans">Less LD:</span>
                    <span>- {formatINR(livePreview.ldAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-1.5 border-t border-slate-200 font-bold text-slate-900 text-sm">
                    <span className="font-sans">Net Payable:</span>
                    <span>{formatINR(livePreview.netPayable)}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onGenerateReport(livePreview)}
                className="w-full py-2.5 px-4 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileCheck2 className="w-4 h-4" />
                Open Formal Audit Statement
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
