/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  DatabaseBackup,
  Menu,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import {
  DEFAULT_EXCHANGE_RATES,
  DEFAULT_EXCISE_DUTY_PCT,
  INITIAL_DEEMED_GROUPS,
  INITIAL_ITEMS_MASTER,
  INITIAL_MONTHLY_INDICES,
  INITIAL_PO_LEDGER,
  INITIAL_SUPPLIERS_BY_PL,
} from './data/initialData';
import {
  DeemedPvcPoGroup,
  ItemMonthlyIndicesMap,
  MonthlyIndexEntry,
  PLItem,
  POMilestone,
  ScrutinyReportResult,
  ScrutinyTransactionInput,
  SuppliersByPlMap,
} from './types/pvc';
import {
  ActiveTab,
  NAV_ITEMS,
  buildTransactionFromPo,
  getPathForTab,
  parseTabFromLocation,
  registerSupplierForPl,
  syncPoLegacyDpFields,
  syncTenderAutoGroups,
} from './utils/navigation';
import {
  evaluateScrutinyTransaction,
  findGroupsForPo,
  formatINR,
} from './utils/pvcEngine';

// Lazy-loaded modules for fast initial load and code splitting
const loadMasterModule = () =>
  import('./components/MasterAndLedgerModule').then((m) => ({
    default: m.MasterAndLedgerModule,
  }));
const loadIndicesModule = () =>
  import('./components/MonthlyIndicesModule').then((m) => ({
    default: m.MonthlyIndicesModule,
  }));
const loadTransactionModule = () =>
  import('./components/TransactionScrutinyModule').then((m) => ({
    default: m.TransactionScrutinyModule,
  }));
const loadReportModule = () =>
  import('./components/AuditReportModule').then((m) => ({
    default: m.AuditReportModule,
  }));

const MasterAndLedgerModule = lazy(loadMasterModule);
const MonthlyIndicesModule = lazy(loadIndicesModule);
const TransactionScrutinyModule = lazy(loadTransactionModule);
const AuditReportModule = lazy(loadReportModule);

function prefetchTabModule(tab: ActiveTab) {
  if (tab === 'master') void loadMasterModule();
  else if (tab === 'indices') void loadIndicesModule();
  else if (tab === 'transaction') void loadTransactionModule();
  else if (tab === 'report') void loadReportModule();
}

interface ToastNotification {
  id: number;
  message: string;
  type: 'success' | 'warning' | 'error';
}

const STORAGE_KEYS = {
  ITEMS: 'clw_pvc_items_v9',
  PO_LEDGER: 'clw_pvc_po_ledger_v9',
  INDICES: 'clw_pvc_indices_v9',
  DEEMED_GROUPS: 'clw_pvc_deemed_groups_v9',
  DISMISSED_TENDERS: 'clw_pvc_dismissed_tenders_v9',
  SAVED_REPORTS: 'clw_pvc_saved_reports_v9',
  SUPPLIERS: 'clw_pvc_suppliers_v9',
};

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

const ModuleSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading module">
    <div className="h-16 bg-white rounded-xl border border-slate-200" />
    <div className="h-64 bg-white rounded-xl border border-slate-200" />
    <div className="h-48 bg-white rounded-xl border border-slate-200" />
  </div>
);

