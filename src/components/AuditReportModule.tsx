import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookmarkCheck,
  CheckCircle2,
  Download,
  History,
  Printer,
  Trash2,
} from 'lucide-react';
import { ScrutinyReportResult } from '../types/pvc';
import { escapeCsvCell } from '../utils/navigation';
import { formatINR } from '../utils/pvcEngine';

interface AuditReportModuleProps {
  report: ScrutinyReportResult;
  savedReports: ScrutinyReportResult[];
  onSaveReportToRegister: (report: ScrutinyReportResult) => void;
  onSelectSavedReport: (report: ScrutinyReportResult) => void;
  onDeleteSavedReport: (id: string) => void;
  onBackToTransaction: () => void;
  onNotify: (msg: string, type?: 'success' | 'warning' | 'error') => void;
}

export const AuditReportModule: React.FC<AuditReportModuleProps> = ({
  report,
  savedReports,
  onSaveReportToRegister,
  onSelectSavedReport,
  onDeleteSavedReport,
  onBackToTransaction,
  onNotify,
}) => {
  const [inspectedScenarioId, setInspectedScenarioId] = useState<string>(
    report.selectedScenario.id
  );

  // Sync inspected scenario whenever a different report is loaded or generated
  useEffect(() => {
    setInspectedScenarioId(report.selectedScenario.id);
  }, [report]);

  const inspectedScenario =
    report.matrix.find((m) => m.id === inspectedScenarioId) || report.selectedScenario;

  const inspectedCif = inspectedScenario.cifBreakdown;
  const selectedCif = report.selectedScenario.cifBreakdown;
  const isSavedInRegister = savedReports.some((r) => r.id === report.id);

  const handlePrint = () => {
    try {
      window.print();
    } catch {
      // Fallback when iframe blocks print
    }
    onNotify('Print dialog triggered.', 'success');
  };

  const handleDownloadPrintableHtml = () => {
    const printEl = document.getElementById('printable-scrutiny-statement');
    if (!printEl) return;
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>CLW PVC Scrutiny Statement - ${report.po.poNo}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background: #fff; color: #0f172a; padding: 24px; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; }
    .no-print { display: none !important; }
  </style>
</head>
<body onload="window.print()">
  <div class="max-w-5xl mx-auto">${printEl.innerHTML}</div>
</body>
</html>`;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CLW_Scrutiny_Statement_${report.po.poNo}_Sr${report.po.poSr}.html`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify('Downloaded printable HTML statement.', 'success');
  };

  const handleExportStatementCsv = () => {
    const lines: string[] = [];
    lines.push('CHITTARANJAN LOCOMOTIVE WORKS - STORES ACCOUNTS & VIGILANCE PVC SCRUTINY STATEMENT');
    lines.push(
      ['Statement ID', report.id, 'Date', new Date(report.createdAt).toLocaleDateString('en-IN')]
        .map(escapeCsvCell)
        .join(',')
    );
    lines.push(
      ['PO Number', report.po.poNo, 'PO Sr', report.po.poSr, 'PL Number', report.item.pl]
        .map(escapeCsvCell)
        .join(',')
    );
    lines.push(
      ['Vendor', report.po.vendorName, 'Category', report.po.category].map(escapeCsvCell).join(',')
    );
    lines.push(
      [
        'Base Month',
        report.input.baseDate,
        'Basic Rate Incl. CIF',
        report.input.baseRate,
        'CIF Value',
        report.input.cifValue,
        'Inspection Call Date',
        report.input.inspectionCallDate,
        'Actual Supply Date',
        report.input.actualSupplyDate,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
    lines.push('');
    lines.push('COMPARATIVE SCENARIO MATRIX');
    lines.push(
      'Scenario,Base Month,Eval Month,Basic Rate,CIF Value,Ind PVC Rate,CIF PVC Rate,Total PVC Rate,Freight,GST %,Landed Unit Rate,Status'
    );
    report.matrix.forEach((m) => {
      const isSelected = m.id === report.selectedScenario.id;
      lines.push(
        [
          m.desc,
          m.baseM,
          m.evalM,
          m.inputBaseRate.toFixed(2),
          m.cifBreakdown.cifValue.toFixed(2),
          m.cifBreakdown.indigenousCalculatedRate.toFixed(2),
          m.cifBreakdown.cifCalculatedRate.toFixed(2),
          m.rate.toFixed(2),
          m.applicableFreight.toFixed(2),
          m.applicableGstPct.toFixed(2),
          m.landedUnitRate.toFixed(2),
          isSelected ? 'SELECTED LOWEST' : 'Evaluated',
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    });
    lines.push('');
    lines.push(`COMPONENT BREAKDOWN: ${inspectedScenario.desc}`);
    lines.push('Component,Weight,Lag,Lag Base,I0,Lag Eval,I1,Ratio,Weighted');
    inspectedScenario.breakdown.forEach((b) => {
      lines.push(
        [
          b.name,
          b.weight.toFixed(4),
          b.timelag,
          b.lagBase,
          b.baseIdxVal,
          b.lagEval,
          b.evalIdxVal,
          b.ratio.toFixed(6),
          b.weightedRatio.toFixed(6),
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    });
    lines.push('');
    lines.push('CIF FX & EXCISE DUTY BREAKDOWN');
    lines.push(
      [
        'CIF Value',
        inspectedCif.cifValue.toFixed(2),
        'Currency',
        inspectedCif.cifCurrency,
        'Lag',
        inspectedCif.cifLagRule,
        'ER0',
        inspectedCif.baseExchangeRate,
        'ER1',
        inspectedCif.evalExchangeRate,
        'ED0%',
        inspectedCif.baseExciseDutyPct,
        'ED1%',
        inspectedCif.evalExciseDutyPct,
        'CIF PVC Rate',
        inspectedCif.cifCalculatedRate.toFixed(2),
      ]
        .map(escapeCsvCell)
        .join(',')
    );
    lines.push('');
    lines.push('FINANCIAL SUMMARY');
    lines.push(`Passed PVC Unit Rate,${report.lowestRate.toFixed(2)}`);
    lines.push(`Quantity,${report.input.qty}`);
    lines.push(`Passed Basic Value,${report.passedBasicValue.toFixed(2)}`);
    lines.push(`Applied Freight/Unit,${report.appliedFreight.toFixed(2)}`);
    lines.push(`Freight Total,${report.freightTotal.toFixed(2)}`);
    lines.push(`GST (${report.appliedGstPct}%),${report.gstAmount.toFixed(2)}`);
    lines.push(`LD Deduction (${report.ldPct}%),${report.ldAmount.toFixed(2)}`);
    lines.push(`Net Payable,${report.netPayable.toFixed(2)}`);

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CLW_Scrutiny_Statement_${report.po.poNo}_Sr${report.po.poSr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify('Exported Scrutiny Statement CSV.', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-xl border border-slate-200">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
            04. Official Audit Scrutiny Statement
          </h1>
          <span className="hidden sm:inline text-xs font-mono text-slate-500 tabular-nums shrink-0">
            {report.id}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onBackToTransaction}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Modify Inputs
          </button>

          <button
            type="button"
            onClick={() => onSaveReportToRegister(report)}
            disabled={isSavedInRegister}
            className={`px-3 py-2 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap ${
              isSavedInRegister
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
            }`}
          >
            <BookmarkCheck className="w-3.5 h-3.5" />
            {isSavedInRegister ? 'Logged' : 'Log to Register'}
          </button>

          <button
            type="button"
            onClick={handleExportStatementCsv}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>

          <button
            type="button"
            onClick={handleDownloadPrintableHtml}
            className="px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            HTML
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / PDF
          </button>
        </div>
      </div>

      {/* Printable Official Scrutiny Document */}
      <div
        id="printable-scrutiny-statement"
        className="print-container bg-white rounded-xl border border-slate-200 p-5 sm:p-8 space-y-6"
      >
        {/* Institutional Masthead */}
        <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-blue-700 tracking-wide">
              INDIAN RAILWAYS · STORES ACCOUNTS & VIGILANCE
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight mt-0.5">
              CHITTARANJAN LOCOMOTIVE WORKS (CLW)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              PVC (Indigenous + CIF FX/Excise Duty) & Liquidated Damages Scrutiny Statement
            </p>
          </div>

          <div className="sm:text-right font-mono text-xs text-slate-600 tabular-nums space-y-0.5">
            <div>
              Ref: <span className="font-bold text-slate-900">{report.id}</span>
            </div>
            <div>Date: {new Date(report.createdAt).toLocaleDateString('en-IN')}</div>
            <div>
              {report.input.billRef || 'N/A'} · {report.input.rNoteNo || 'N/A'}
            </div>
          </div>
        </div>

        {/* Contract & Dual Date Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono tabular-nums">
          <div>
            <div className="text-slate-500 font-sans">PO Number & Sr</div>
            <div className="font-bold text-slate-900 mt-0.5">
              {report.po.poNo} (Sr {report.po.poSr})
            </div>
          </div>
          <div>
            <div className="text-slate-500 font-sans">PL Number & Qty</div>
            <div className="font-bold text-blue-700 mt-0.5">
              PL {report.item.pl} ({report.input.qty} {report.item.unit || 'Set'})
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-slate-500 font-sans">Item & Supplier</div>
            <div className="font-sans font-semibold text-slate-900 mt-0.5 truncate">
              {report.item.name} — {report.po.vendorName}
            </div>
          </div>
          <div>
            <div className="text-slate-500 font-sans">Base Month & Basic Rate</div>
            <div className="font-semibold text-slate-900 mt-0.5">
              {report.input.baseDate} · {formatINR(report.input.baseRate)}
            </div>
          </div>
          <div>
            <div className="text-slate-500 font-sans">CIF Included in Basic</div>
            <div className="font-semibold text-blue-700 mt-0.5">
              {formatINR(report.input.cifValue)} ({report.input.cifCurrency} · {report.input.cifLagRule})
            </div>
          </div>
          <div>
            <div className="text-slate-500 font-sans">Inspection Call Date</div>
            <div className="font-bold text-slate-900 mt-0.5">
              {report.input.inspectionCallDate} ({report.callDateMonthNorm})
            </div>
          </div>
          <div>
            <div className="text-slate-500 font-sans">Actual Supply Date</div>
            <div className="font-bold text-slate-900 mt-0.5">
              {report.input.actualSupplyDate} (DP: {report.targetDpDateStr})
            </div>
          </div>
          {(report.po.dpHistory || []).length > 0 && (
            <div className="col-span-2 sm:col-span-4 pt-2 border-t border-slate-200">
              <div className="text-slate-500 font-sans mb-1">
                PO Sr {report.po.poSr} DP Refixation / Extension History (Specific Qty):
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                  Orig DP: <strong>{report.po.origDp}</strong> (Qty {report.po.orderedQty})
                </span>
                {report.po.dpHistory.map((h) => (
                  <span
                    key={h.id}
                    className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-800"
                  >
                    #{h.seqNo} {h.type}: <strong>{h.dpDate}</strong> (Qty {h.applicableQty})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Clear 4-Column Executive KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 font-mono tabular-nums">
            <div className="text-xs font-sans font-semibold text-slate-500">
              1. Indigenous PVC (Excl. CIF)
            </div>
            <div className="text-lg font-bold text-slate-900 mt-1">
              {formatINR(selectedCif.indigenousCalculatedRate)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Base {formatINR(selectedCif.indigenousBaseRate)} × {selectedCif.indigenousPvFactor.toFixed(4)}
            </div>
          </div>

          <div className="p-4 rounded-lg bg-blue-50/60 border border-blue-200 font-mono tabular-nums">
            <div className="text-xs font-sans font-semibold text-blue-800">
              2. CIF PVC ({selectedCif.cifCurrency} · {selectedCif.cifLagRule})
            </div>
            <div className="text-lg font-bold text-blue-900 mt-1">
              + {formatINR(selectedCif.cifCalculatedRate)}
            </div>
            <div className="text-[11px] text-blue-700 mt-0.5">
              FX {selectedCif.erRatio.toFixed(4)} × Duty {selectedCif.edRatio.toFixed(4)}
            </div>
          </div>

          <div className="p-4 rounded-lg bg-slate-900 text-white font-mono tabular-nums">
            <div className="text-xs font-sans font-semibold text-slate-300">
              Final Passed PVC Rate (1 + 2)
            </div>
            <div className="text-lg font-bold text-white mt-1">
              {formatINR(report.lowestRate)}
            </div>
            <div className="text-[11px] text-amber-300 mt-0.5">
              LD: {report.ldAmount > 0 ? `${formatINR(report.ldAmount)} (${report.ldPct}%)` : 'Exempt / Nil'}
            </div>
          </div>

          <div className="p-4 rounded-lg bg-emerald-50/70 border border-emerald-200 font-mono tabular-nums">
            <div className="text-xs font-sans font-semibold text-emerald-800">
              Final Net Payable
            </div>
            <div className="text-xl font-extrabold text-emerald-900 mt-1">
              {formatINR(report.netPayable)}
            </div>
            <div className="text-[11px] text-emerald-700 mt-0.5">
              {report.input.qty} {report.item.unit || 'Units'} incl. Freight & GST
            </div>
          </div>
        </div>

        {/* Deemed PVC PO Group Multi-PO Comparison (when active) */}
        {report.input.isDeemedPvc &&
          report.activeDeemedGroup &&
          report.deemedGroupComparisons.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-blue-900">
                Deemed PVC Group Comparison — {report.activeDeemedGroup.name} (
                {report.deemedGroupComparisons.length} POs)
              </h3>
              <div className="overflow-x-auto border border-blue-200 rounded-lg">
                <table className="w-full min-w-[680px] text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-blue-50/70 text-slate-700 font-semibold border-b border-blue-200">
                      <th className="py-2.5 px-3.5">PO No</th>
                      <th className="py-2.5 px-3">Supplier</th>
                      <th className="py-2.5 px-3">Base</th>
                      <th className="py-2.5 px-3 text-right">Basic Rate</th>
                      <th className="py-2.5 px-3 text-right">Rate @ DP</th>
                      <th className="py-2.5 px-3 text-right">Rate @ Call</th>
                      <th className="py-2.5 px-3.5 text-right">Lowest PVC</th>
                      <th className="py-2.5 px-3.5 text-right">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                    {report.deemedGroupComparisons.map((c) => {
                      const isGroupLowest =
                        c.isGroupLowest || Math.abs(c.lowestPoPvcRate - report.lowestRate) < 0.005;
                      const diff = c.lowestPoPvcRate - report.lowestRate;
                      return (
                        <tr
                          key={c.poKey}
                          className={isGroupLowest ? 'bg-blue-50/80 font-semibold' : ''}
                        >
                          <td className="py-2.5 px-3.5 text-slate-900 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isGroupLowest && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              )}
                              <span>
                                {c.poNo} ({c.poSr})
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">{c.vendorName}</td>
                          <td className="py-2.5 px-3 text-slate-700">{c.baseDate}</td>
                          <td className="py-2.5 px-3 text-right text-slate-600">
                            {formatINR(c.baseRate)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-700">
                            {formatINR(c.rateAtOrigDp)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-700">
                            {formatINR(c.rateAtCallDate)}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-bold text-slate-900">
                            {formatINR(c.lowestPoPvcRate)}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-sans">
                            {isGroupLowest ? (
                              <span className="font-bold text-blue-700">Selected Lowest</span>
                            ) : (
                              <span className="font-mono text-slate-500">+{formatINR(diff)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        {/* 01. Comparative Scenario Matrix */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-900">
            01. Comparative Scenario Matrix
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[820px] text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3.5">Scenario</th>
                  <th className="py-2.5 px-3">Period</th>
                  <th className="py-2.5 px-3 text-right">Ind. PVC (₹)</th>
                  <th className="py-2.5 px-3 text-right">CIF PVC (₹)</th>
                  <th className="py-2.5 px-3 text-right">PVC Rate (₹)</th>
                  <th className="py-2.5 px-3 text-right">Frt / GST</th>
                  <th className="py-2.5 px-3 text-right">Landed (₹)</th>
                  <th className="py-2.5 px-3">LD</th>
                  <th className="py-2.5 px-3.5 text-right">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                {report.matrix.map((m) => {
                  const isLowest = m.id === report.selectedScenario.id;
                  const isInspected = m.id === inspectedScenario.id;
                  const diffFromLowest = m.landedUnitRate - report.selectedScenario.landedUnitRate;
                  return (
                    <tr
                      key={m.id}
                      onClick={() => setInspectedScenarioId(m.id)}
                      className={`transition-colors cursor-pointer ${
                        isLowest
                          ? 'bg-blue-50/70 font-semibold'
                          : isInspected
                            ? 'bg-slate-100/80'
                            : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 px-3.5 font-sans text-slate-900">
                        <div className="flex items-center gap-1.5">
                          {isLowest && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          )}
                          <span>{m.desc}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                        {m.baseM} → {m.evalM}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {formatINR(m.cifBreakdown.indigenousCalculatedRate)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-blue-700">
                        {formatINR(m.cifBreakdown.cifCalculatedRate)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                        {formatINR(m.rate)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 whitespace-nowrap">
                        {formatINR(m.applicableFreight, 0)} / {m.applicableGstPct}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                        {formatINR(m.landedUnitRate)}
                      </td>
                      <td className="py-2.5 px-3 font-sans">
                        {m.ldApplicable ? (
                          <span className="text-amber-700 font-semibold">Yes</span>
                        ) : (
                          <span className="text-slate-500">Nil</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-sans">
                        {isLowest ? (
                          <span className="font-bold text-blue-700">Selected Lowest</span>
                        ) : (
                          <span className="text-slate-500 font-mono">
                            +{formatINR(diffFromLowest)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 02A. Indigenous Component Index Verification */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-900">
              02A. Indigenous PVC (Basic Excl. CIF) —{' '}
              <span className="text-blue-700">{inspectedScenario.desc}</span>
            </h3>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {inspectedScenario.baseM} → {inspectedScenario.evalM}
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[700px] text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3.5">Component</th>
                  <th className="py-2.5 px-3 text-right">Weight</th>
                  <th className="py-2.5 px-3">Lag</th>
                  <th className="py-2.5 px-3">Base Mo</th>
                  <th className="py-2.5 px-3 text-right">I₀</th>
                  <th className="py-2.5 px-3">Eval Mo</th>
                  <th className="py-2.5 px-3 text-right">I₁</th>
                  <th className="py-2.5 px-3 text-right">I₁/I₀</th>
                  <th className="py-2.5 px-3.5 text-right">Weighted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                {inspectedScenario.breakdown.map((b) => (
                  <tr key={b.name}>
                    <td className="py-2 px-3.5 font-sans font-semibold text-slate-900">
                      {b.name}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700">
                      {(b.weight * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 px-3 text-blue-700 font-semibold">{b.timelag}</td>
                    <td className="py-2 px-3 text-slate-600">{b.lagBase}</td>
                    <td className="py-2 px-3 text-right text-slate-900">
                      {b.baseIdxVal.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-slate-600">{b.lagEval}</td>
                    <td className="py-2 px-3 text-right text-slate-900">
                      {b.evalIdxVal.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700">
                      {b.ratio.toFixed(4)}
                    </td>
                    <td className="py-2 px-3.5 text-right font-bold text-slate-900">
                      {b.weightedRatio.toFixed(4)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold text-slate-900 border-t border-slate-300">
                  <td colSpan={7} className="py-2.5 px-3.5 font-sans">
                    Indigenous PVC Rate = {formatINR(inspectedCif.indigenousBaseRate)} ×{' '}
                    {inspectedCif.indigenousPvFactor.toFixed(4)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-blue-700">
                    {inspectedCif.indigenousPvFactor.toFixed(4)}
                  </td>
                  <td className="py-2.5 px-3.5 text-right text-blue-700">
                    {formatINR(inspectedCif.indigenousCalculatedRate)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 02B. CIF Exchange Rate & Excise Duty Verification */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-900">
            02B. CIF Value PVC (Exchange Rate & Excise Duty · Lag {inspectedCif.cifLagRule})
          </h3>
          <div className="overflow-x-auto border border-blue-200 rounded-lg">
            <table className="w-full min-w-[640px] text-left border-collapse text-xs font-mono tabular-nums">
              <thead>
                <tr className="bg-blue-50/60 text-slate-700 font-semibold border-b border-blue-200 font-sans">
                  <th className="py-2.5 px-3.5">CIF Base (₹)</th>
                  <th className="py-2.5 px-3">Lag Months</th>
                  <th className="py-2.5 px-3 text-right">FX ({inspectedCif.cifCurrency}) Base → Eval</th>
                  <th className="py-2.5 px-3 text-right">FX Ratio</th>
                  <th className="py-2.5 px-3 text-right">Rate of Duty % Base → Eval</th>
                  <th className="py-2.5 px-3 text-right">Duty Ratio</th>
                  <th className="py-2.5 px-3.5 text-right">CIF PVC Rate (₹)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-white">
                  <td className="py-2.5 px-3.5 font-bold text-slate-900">
                    {formatINR(inspectedCif.cifValue)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">
                    {inspectedCif.lagBaseMonth} → {inspectedCif.lagEvalMonth}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-800">
                    {inspectedCif.baseExchangeRate.toFixed(2)} → {inspectedCif.evalExchangeRate.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-blue-700 font-semibold">
                    {inspectedCif.erRatio.toFixed(4)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-800">
                    {inspectedCif.baseExciseDutyPct.toFixed(2)}% → {inspectedCif.evalExciseDutyPct.toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-blue-700 font-semibold">
                    {inspectedCif.edRatio.toFixed(4)}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-bold text-blue-800">
                    {formatINR(inspectedCif.cifCalculatedRate)}
                  </td>
                </tr>
                <tr className="bg-slate-50 font-bold border-t border-slate-200">
                  <td colSpan={6} className="py-2.5 px-3.5 font-sans text-slate-900">
                    Final Combined PVC Unit Rate = {formatINR(inspectedCif.indigenousCalculatedRate)} (Ind.) +{' '}
                    {formatINR(inspectedCif.cifCalculatedRate)} (CIF)
                  </td>
                  <td className="py-2.5 px-3.5 text-right text-slate-900">
                    {formatINR(inspectedScenario.rate)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 03. Financial Bill Passing & LD Breakdown */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-900">
            03. Financial Bill Passing & LD Computation
          </h3>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs font-mono tabular-nums">
            <div className="flex justify-between gap-4 py-1.5 border-b border-slate-200 text-slate-600">
              <span className="font-sans">
                Original Base Value ({formatINR(report.input.baseRate)} × {report.input.qty}):
              </span>
              <span className="shrink-0">{formatINR(report.baseTotalValue)}</span>
            </div>
            <div className="flex justify-between gap-4 py-1.5 border-b border-slate-200 text-slate-900 font-semibold">
              <span className="font-sans">
                Passed PVC Basic ({formatINR(report.lowestRate)} × {report.input.qty}):
              </span>
              <span className="shrink-0">{formatINR(report.passedBasicValue)}</span>
            </div>
            <div className="flex justify-between gap-4 py-1.5 border-b border-slate-200 text-slate-600">
              <span className="font-sans">Net PVC Impact:</span>
              <span
                className={`shrink-0 ${
                  report.netPvcVariationTotal >= 0 ? 'text-blue-700' : 'text-emerald-700'
                }`}
              >
                {report.netPvcVariationTotal >= 0 ? '+' : ''}
                {formatINR(report.netPvcVariationTotal)}
              </span>
            </div>
            <div className="flex justify-between gap-4 py-1.5 border-b border-slate-200 text-slate-700">
              <span className="font-sans">
                Freight ({formatINR(report.appliedFreight)} × {report.input.qty}):
              </span>
              <span className="shrink-0">{formatINR(report.freightTotal)}</span>
            </div>
            <div className="flex justify-between gap-4 py-1.5 border-b border-slate-200 font-bold text-slate-900">
              <span className="font-sans">Taxable Subtotal:</span>
              <span className="shrink-0">{formatINR(report.subtotalBeforeGst)}</span>
            </div>
            <div className="flex justify-between gap-4 py-1.5 border-b border-slate-200 text-slate-700">
              <span className="font-sans">GST ({report.appliedGstPct}%):</span>
              <span className="shrink-0">+ {formatINR(report.gstAmount)}</span>
            </div>
            <div className="flex justify-between gap-4 py-1.5 border-b border-slate-200 text-amber-800">
              <span className="font-sans">
                Less LD{' '}
                {report.ldExemptionReason
                  ? `(${report.ldExemptionReason})`
                  : `(${report.exactDelayDays}d delay, ${report.ldWeeks} wks @ 0.5% = ${report.ldPct}%)`}
                :
              </span>
              <span className="font-bold shrink-0">- {formatINR(report.ldAmount)}</span>
            </div>
            <div className="flex justify-between gap-4 py-2.5 px-3 rounded-lg bg-emerald-100/70 text-emerald-950 font-extrabold text-sm">
              <span className="font-sans">Final Net Payable:</span>
              <span className="shrink-0">{formatINR(report.netPayable)}</span>
            </div>
          </div>
        </div>

        {/* Sign-Off Block */}
        <div className="pt-8 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs text-slate-600">
          <div>
            <p className="font-bold text-slate-800">Prepared & Verified By:</p>
            <div className="h-10" />
            <p className="border-t border-slate-300 pt-1.5 font-semibold text-slate-800">
              Chief Vigilance Inspector / Sr. ISA
            </p>
          </div>
          <div>
            <p className="font-bold text-slate-800">Scrutinized By:</p>
            <div className="h-10" />
            <p className="border-t border-slate-300 pt-1.5 font-semibold text-slate-800">
              Jr. Accounts Officer (Stores)
            </p>
          </div>
          <div className="sm:text-right">
            <p className="font-bold text-slate-800">Approved By:</p>
            <div className="h-10" />
            <p className="border-t border-slate-300 pt-1.5 font-semibold text-slate-800">
              Dy. CAO / FA&CAO (CLW)
            </p>
          </div>
        </div>
      </div>

      {/* Saved Audit Register */}
      <div className="no-print bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <History className="w-4 h-4 text-blue-600" />
            <span>Saved Audit Register</span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-500 tabular-nums">
              {savedReports.length} Logged
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[740px] text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/70 text-slate-500 font-semibold border-b border-slate-200">
                <th className="py-2.5 px-4">Statement ID</th>
                <th className="py-2.5 px-4">PO No</th>
                <th className="py-2.5 px-4">PL</th>
                <th className="py-2.5 px-4">Call / Supply</th>
                <th className="py-2.5 px-4 text-right">Passed Rate</th>
                <th className="py-2.5 px-4 text-right">LD</th>
                <th className="py-2.5 px-4 text-right">Net Payable</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
              {savedReports.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500 font-sans">
                    No statements logged.
                  </td>
                </tr>
              ) : (
                savedReports.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => onSelectSavedReport(r)}
                    className={`cursor-pointer transition-colors ${
                      r.id === report.id ? 'bg-blue-50/60 font-semibold' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2.5 px-4 text-slate-900">{r.id}</td>
                    <td className="py-2.5 px-4 text-slate-800">
                      {r.po.poNo} ({r.po.poSr})
                    </td>
                    <td className="py-2.5 px-4 text-blue-700">{r.item.pl}</td>
                    <td className="py-2.5 px-4 text-slate-600">
                      {r.input.inspectionCallDate} / {r.input.actualSupplyDate}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-900">
                      {formatINR(r.lowestRate)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-amber-700">
                      {formatINR(r.ldAmount)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold text-emerald-800">
                      {formatINR(r.netPayable)}
                    </td>
                    <td
                      className="py-2.5 px-4 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onDeleteSavedReport(r.id)}
                        aria-label={`Delete statement ${r.id}`}
                        className="p-1 text-slate-400 hover:text-red-600 rounded-md cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
