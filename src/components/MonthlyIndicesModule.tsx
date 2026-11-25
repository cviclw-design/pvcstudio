import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarSearch,
  Download,
  Edit3,
  FileUp,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import {
  DEFAULT_EXCHANGE_RATES,
  DEFAULT_EXCISE_DUTY_PCT,
  FOREIGN_CURRENCIES,
} from '../data/initialData';
import {
  CurrencyCode,
  ExchangeRatesByCurrency,
  ForeignCurrencyCode,
  ItemMonthlyIndicesMap,
  MonthlyIndexEntry,
  PLItem,
  TimeLagRule,
} from '../types/pvc';
import { escapeCsvCell } from '../utils/navigation';
import {
  resolveCurrencyExchangeRate,
  resolveLaggedMonthForComponent,
} from '../utils/pvcEngine';

interface MonthlyIndicesModuleProps {
  itemsMaster: PLItem[];
  itemMonthlyIndices: ItemMonthlyIndicesMap;
  selectedPl: string;
  onSelectPl: (pl: string) => void;
  onSaveMonthlyIndex: (pl: string, month: string, entry: MonthlyIndexEntry) => void;
  onDeleteMonthlyIndex: (pl: string, month: string) => void;
  onNotify: (msg: string, type?: 'success' | 'warning' | 'error') => void;
}

const TIME_LAG_OPTIONS: TimeLagRule[] = ['M-0', 'M-1', 'M-2', 'M-3', 'M-4'];
const INSPECTOR_CURRENCIES: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'INR'];