export default function App() {
  const [activeTab, setActiveTabState] = useState<ActiveTab>(() =>
    typeof window !== 'undefined'
      ? parseTabFromLocation(window.location.pathname, window.location.hash)
      : 'master'
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [itemsMaster, setItemsMaster] = useState<PLItem[]>(() =>
    loadFromStorage(STORAGE_KEYS.ITEMS, INITIAL_ITEMS_MASTER)
  );
  const [poLedger, setPoLedger] = useState<POMilestone[]>(() =>
    loadFromStorage(STORAGE_KEYS.PO_LEDGER, INITIAL_PO_LEDGER).map(syncPoLegacyDpFields)
  );
  const [itemMonthlyIndices, setItemMonthlyIndices] = useState<ItemMonthlyIndicesMap>(() =>
    loadFromStorage(STORAGE_KEYS.INDICES, INITIAL_MONTHLY_INDICES)
  );
  const [dismissedTenderNos, setDismissedTenderNos] = useState<string[]>(() =>
    loadFromStorage(STORAGE_KEYS.DISMISSED_TENDERS, [])
  );
  const [deemedGroups, setDeemedGroups] = useState<DeemedPvcPoGroup[]>(() =>
    loadFromStorage(STORAGE_KEYS.DEEMED_GROUPS, INITIAL_DEEMED_GROUPS)
  );
  const [savedReports, setSavedReports] = useState<ScrutinyReportResult[]>(() =>
    loadFromStorage(STORAGE_KEYS.SAVED_REPORTS, [])
  );
  const [suppliersByPl, setSuppliersByPl] = useState<SuppliersByPlMap>(() =>
    loadFromStorage(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS_BY_PL)
  );
  const [selectedIndicesPl, setSelectedIndicesPl] = useState<string>(
    () => itemsMaster[0]?.pl || INITIAL_ITEMS_MASTER[0].pl
  );

  const [toast, setToast] = useState<ToastNotification | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback(
    (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
      setToast({ id: Date.now(), message, type });
    },
    []
  );

  const navigateToTab = useCallback((tab: ActiveTab) => {
    setActiveTabState(tab);
    setIsMobileMenuOpen(false);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const targetPath = getPathForTab(tab);
      if (window.location.pathname !== targetPath) {
        try {
          window.history.pushState({ tab }, '', targetPath);
        } catch {
          // Ignore pushState restrictions in sandboxed origins
        }
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      setActiveTabState(parseTabFromLocation(window.location.pathname, window.location.hash));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Per-slice persistence
  useEffect(() => saveToStorage(STORAGE_KEYS.ITEMS, itemsMaster), [itemsMaster]);
  useEffect(() => saveToStorage(STORAGE_KEYS.PO_LEDGER, poLedger), [poLedger]);
  useEffect(() => saveToStorage(STORAGE_KEYS.INDICES, itemMonthlyIndices), [itemMonthlyIndices]);
  useEffect(() => saveToStorage(STORAGE_KEYS.DEEMED_GROUPS, deemedGroups), [deemedGroups]);
  useEffect(
    () => saveToStorage(STORAGE_KEYS.DISMISSED_TENDERS, dismissedTenderNos),
    [dismissedTenderNos]
  );
  useEffect(() => saveToStorage(STORAGE_KEYS.SAVED_REPORTS, savedReports), [savedReports]);
  useEffect(() => saveToStorage(STORAGE_KEYS.SUPPLIERS, suppliersByPl), [suppliersByPl]);

  const [transactionInput, setTransactionInput] = useState<ScrutinyTransactionInput>(() =>
    buildTransactionFromPo(poLedger[0] || INITIAL_PO_LEDGER[0], deemedGroups)
  );

  const [activeReport, setActiveReport] = useState<ScrutinyReportResult | null>(null);

  const defaultReport = useMemo(() => {
    if (activeTab !== 'report' && activeReport) return null;
    const po =
      poLedger.find(
        (p) => p.poNo === transactionInput.poNo && p.poSr === transactionInput.poSr
      ) ||
      poLedger[0] ||
      INITIAL_PO_LEDGER[0];
    const item =
      itemsMaster.find((i) => i.pl === po.pl) ||
      itemsMaster[0] ||
      INITIAL_ITEMS_MASTER[0];
    return evaluateScrutinyTransaction(
      transactionInput,
      po,
      item,
      itemMonthlyIndices,
      deemedGroups,
      poLedger,
      itemsMaster
    );
  }, [activeTab, activeReport, poLedger, itemsMaster, transactionInput, itemMonthlyIndices, deemedGroups]);

  const displayedReport = activeReport || defaultReport;

  const handleAddSupplier = useCallback((pl: string, vendorName: string) => {
    setSuppliersByPl((prev) => registerSupplierForPl(prev, pl, vendorName));
  }, []);

  const handleOpenIndicesForPl = useCallback(
    (pl: string) => {
      setSelectedIndicesPl(pl);
      navigateToTab('indices');
    },
    [navigateToTab]
  );

  // Module 1: Item Master & PO Ledger handlers with automatic 8-digit Tender grouping
  const handleSaveItem = (newItem: PLItem, originalPl?: string) => {
    setItemsMaster((prev) => {
      if (originalPl) {
        return prev.map((it) => (it.pl === originalPl ? newItem : it));
      }
      const existsIdx = prev.findIndex((it) => it.pl === newItem.pl);
      if (existsIdx >= 0) {
        const next = [...prev];
        next[existsIdx] = newItem;
        return next;
      }
      return [...prev, newItem];
    });

    if (originalPl && originalPl !== newItem.pl) {
      setPoLedger((prev) =>
        prev.map((po) => (po.pl === originalPl ? { ...po, pl: newItem.pl } : po))
      );
      setSuppliersByPl((prev) => {
        const next = { ...prev };
        const moved = next[originalPl] || [];
        delete next[originalPl];
        next[newItem.pl] = Array.from(new Set([...(next[newItem.pl] || []), ...moved]));
        return next;
      });
      setItemMonthlyIndices((prev) => {
        if (!prev[originalPl]) return prev;
        const next = { ...prev };
        next[newItem.pl] = { ...next[originalPl], ...(next[newItem.pl] || {}) };
        delete next[originalPl];
        return next;
      });
      if (selectedIndicesPl === originalPl) {
        setSelectedIndicesPl(newItem.pl);
      }
    } else {
      setItemMonthlyIndices((prev) => {
        if (prev[newItem.pl]) return prev;
        const defaultMonth: MonthlyIndexEntry = {
          exchangeRates: { ...DEFAULT_EXCHANGE_RATES },
          exchangeRate: DEFAULT_EXCHANGE_RATES.USD,
          exciseDutyPct: DEFAULT_EXCISE_DUTY_PCT,
          source: 'Initial Baseline',
        };
        newItem.components.forEach((c) => {
          defaultMonth[c.name] = 100.0;
        });
        return {
          ...prev,
          [newItem.pl]: {
            '2025-08': { ...defaultMonth },
            '2026-01': { ...defaultMonth },
          },
        };
      });
    }

    setActiveReport(null);
    notify(
      originalPl ? `Updated PL ${newItem.pl}.` : `Added PL ${newItem.pl}.`,
      'success'
    );
  };

  const handleDeleteItem = (pl: string) => {
    if (itemsMaster.length <= 1) {
      notify('At least one PL Item must remain.', 'warning');
      return;
    }
    const remaining = itemsMaster.filter((i) => i.pl !== pl);
    setItemsMaster(remaining);
    if (selectedIndicesPl === pl && remaining[0]) {
      setSelectedIndicesPl(remaining[0].pl);
    }
    setActiveReport(null);
    notify(`Removed PL ${pl}.`, 'success');
  };

  const handleSavePo = (po: POMilestone, editIndex?: number) => {
    const normalizedPo = syncPoLegacyDpFields(po);
    const nextLedger =
      editIndex !== undefined && editIndex >= 0 && editIndex < poLedger.length
        ? poLedger.map((item, idx) => (idx === editIndex ? normalizedPo : item))
        : [normalizedPo, ...poLedger];

    const syncedGroups = syncTenderAutoGroups(nextLedger, deemedGroups, dismissedTenderNos);
    setPoLedger(nextLedger);
    setDeemedGroups(syncedGroups);
    setSuppliersByPl((prev) => registerSupplierForPl(prev, normalizedPo.pl, normalizedPo.vendorName));

    // Keep scrutiny input aligned if editing the currently selected PO Sr
    if (
      transactionInput.poNo === normalizedPo.poNo &&
      transactionInput.poSr === normalizedPo.poSr
    ) {
      setTransactionInput(buildTransactionFromPo(normalizedPo, syncedGroups));
    }

    setActiveReport(null);
    notify(
      editIndex !== undefined
        ? `Updated ${normalizedPo.poNo} (Sr ${normalizedPo.poSr}).`
        : `Added ${normalizedPo.poNo} (Sr ${normalizedPo.poSr}).`,
      'success'
    );
  };

  const handleDeletePo = (index: number) => {
    if (poLedger.length <= 1) {
      notify('At least one PO must remain.', 'warning');
      return;
    }
    const target = poLedger[index];
    const nextLedger = poLedger.filter((_, i) => i !== index);
    const syncedGroups = syncTenderAutoGroups(nextLedger, deemedGroups, dismissedTenderNos);
    setPoLedger(nextLedger);
    setDeemedGroups(syncedGroups);
    if (
      target &&
      transactionInput.poNo === target.poNo &&
      transactionInput.poSr === target.poSr
    ) {
      setTransactionInput(buildTransactionFromPo(nextLedger[0], syncedGroups));
    }
    setActiveReport(null);
    notify(`Deleted ${target?.poNo || 'PO'} (Sr ${target?.poSr || ''}).`, 'success');
  };

  // Admin Controls for 8-Digit Tender Auto-Groups
  const handleRecreateAutoGroups = () => {
    const rebuilt = syncTenderAutoGroups(poLedger, [], []);
    setDismissedTenderNos([]);
    setDeemedGroups(rebuilt);
    setActiveReport(null);
    notify(`Recreated ${rebuilt.length} Tender Auto-Groups from 8-digit PO prefixes.`, 'success');
  };

  const handleRemoveTenderGroup = (groupId: string) => {
    const target = deemedGroups.find((g) => g.id === groupId);
    if (target?.tenderNo) {
      setDismissedTenderNos((prev) =>
        prev.includes(target.tenderNo!) ? prev : [...prev, target.tenderNo!]
      );
    }
    setDeemedGroups((prev) => prev.filter((g) => g.id !== groupId));
    setActiveReport(null);
    notify(`Removed group "${target?.name || groupId}".`, 'success');
  };

  const handleAddPoToGroup = (groupId: string, poKey: string) => {
    setDeemedGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        if (g.memberPoKeys.includes(poKey)) return g;
        return {
          ...g,
          isAdminEdited: true,
          memberPoKeys: [...g.memberPoKeys, poKey],
        };
      })
    );
    setActiveReport(null);
    notify('Added PO to Tender Group.', 'success');
  };

  const handleRemovePoFromGroup = (groupId: string, poKey: string) => {
    const targetGroup = deemedGroups.find((g) => g.id === groupId);
    if (!targetGroup) return;
    const remainingKeys = targetGroup.memberPoKeys.filter((k) => k !== poKey);
    if (remainingKeys.length === 0) {
      handleRemoveTenderGroup(groupId);
      return;
    }
    setDeemedGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              isAdminEdited: true,
              memberPoKeys: remainingKeys,
            }
          : g
      )
    );
    setActiveReport(null);
    notify('Removed PO from Tender Group.', 'success');
  };

  const handleSelectPoForScrutiny = (po: POMilestone, enableDeemed?: boolean) => {
    setTransactionInput(buildTransactionFromPo(po, deemedGroups, enableDeemed));
    setSelectedIndicesPl(po.pl);
    setActiveReport(null);
    navigateToTab('transaction');
    const matching = findGroupsForPo(po.poNo, po.poSr, deemedGroups);
    notify(
      matching.length > 0 && enableDeemed !== false
        ? `Loaded ${po.poNo} (Sr ${po.poSr}) with ${matching[0].name}.`
        : `Loaded ${po.poNo} (Sr ${po.poSr}) into Scrutiny Engine.`,
      'success'
    );
  };

  // Module 2: Monthly Indices handlers
  const handleSaveMonthlyIndex = (
    pl: string,
    month: string,
    entry: MonthlyIndexEntry
  ) => {
    setItemMonthlyIndices((prev) => ({
      ...prev,
      [pl]: {
        ...(prev[pl] || {}),
        [month]: entry,
      },
    }));
    setActiveReport(null);
  };

  const handleDeleteMonthlyIndex = (pl: string, month: string) => {
    setItemMonthlyIndices((prev) => {
      const nextPlMap = { ...(prev[pl] || {}) };
      delete nextPlMap[month];
      return { ...prev, [pl]: nextPlMap };
    });
    setActiveReport(null);
    notify(`Removed ${month} for PL ${pl}.`, 'success');
  };

  // Module 3 & 4 handlers
  const handleSelectPoKeyInTransaction = (poNo: string, poSr: string) => {
    const found = poLedger.find((p) => p.poNo === poNo && p.poSr === poSr);
    if (found) {
      setTransactionInput(buildTransactionFromPo(found, deemedGroups));
      setSelectedIndicesPl(found.pl);
      setActiveReport(null);
    }
  };

  const handleGenerateReport = (result: ScrutinyReportResult) => {
    setActiveReport(result);
    navigateToTab('report');
    notify(`Generated Statement (${formatINR(result.lowestRate)} unit rate).`, 'success');
  };

  const handleSaveReportToRegister = (report: ScrutinyReportResult) => {
    setSavedReports((prev) => {
      if (prev.some((r) => r.id === report.id)) return prev;
      return [report, ...prev];
    });
    notify(`Logged ${report.id} to Audit Register.`, 'success');
  };

  const handleDeleteSavedReport = (id: string) => {
    setSavedReports((prev) => prev.filter((r) => r.id !== id));
    notify(`Removed ${id} from Audit Register.`, 'success');
  };

  const handleResetDemoData = () => {
    setItemsMaster(INITIAL_ITEMS_MASTER);
    setPoLedger(INITIAL_PO_LEDGER);
    setItemMonthlyIndices(INITIAL_MONTHLY_INDICES);
    setDismissedTenderNos([]);
    setDeemedGroups(INITIAL_DEEMED_GROUPS);
    setSuppliersByPl(INITIAL_SUPPLIERS_BY_PL);
    setSelectedIndicesPl(INITIAL_ITEMS_MASTER[0].pl);
    setTransactionInput(
      buildTransactionFromPo(INITIAL_PO_LEDGER[0], INITIAL_DEEMED_GROUPS)
    );
    setActiveReport(null);
    setIsMobileMenuOpen(false);
    notify('Restored default CLW dataset.', 'success');
  };

  const handleExportWorkspaceJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      itemsMaster,
      poLedger,
      itemMonthlyIndices,
      deemedGroups,
      dismissedTenderNos,
      suppliersByPl,
      savedReports,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CLW_PVC_Suite_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Exported workspace JSON backup.', 'success');
  };

  const handleImportWorkspaceJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        if (Array.isArray(parsed.itemsMaster) && parsed.itemsMaster.length > 0) {
          setItemsMaster(parsed.itemsMaster);
        }
        const importedDismissed: string[] = Array.isArray(parsed.dismissedTenderNos)
          ? parsed.dismissedTenderNos
          : [];
        setDismissedTenderNos(importedDismissed);

        if (Array.isArray(parsed.poLedger) && parsed.poLedger.length > 0) {
          const normalizedPos = parsed.poLedger.map(syncPoLegacyDpFields);
          const nextGroups = syncTenderAutoGroups(
            normalizedPos,
            Array.isArray(parsed.deemedGroups) ? parsed.deemedGroups : [],
            importedDismissed
          );
          setPoLedger(normalizedPos);
          setDeemedGroups(nextGroups);
          setTransactionInput(buildTransactionFromPo(normalizedPos[0], nextGroups));
        } else if (Array.isArray(parsed.deemedGroups)) {
          setDeemedGroups(parsed.deemedGroups);
        }
        if (parsed.itemMonthlyIndices && typeof parsed.itemMonthlyIndices === 'object') {
          setItemMonthlyIndices(parsed.itemMonthlyIndices);
        }
        if (parsed.suppliersByPl && typeof parsed.suppliersByPl === 'object') {
          setSuppliersByPl(parsed.suppliersByPl);
        }
        if (Array.isArray(parsed.savedReports)) {
          setSavedReports(parsed.savedReports);
        }
        setActiveReport(null);
        notify('Imported workspace backup JSON.', 'success');
      } catch {
        notify('Invalid JSON backup file.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col overflow-x-clip">
      {/* Top Bar Contract: 3 Zones (Brand, 4 Single-Line Nav Links, 1 Primary Action) */}
      <header className="no-print bg-slate-900 text-white border-b border-slate-800 px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4 sm:gap-8 shrink-0">
        {/* Zone 1: Brand Wordmark + Mobile Menu Trigger */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={isMobileMenuOpen}
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            className="md:hidden p-2 -ml-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer shrink-0"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigateToTab('master');
            }}
            className="text-sm sm:text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <span className="sm:hidden">CLW PVC & LD Suite</span>
            <span className="hidden sm:inline">Indian Railways CVI PVC & LD Suite</span>
          </a>
        </div>

        {/* Zone 2: 4 Clean Single-Line Navigation Links */}
        <nav aria-label="Primary Navigation" className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateToTab(item.id)}
              onMouseEnter={() => prefetchTabModule(item.id)}
              onFocus={() => prefetchTabModule(item.id)}
              aria-current={activeTab === item.id ? 'page' : undefined}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 cursor-pointer ${
                activeTab === item.id
                  ? 'text-white underline underline-offset-8 decoration-2 decoration-amber-400 font-semibold'
                  : ''
              }`}
            >
              {item.shortLabel}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => navigateToTab('transaction')}
            onMouseEnter={() => prefetchTabModule('transaction')}
            className="px-3.5 py-2 text-xs font-semibold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            New Scrutiny
          </button>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {isMobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation"
          className="no-print md:hidden fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div
            className="w-72 max-w-[85vw] bg-white h-full p-5 flex flex-col justify-between shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="text-sm font-bold text-slate-900">CLW CVI Workspace</span>
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-1">
                {NAV_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateToTab(item.id)}
                    className={`w-full text-left px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      activeTab === item.id
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 space-y-2">
              <button
                type="button"
                onClick={() => {
                  handleExportWorkspaceJson();
                  setIsMobileMenuOpen(false);
                }}
                className="w-full px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <DatabaseBackup className="w-3.5 h-3.5" />
                Export Backup JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  importInputRef.current?.click();
                  setIsMobileMenuOpen(false);
                }}
                className="w-full px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Backup JSON
              </button>
              <button
                type="button"
                onClick={handleResetDemoData}
                className="w-full px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restore Defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-Width Main Content Viewport (No Left Sidebar) */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-5">
        {/* Compact Mobile Tab Strip (Fits 390px cleanly without clipping) */}
        <div className="no-print flex md:hidden items-center gap-1 p-1 bg-slate-200/80 rounded-lg">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateToTab(item.id)}
              className={`flex-1 min-w-0 px-1.5 py-2 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap truncate cursor-pointer ${
                activeTab === item.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.mobileLabel}
            </button>
          ))}
        </div>

        {/* Non-Blocking Toast Banner */}
        {toast && (
          <div
            role="status"
            className={`no-print flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-xs font-medium ${
              toast.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : toast.type === 'warning'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{toast.message}</span>
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
              className="p-1 text-slate-500 hover:text-slate-800 rounded cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active Code-Split Module View */}
        <Suspense fallback={<ModuleSkeleton />}>
          {activeTab === 'master' && (
            <MasterAndLedgerModule
              itemsMaster={itemsMaster}
              poLedger={poLedger}
              deemedGroups={deemedGroups}
              suppliersByPl={suppliersByPl}
              onSaveItem={handleSaveItem}
              onDeleteItem={handleDeleteItem}
              onSavePo={handleSavePo}
              onDeletePo={handleDeletePo}
              onAddSupplier={handleAddSupplier}
              onRecreateAutoGroups={handleRecreateAutoGroups}
              onRemoveTenderGroup={handleRemoveTenderGroup}
              onAddPoToGroup={handleAddPoToGroup}
              onRemovePoFromGroup={handleRemovePoFromGroup}
              onSelectPoForScrutiny={handleSelectPoForScrutiny}
              onOpenIndicesForPl={handleOpenIndicesForPl}
              onNotify={notify}
            />
          )}

          {activeTab === 'indices' && (
            <MonthlyIndicesModule
              itemsMaster={itemsMaster}
              itemMonthlyIndices={itemMonthlyIndices}
              selectedPl={selectedIndicesPl}
              onSelectPl={setSelectedIndicesPl}
              onSaveMonthlyIndex={handleSaveMonthlyIndex}
              onDeleteMonthlyIndex={handleDeleteMonthlyIndex}
              onNotify={notify}
            />
          )}

          {activeTab === 'transaction' && (
            <TransactionScrutinyModule
              itemsMaster={itemsMaster}
              poLedger={poLedger}
              itemMonthlyIndices={itemMonthlyIndices}
              deemedGroups={deemedGroups}
              transactionInput={transactionInput}
              onChangeTransactionInput={(next) => {
                setTransactionInput(next);
                setActiveReport(null);
              }}
              onSelectPoKey={handleSelectPoKeyInTransaction}
              onGenerateReport={handleGenerateReport}
              onOpenIndicesForPl={handleOpenIndicesForPl}
              onNotify={notify}
              onResetToPoDefaults={() => {
                const found =
                  poLedger.find(
                    (p) =>
                      p.poNo === transactionInput.poNo &&
                      p.poSr === transactionInput.poSr
                  ) || poLedger[0];
                if (found) {
                  setTransactionInput(buildTransactionFromPo(found, deemedGroups));
                  setActiveReport(null);
                  notify('Reset inputs to PO Sr defaults.', 'success');
                }
              }}
            />
          )}

          {activeTab === 'report' && displayedReport && (
            <AuditReportModule
              report={displayedReport}
              savedReports={savedReports}
              onSaveReportToRegister={handleSaveReportToRegister}
              onSelectSavedReport={(r) => {
                setActiveReport(r);
                notify(`Loaded Statement ${r.id}.`, 'success');
              }}
              onDeleteSavedReport={handleDeleteSavedReport}
              onBackToTransaction={() => navigateToTab('transaction')}
              onNotify={notify}
            />
          )}
        </Suspense>
      </main>

      {/* Quiet Utility Footer */}
      <footer className="no-print border-t border-slate-200 bg-white mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
            <span className="font-sans font-semibold text-slate-700">CLW Chittaranjan</span>
            <span aria-hidden="true">·</span>
            <span>{itemsMaster.length} PL Items</span>
            <span aria-hidden="true">·</span>
            <span>{poLedger.length} PO Sr</span>
            <span aria-hidden="true">·</span>
            <span>{deemedGroups.length} Tender Groups</span>
            <span aria-hidden="true">·</span>
            <span>{savedReports.length} Audits</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportWorkspaceJson}
              className="hidden"
              aria-label="Import workspace JSON file"
            />
            <button
              type="button"
              onClick={handleExportWorkspaceJson}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <DatabaseBackup className="w-3.5 h-3.5" />
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Import JSON
            </button>
            <button
              type="button"
              onClick={handleResetDemoData}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore Defaults
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