export const MonthlyIndicesModule: React.FC<MonthlyIndicesModuleProps> = ({
  itemsMaster,
  itemMonthlyIndices,
  selectedPl,
  onSelectPl,
  onSaveMonthlyIndex,
  onDeleteMonthlyIndex,
  onNotify,
}) => {
  const [monthInput, setMonthInput] = useState<string>('2026-04');
  const [sourceInput, setSourceInput] = useState<string>('IEEMA Circular Apr-26');
  const [compValues, setCompValues] = useState<Record<string, string>>({});
  const [fxValues, setFxValues] = useState<Record<ForeignCurrencyCode, string>>({
    USD: String(DEFAULT_EXCHANGE_RATES.USD),
    EUR: String(DEFAULT_EXCHANGE_RATES.EUR),
    GBP: String(DEFAULT_EXCHANGE_RATES.GBP),
    JPY: String(DEFAULT_EXCHANGE_RATES.JPY),
    CHF: String(DEFAULT_EXCHANGE_RATES.CHF),
  });
  const [rateOfDutyInput, setRateOfDutyInput] = useState<string>(
    String(DEFAULT_EXCISE_DUTY_PCT)
  );

  // Time-Lag Inspector State
  const [inspectorEvalMonth, setInspectorEvalMonth] = useState<string>('2026-03');
  const [inspectorCifCurrency, setInspectorCifCurrency] = useState<CurrencyCode>('EUR');
  const [inspectorCifLag, setInspectorCifLag] = useState<TimeLagRule>('M-1');

  // Circular Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadMonth, setUploadMonth] = useState('2026-04');
  const [uploadCircularRef, setUploadCircularRef] = useState('IEEMA/PVC/EL/2026-04');
  const [selectedFileName, setSelectedFileName] = useState('');

  const activeItem = useMemo(
    () => itemsMaster.find((i) => i.pl === selectedPl) || itemsMaster[0],
    [itemsMaster, selectedPl]
  );

  const activeIndicesMap = useMemo(
    () => (activeItem ? itemMonthlyIndices[activeItem.pl] || {} : {}),
    [itemMonthlyIndices, activeItem]
  );

  const sortedMonths = useMemo(() => Object.keys(activeIndicesMap).sort(), [activeIndicesMap]);

  // Pre-fill component, all-currency FX rates, and Rate of Duty inputs when switching month or PL
  useEffect(() => {
    if (!activeItem) return;
    const existing = activeIndicesMap[monthInput];
    const latestMonth = sortedMonths[sortedMonths.length - 1];
    const latestEntry = latestMonth ? activeIndicesMap[latestMonth] : undefined;

    const nextVals: Record<string, string> = {};
    activeItem.components.forEach((c) => {
      if (existing && existing[c.name] !== undefined) {
        nextVals[c.name] = String(existing[c.name]);
      } else if (c.timelag === 'M-0' || c.name.toLowerCase().includes('fixed')) {
        nextVals[c.name] = '100';
      } else {
        const latestVal = latestEntry?.[c.name];
        nextVals[c.name] = latestVal !== undefined ? String(latestVal) : '';
      }
    });
    setCompValues(nextVals);

    const nextFx = {} as Record<ForeignCurrencyCode, string>;
    FOREIGN_CURRENCIES.forEach((cur) => {
      const val =
        existing?.exchangeRates?.[cur] ??
        latestEntry?.exchangeRates?.[cur] ??
        DEFAULT_EXCHANGE_RATES[cur];
      nextFx[cur] = String(val);
    });
    setFxValues(nextFx);

    const dutyVal =
      existing?.exciseDutyPct ?? latestEntry?.exciseDutyPct ?? DEFAULT_EXCISE_DUTY_PCT;
    setRateOfDutyInput(String(dutyVal));

    if (existing?.source) {
      setSourceInput(String(existing.source));
    }
  }, [activeItem, monthInput, activeIndicesMap, sortedMonths]);

  const handleSaveIndexForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem || !monthInput) return;

    const parsedFxRates: ExchangeRatesByCurrency = {};
    for (const cur of FOREIGN_CURRENCIES) {
      const parsed = parseFloat(fxValues[cur]);
      if (Number.isNaN(parsed) || parsed <= 0) {
        onNotify(`Enter a valid positive Exchange Rate for ${cur}.`, 'error');
        return;
      }
      parsedFxRates[cur] = parsed;
    }

    const parsedDuty = parseFloat(rateOfDutyInput);
    if (Number.isNaN(parsedDuty) || parsedDuty < 0) {
      onNotify('Enter a valid Rate of Duty % (0 or above).', 'error');
      return;
    }

    const entry: MonthlyIndexEntry = {
      exchangeRates: parsedFxRates,
      exchangeRate: parsedFxRates.USD,
      exciseDutyPct: parsedDuty,
      source: sourceInput.trim() || 'Manual Feed',
      circularDate: new Date().toISOString().slice(0, 10),
      verifiedBy: 'CVI / Stores Accts',
    };

    for (const c of activeItem.components) {
      const num = parseFloat(compValues[c.name]);
      if (Number.isNaN(num) || num <= 0) {
        onNotify(`Enter a valid positive value for ${c.name}.`, 'error');
        return;
      }
      entry[c.name] = num;
    }

    onSaveMonthlyIndex(activeItem.pl, monthInput, entry);
    onNotify(`Saved indices, FX rates & duty for PL ${activeItem.pl} (${monthInput}).`, 'success');
  };

  const handleLoadMonthIntoEditor = (m: string) => {
    setMonthInput(m);
    const data = activeIndicesMap[m];
    if (data?.source) setSourceInput(String(data.source));
    onNotify(`Loaded ${m} into editor.`, 'success');
  };

  const handleConfirmCircularUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem) return;
    const existing = activeIndicesMap[uploadMonth] || {};
    const latestMonth = sortedMonths[sortedMonths.length - 1];
    const latestEntry = latestMonth ? activeIndicesMap[latestMonth] : undefined;

    const mergedFx: ExchangeRatesByCurrency = {};
    FOREIGN_CURRENCIES.forEach((cur) => {
      mergedFx[cur] =
        existing.exchangeRates?.[cur] ??
        latestEntry?.exchangeRates?.[cur] ??
        DEFAULT_EXCHANGE_RATES[cur];
    });

    const entry: MonthlyIndexEntry = {
      ...existing,
      exchangeRates: mergedFx,
      exchangeRate: mergedFx.USD,
      exciseDutyPct:
        typeof existing.exciseDutyPct === 'number'
          ? existing.exciseDutyPct
          : typeof latestEntry?.exciseDutyPct === 'number'
            ? latestEntry.exciseDutyPct
            : DEFAULT_EXCISE_DUTY_PCT,
      source: selectedFileName
        ? `${uploadCircularRef} (${selectedFileName})`
        : uploadCircularRef || 'IEEMA Circular',
      attachmentName: selectedFileName || 'IEEMA_Circular.pdf',
      circularDate: new Date().toISOString().slice(0, 10),
    };

    activeItem.components.forEach((c) => {
      if (typeof entry[c.name] !== 'number') {
        const baseVal =
          latestEntry && typeof latestEntry[c.name] === 'number'
            ? (latestEntry[c.name] as number)
            : 100;
        entry[c.name] = c.timelag === 'M-0' ? 100 : Number((baseVal * 1.008).toFixed(2));
      }
    });

    onSaveMonthlyIndex(activeItem.pl, uploadMonth, entry);
    setIsUploadModalOpen(false);
    setMonthInput(uploadMonth);
    onNotify(`Circular tagged for ${uploadMonth}.`, 'success');
  };

  const handleExportCsv = () => {
    if (!activeItem) return;
    const headers = [
      'Month',
      ...activeItem.components.map((c) => `${c.name} (${c.timelag})`),
      ...FOREIGN_CURRENCIES.map((cur) => `FX ${cur} (INR)`),
      'Rate of Duty (%)',
      'Source Reference',
    ];
    const rows = sortedMonths.map((m) => {
      const entry = activeIndicesMap[m] || {};
      return [
        escapeCsvCell(m),
        ...activeItem.components.map((c) => {
          const val = entry[c.name];
          return escapeCsvCell(typeof val === 'number' || typeof val === 'string' ? val : '');
        }),
        ...FOREIGN_CURRENCIES.map((cur) =>
          escapeCsvCell(resolveCurrencyExchangeRate(entry, cur, DEFAULT_EXCHANGE_RATES[cur]))
        ),
        escapeCsvCell(entry.exciseDutyPct ?? DEFAULT_EXCISE_DUTY_PCT),
        escapeCsvCell(entry.source || 'Manual Feed'),
      ].join(',');
    });
    const csv = [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CLW_PVC_Indices_PL_${activeItem.pl}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(`Exported CSV for PL ${activeItem.pl}.`, 'success');
  };

  if (!activeItem) {
    return (
      <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-sm text-slate-500">
        No PL Items configured.
      </div>
    );
  }

  const cifLagResolution = resolveLaggedMonthForComponent(
    activeItem.pl,
    inspectorEvalMonth,
    inspectorCifLag,
    itemMonthlyIndices
  );
  const resolvedCifEntry = activeIndicesMap[cifLagResolution.resolvedMonth];
  const resolvedInspectorFx = resolveCurrencyExchangeRate(
    resolvedCifEntry,
    inspectorCifCurrency,
    1.0
  );

  return (
    <div className="space-y-6">
      {/* Header & Item Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-xl border border-slate-200">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
            02. Monthly Indices, FX & Rate of Duty
          </h1>
          <span className="hidden sm:inline text-xs font-mono text-slate-500 tabular-nums shrink-0">
            {sortedMonths.length} Months
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <select
            aria-label="Select PL Item for Monthly Indices"
            value={activeItem.pl}
            onChange={(e) => onSelectPl(e.target.value)}
            className="w-full sm:w-auto sm:max-w-xs max-w-full min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-xs bg-slate-50 font-mono font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {itemsMaster.map((item) => (
              <option key={item.pl} value={item.pl}>
                PL {item.pl} — {item.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setUploadMonth(monthInput);
              setIsUploadModalOpen(true);
            }}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" />
            Attach Circular
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Top Split: Monthly Feed Form + Time-Lag Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        <div className="lg:col-span-2 bg-white rounded-xl p-4 sm:p-5 border border-slate-200 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="text-sm font-bold text-slate-900">
                PL {activeItem.pl} · {activeItem.name}
              </div>
              <span className="text-xs font-mono text-blue-700 font-semibold">
                {activeIndicesMap[monthInput] ? `Editing ${monthInput}` : `New ${monthInput}`}
              </span>
            </div>

            <form id="monthly-index-form" onSubmit={handleSaveIndexForm} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="idx-month-input" className="block text-xs font-semibold text-slate-700 mb-1">
                    Month / Year *
                  </label>
                  <input
                    id="idx-month-input"
                    type="month"
                    required
                    value={monthInput}
                    onChange={(e) => setMonthInput(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono bg-white"
                  />
                </div>
                <div>
                  <label htmlFor="idx-source-input" className="block text-xs font-semibold text-slate-700 mb-1">
                    Circular / Source Ref *
                  </label>
                  <input
                    id="idx-source-input"
                    type="text"
                    required
                    value={sourceInput}
                    onChange={(e) => setSourceInput(e.target.value)}
                    placeholder="IEEMA Circular"
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
                  />
                </div>
              </div>

              {/* Component Indices */}
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                {activeItem.components.map((c) => (
                  <div key={c.name} className="flex flex-col min-w-0">
                    <label
                      htmlFor={`comp-idx-${c.name}`}
                      className="text-xs font-semibold text-slate-800 mb-1 flex items-center justify-between gap-1"
                    >
                      <span className="truncate" title={c.name}>
                        {c.name}
                      </span>
                      <span className="font-mono text-blue-700 shrink-0">{c.timelag}</span>
                    </label>
                    <input
                      id={`comp-idx-${c.name}`}
                      type="number"
                      step="any"
                      required
                      value={compValues[c.name] ?? ''}
                      onChange={(e) =>
                        setCompValues({ ...compValues, [c.name]: e.target.value })
                      }
                      className="border border-slate-300 rounded-md p-2 text-xs font-mono tabular-nums bg-white"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                      W = {(c.weight * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>

              {/* All-Currency Exchange Rates + Rate of Duty (%) */}
              <div className="bg-blue-50/50 p-3.5 rounded-lg border border-blue-200 space-y-3">
                <div className="text-xs font-bold text-blue-950">
                  Currency Exchange Rates (₹ per Foreign Currency) & Rate of Duty (%)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
                  {FOREIGN_CURRENCIES.map((cur) => (
                    <div key={cur}>
                      <label
                        htmlFor={`idx-fx-${cur}`}
                        className="block text-xs font-semibold text-slate-800 mb-1 font-mono"
                      >
                        {cur} (₹) *
                      </label>
                      <input
                        id={`idx-fx-${cur}`}
                        type="number"
                        step="any"
                        min="0.0001"
                        required
                        value={fxValues[cur]}
                        onChange={(e) =>
                          setFxValues({ ...fxValues, [cur]: e.target.value })
                        }
                        className="w-full border border-blue-300 rounded-md p-2 text-xs font-mono tabular-nums bg-white"
                      />
                    </div>
                  ))}
                  <div>
                    <label
                      htmlFor="idx-rate-of-duty"
                      className="block text-xs font-semibold text-blue-900 mb-1"
                    >
                      Rate of Duty (%) *
                    </label>
                    <input
                      id="idx-rate-of-duty"
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      required
                      value={rateOfDutyInput}
                      onChange={(e) => setRateOfDutyInput(e.target.value)}
                      placeholder="11"
                      className="w-full border border-blue-400 rounded-md p-2 text-xs font-mono font-semibold tabular-nums bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Month ({monthInput})
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Time-Lag Lookup Inspector */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 flex flex-col justify-between space-y-3">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-1.5">
                <CalendarSearch className="w-4 h-4 text-blue-600 shrink-0" />
                <h2 className="text-sm font-bold text-slate-900">Time-Lag Lookup</h2>
              </div>
              <input
                type="month"
                aria-label="Lag Inspector Evaluation Month"
                value={inspectorEvalMonth}
                onChange={(e) => setInspectorEvalMonth(e.target.value)}
                className="border border-slate-300 rounded-md px-2 py-1 text-xs font-mono bg-slate-50"
              />
            </div>

            <div className="space-y-2">
              {activeItem.components.map((c) => {
                const res = resolveLaggedMonthForComponent(
                  activeItem.pl,
                  inspectorEvalMonth,
                  c.timelag,
                  itemMonthlyIndices
                );
                const val = activeIndicesMap[res.resolvedMonth]?.[c.name];
                return (
                  <div
                    key={c.name}
                    className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-semibold text-slate-800 truncate">
                        {c.name} <span className="font-mono text-blue-700">({c.timelag})</span>
                      </div>
                      <div className="text-slate-500 font-mono text-[11px] mt-0.5">
                        {res.targetMonth} → {res.resolvedMonth}
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="font-bold text-slate-900">
                        {val !== undefined ? Number(val).toFixed(2) : '100.00'}
                      </div>
                      <div
                        className={`text-[10px] ${
                          res.exactMatch ? 'text-emerald-700' : 'text-amber-600'
                        }`}
                      >
                        {res.exactMatch ? 'Exact' : 'Fallback'}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* CIF FX & Rate of Duty Lag Preview */}
              <div className="p-2.5 rounded-lg bg-blue-50/60 border border-blue-200 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-blue-900">CIF FX & Duty</span>
                  <div className="inline-flex items-center gap-1.5">
                    <select
                      aria-label="CIF Currency Preview"
                      value={inspectorCifCurrency}
                      onChange={(e) => setInspectorCifCurrency(e.target.value as CurrencyCode)}
                      className="border border-blue-300 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold bg-white"
                    >
                      {INSPECTOR_CURRENCIES.map((cur) => (
                        <option key={cur} value={cur}>
                          {cur}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="CIF Lag Rule Preview"
                      value={inspectorCifLag}
                      onChange={(e) => setInspectorCifLag(e.target.value as TimeLagRule)}
                      className="border border-blue-300 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold bg-white"
                    >
                      {TIME_LAG_OPTIONS.map((lag) => (
                        <option key={lag} value={lag}>
                          {lag}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-between font-mono tabular-nums text-[11px]">
                  <span className="text-slate-600">
                    {cifLagResolution.targetMonth} → {cifLagResolution.resolvedMonth}
                  </span>
                  <span className="font-bold text-slate-900">
                    {inspectorCifCurrency === 'INR'
                      ? 'INR 1.00'
                      : `${inspectorCifCurrency} ₹${resolvedInspectorFx.toFixed(
                          inspectorCifCurrency === 'JPY' ? 3 : 2
                        )}`}{' '}
                    · Duty{' '}
                    {Number(resolvedCifEntry?.exciseDutyPct ?? DEFAULT_EXCISE_DUTY_PCT).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Index Matrix Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <span>Recorded Monthly Matrix — PL {activeItem.pl}</span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-500 tabular-nums">
              {sortedMonths.length} Months
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/70 text-slate-500 text-xs font-semibold border-b border-slate-200">
                <th className="py-3 px-4">Month</th>
                {activeItem.components.map((c) => (
                  <th key={c.name} className="py-3 px-3 text-right">
                    <div>{c.name}</div>
                    <div className="font-mono text-[11px] text-slate-400 font-normal">
                      {c.timelag} · {(c.weight * 100).toFixed(0)}%
                    </div>
                  </th>
                ))}
                {FOREIGN_CURRENCIES.map((cur) => (
                  <th key={cur} className="py-3 px-2.5 text-right text-blue-700 font-mono">
                    {cur}
                  </th>
                ))}
                <th className="py-3 px-3 text-right text-blue-900">Duty %</th>
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
              {sortedMonths.length === 0 ? (
                <tr>
                  <td
                    colSpan={activeItem.components.length + FOREIGN_CURRENCIES.length + 4}
                    className="py-8 text-center text-slate-500 font-sans"
                  >
                    No monthly indices logged for PL {activeItem.pl}.
                  </td>
                </tr>
              ) : (
                sortedMonths.map((m) => {
                  const data = activeIndicesMap[m] || {};
                  const isEditingThis = m === monthInput;
                  return (
                    <tr
                      key={m}
                      onClick={() => handleLoadMonthIntoEditor(m)}
                      className={`transition-colors cursor-pointer ${
                        isEditingThis ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-2.5 px-4 font-bold text-slate-900 whitespace-nowrap">
                        {m}
                        {isEditingThis && (
                          <span className="ml-1.5 text-[10px] font-sans font-semibold text-blue-700">
                            · Editing
                          </span>
                        )}
                      </td>
                      {activeItem.components.map((c) => {
                        const val = data[c.name];
                        return (
                          <td key={c.name} className="py-2.5 px-3 text-right text-slate-800">
                            {typeof val === 'number'
                              ? val.toFixed(2)
                              : val !== undefined
                                ? String(val)
                                : '—'}
                          </td>
                        );
                      })}
                      {FOREIGN_CURRENCIES.map((cur) => {
                        const rate = data.exchangeRates?.[cur];
                        return (
                          <td key={cur} className="py-2.5 px-2.5 text-right text-blue-800">
                            {typeof rate === 'number'
                              ? rate.toFixed(cur === 'JPY' ? 3 : 2)
                              : '—'}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-3 text-right font-semibold text-blue-900">
                        {typeof data.exciseDutyPct === 'number'
                          ? `${data.exciseDutyPct.toFixed(2)}%`
                          : `${DEFAULT_EXCISE_DUTY_PCT.toFixed(2)}%`}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-slate-600 max-w-[180px] truncate">
                        {String(data.source || 'Manual Feed')}
                      </td>
                      <td
                        className="py-2.5 px-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleLoadMonthIntoEditor(m)}
                            aria-label={`Edit month ${m}`}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-md cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteMonthlyIndex(activeItem.pl, m)}
                            aria-label={`Delete month ${m}`}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Circular Document Upload Modal */}
      {isUploadModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Attach Circular Document"
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-xl max-w-md w-full p-5 sm:p-6 border border-slate-200 shadow-xl space-y-4 my-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-900">Attach Circular Reference</h2>
              <button
                type="button"
                aria-label="Close Circular Modal"
                onClick={() => setIsUploadModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmCircularUpload} className="space-y-4 text-xs">
              <div>
                <label htmlFor="upload-month-input" className="block font-semibold text-slate-700 mb-1">
                  Target Month *
                </label>
                <input
                  id="upload-month-input"
                  type="month"
                  required
                  value={uploadMonth}
                  onChange={(e) => setUploadMonth(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 font-mono"
                />
              </div>

              <div>
                <label htmlFor="upload-ref-input" className="block font-semibold text-slate-700 mb-1">
                  Circular Reference *
                </label>
                <input
                  id="upload-ref-input"
                  type="text"
                  required
                  value={uploadCircularRef}
                  onChange={(e) => setUploadCircularRef(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div>
                <label htmlFor="upload-file-input" className="block font-semibold text-slate-700 mb-1">
                  File (PDF / JPG / PNG)
                </label>
                <input
                  id="upload-file-input"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setSelectedFileName(e.target.files?.[0]?.name || '')}
                  className="w-full border border-slate-300 rounded-lg p-2 bg-slate-50 text-xs file:mr-3 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                >
                  Save Circular Tag
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
