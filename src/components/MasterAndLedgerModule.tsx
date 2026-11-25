import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Copy,
  Edit3,
  FilePlus2,
  FileSpreadsheet,
  FolderPlus,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  CurrencyCode,
  DeemedPvcPoGroup,
  DpAmendmentType,
  DpHistoryEntry,
  PLItem,
  POCategory,
  POMilestone,
  PVCComponent,
  SuppliersByPlMap,
  TimeLagRule,
} from '../types/pvc';
import {
  extractTenderNo,
  getSuppliersForPl,
  normalizeComponentWeights,
  syncPoLegacyDpFields,
} from '../utils/navigation';
import { findGroupsForPo, formatINR, getPoKey } from '../utils/pvcEngine';

interface MasterAndLedgerModuleProps {
  itemsMaster: PLItem[];
  poLedger: POMilestone[];
  deemedGroups: DeemedPvcPoGroup[];
  suppliersByPl: SuppliersByPlMap;
  onSaveItem: (item: PLItem, originalPl?: string) => void;
  onDeleteItem: (pl: string) => void;
  onSavePo: (po: POMilestone, editIndex?: number) => void;
  onDeletePo: (index: number) => void;
  onAddSupplier: (pl: string, vendorName: string) => void;
  onRecreateAutoGroups: () => void;
  onRemoveTenderGroup: (groupId: string) => void;
  onAddPoToGroup: (groupId: string, poKey: string) => void;
  onRemovePoFromGroup: (groupId: string, poKey: string) => void;
  onSelectPoForScrutiny: (po: POMilestone, enableDeemed?: boolean) => void;
  onOpenIndicesForPl: (pl: string) => void;
  onNotify: (msg: string, type?: 'success' | 'warning' | 'error') => void;
}

const TIME_LAG_OPTIONS: TimeLagRule[] = ['M-0', 'M-1', 'M-2', 'M-3', 'M-4'];
const CURRENCY_OPTIONS: CurrencyCode[] = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'INR'];
const DP_AMENDMENT_TYPES: DpAmendmentType[] = [
  'Refixed DP',
  'Extended DP (With LD)',
  'Extended DP (Without LD)',
];
const ADD_NEW_SUPPLIER_VALUE = '__ADD_NEW_SUPPLIER__';

export const MasterAndLedgerModule: React.FC<MasterAndLedgerModuleProps> = ({
  itemsMaster,
  poLedger,
  deemedGroups,
  suppliersByPl,
  onSaveItem,
  onDeleteItem,
  onSavePo,
  onDeletePo,
  onAddSupplier,
  onRecreateAutoGroups,
  onRemoveTenderGroup,
  onAddPoToGroup,
  onRemovePoFromGroup,
  onSelectPoForScrutiny,
  onOpenIndicesForPl,
  onNotify,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | POCategory>('ALL');
  const [plFilter, setPlFilter] = useState<string>('ALL');

  // Item Modal State
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingOriginalPl, setEditingOriginalPl] = useState<string | undefined>(undefined);
  const [itemPl, setItemPl] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemSpec, setItemSpec] = useState('');
  const [itemUnit, setItemUnit] = useState('Set');
  const [components, setComponents] = useState<PVCComponent[]>([
    { name: 'Copper', weight: 0.4, timelag: 'M-2', indexAuthority: 'IEEMA Basic' },
    { name: 'Aluminium', weight: 0.2, timelag: 'M-2', indexAuthority: 'IEEMA Basic' },
    { name: 'WPI General', weight: 0.25, timelag: 'M-1', indexAuthority: 'EA WPI' },
    { name: 'Labour', weight: 0.15, timelag: 'M-3', indexAuthority: 'Labour Bureau' },
  ]);

  // PO Modal State
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [editingPoIndex, setEditingPoIndex] = useState<number | undefined>(undefined);
  const [isAddingNewSupplier, setIsAddingNewSupplier] = useState(false);
  const [newSupplierInput, setNewSupplierInput] = useState('');
  const [poForm, setPoForm] = useState<POMilestone>({
    poNo: '',
    poSr: '01',
    pl: itemsMaster[0]?.pl || '29104820',
    vendorName: '',
    category: 'Regular',
    orderedQty: 10,
    origDp: '2025-12-15',
    refDp: '',
    extLd: '',
    extNoLd: '',
    dpHistory: [],
    inspectionCallDate: '2026-03-10',
    actualSupplyDate: '2026-03-22',
    baseDate: '2025-08',
    baseRate: 300000,
    cifValue: 0,
    cifCurrency: 'EUR',
    cifLagRule: 'M-1',
    freight: 8500,
    gstPct: 18,
    lowerApplicable: 'No',
    lowerPoNo: '',
    lowerBaseDate: '2025-05',
    lowerBaseRate: 285000,
    lowerCifValue: 0,
    lowerFreight: 7200,
    lowerGstPct: 18,
    remarks: '',
  });

  const totalWeight = useMemo(
    () => components.reduce((acc, c) => acc + (Number.isFinite(c.weight) ? c.weight : 0), 0),
    [components]
  );
  const isWeightValid = Math.abs(totalWeight - 1.0) <= 0.001;

  const availableSuppliersForFormPl = useMemo(
    () => getSuppliersForPl(poForm.pl, suppliersByPl, poLedger),
    [poForm.pl, suppliersByPl, poLedger]
  );

  // Available already-added POs for Lower Rate PO selection (same-PL POs first, excluding current PO Sr)
  const availableLowerPos = useMemo(() => {
    const others = poLedger.filter(
      (p, idx) =>
        idx !== editingPoIndex && !(p.poNo === poForm.poNo && p.poSr === poForm.poSr)
    );
    return [...others].sort((a, b) => {
      const aSame = a.pl === poForm.pl ? 0 : 1;
      const bSame = b.pl === poForm.pl ? 0 : 1;
      if (aSame !== bSame) return aSame - bSame;
      return a.baseRate - b.baseRate;
    });
  }, [poLedger, editingPoIndex, poForm.poNo, poForm.poSr, poForm.pl]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return itemsMaster;
    return itemsMaster.filter(
      (item) =>
        item.pl.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.components.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [itemsMaster, searchQuery]);

  const filteredPoLedger = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return poLedger.filter((po) => {
      const matchesCat = categoryFilter === 'ALL' || po.category === categoryFilter;
      const matchesPl = plFilter === 'ALL' || po.pl === plFilter;
      const matchesQuery =
        !q ||
        po.poNo.toLowerCase().includes(q) ||
        po.poSr.toLowerCase().includes(q) ||
        po.pl.toLowerCase().includes(q) ||
        po.vendorName.toLowerCase().includes(q) ||
        po.remarks.toLowerCase().includes(q);
      return matchesCat && matchesPl && matchesQuery;
    });
  }, [poLedger, searchQuery, categoryFilter, plFilter]);

  const openNewItemModal = () => {
    setEditingOriginalPl(undefined);
    setItemPl('');
    setItemName('');
    setItemSpec('CLW/ES/3/');
    setItemUnit('Set');
    setComponents([
      { name: 'Copper', weight: 0.4, timelag: 'M-2', indexAuthority: 'IEEMA Basic' },
      { name: 'Aluminium', weight: 0.2, timelag: 'M-2', indexAuthority: 'IEEMA Basic' },
      { name: 'WPI General', weight: 0.25, timelag: 'M-1', indexAuthority: 'EA WPI' },
      { name: 'Labour', weight: 0.15, timelag: 'M-3', indexAuthority: 'Labour Bureau' },
    ]);
    setIsItemModalOpen(true);
  };

  const openEditItemModal = (item: PLItem, clone = false) => {
    setEditingOriginalPl(clone ? undefined : item.pl);
    setItemPl(clone ? `${item.pl}-COPY` : item.pl);
    setItemName(clone ? `${item.name} (Copy)` : item.name);
    setItemSpec(item.specification || '');
    setItemUnit(item.unit || 'Set');
    setComponents(item.components.map((c) => ({ ...c })));
    setIsItemModalOpen(true);
  };

  const handleNormalizeWeights = () => {
    setComponents((prev) => normalizeComponentWeights(prev));
  };

  const handleSaveItemForm = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedPl = itemPl.trim();
    const trimmedName = itemName.trim();
    if (!trimmedPl || !trimmedName) {
      onNotify('PL Number and Item Name are required.', 'error');
      return;
    }
    const validComps = components.filter((c) => c.name.trim() !== '' && c.weight > 0);
    if (validComps.length === 0) {
      onNotify('Add at least one component with a positive weight.', 'error');
      return;
    }
    const sum = validComps.reduce((a, b) => a + b.weight, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      onNotify(
        `Component weights must sum to 1.0000 (currently ${sum.toFixed(4)}).`,
        'error'
      );
      return;
    }
    onSaveItem(
      {
        pl: trimmedPl,
        name: trimmedName,
        specification: itemSpec.trim() || undefined,
        unit: itemUnit.trim() || 'Set',
        components: validComps,
      },
      editingOriginalPl
    );
    setIsItemModalOpen(false);
  };

  const openNewPoModal = (preselectedPl?: string) => {
    const targetPl = preselectedPl || itemsMaster[0]?.pl || '29104820';
    const plSuppliers = getSuppliersForPl(targetPl, suppliersByPl, poLedger);
    setEditingPoIndex(undefined);
    setIsAddingNewSupplier(plSuppliers.length === 0);
    setNewSupplierInput('');
    setPoForm({
      poNo: `26251048/00${poLedger.length + 1}`,
      poSr: '01',
      pl: targetPl,
      vendorName: plSuppliers[0] || '',
      category: 'Regular',
      orderedQty: 10,
      origDp: '2025-12-15',
      refDp: '',
      extLd: '',
      extNoLd: '',
      dpHistory: [],
      inspectionCallDate: '2026-03-10',
      actualSupplyDate: '2026-03-22',
      baseDate: '2025-08',
      baseRate: 300000,
      cifValue: 0,
      cifCurrency: 'USD',
      cifLagRule: 'M-1',
      freight: 8500,
      gstPct: 18,
      lowerApplicable: 'No',
      lowerPoNo: '',
      lowerBaseDate: '2025-05',
      lowerBaseRate: 285000,
      lowerCifValue: 0,
      lowerFreight: 7200,
      lowerGstPct: 18,
      remarks: '',
    });
    setIsPoModalOpen(true);
  };

  const openAddSrModal = (sourcePo: POMilestone) => {
    const existingSrs = poLedger
      .filter((p) => p.poNo === sourcePo.poNo)
      .map((p) => parseInt(p.poSr, 10))
      .filter((n) => Number.isFinite(n));
    const nextSrNum = existingSrs.length > 0 ? Math.max(...existingSrs) + 1 : 2;
    const nextSr = nextSrNum < 10 ? `0${nextSrNum}` : String(nextSrNum);
    const plSuppliers = getSuppliersForPl(sourcePo.pl, suppliersByPl, poLedger);
    setEditingPoIndex(undefined);
    setIsAddingNewSupplier(!plSuppliers.includes(sourcePo.vendorName));
    setNewSupplierInput(!plSuppliers.includes(sourcePo.vendorName) ? sourcePo.vendorName : '');
    setPoForm({
      ...sourcePo,
      poSr: nextSr,
      orderedQty: sourcePo.orderedQty,
      origDp: sourcePo.origDp,
      refDp: '',
      extLd: '',
      extNoLd: '',
      dpHistory: [],
      inspectionCallDate: sourcePo.inspectionCallDate || '2026-03-10',
      actualSupplyDate: sourcePo.actualSupplyDate || '2026-03-22',
      remarks: `PO Sr ${nextSr} schedule for ${sourcePo.poNo}`,
    });
    setIsPoModalOpen(true);
  };

  const openEditPoModal = (po: POMilestone, index: number) => {
    const normalized = syncPoLegacyDpFields(po);
    const plSuppliers = getSuppliersForPl(normalized.pl, suppliersByPl, poLedger);
    const knownSupplier = plSuppliers.includes(normalized.vendorName);
    setEditingPoIndex(index);
    setIsAddingNewSupplier(!knownSupplier);
    setNewSupplierInput(!knownSupplier ? normalized.vendorName : '');
    setPoForm({
      ...normalized,
      dpHistory: normalized.dpHistory.map((d) => ({ ...d })),
      cifValue: normalized.cifValue ?? 0,
      cifCurrency: normalized.cifCurrency || 'USD',
      cifLagRule: normalized.cifLagRule || 'M-1',
      lowerCifValue: normalized.lowerCifValue ?? 0,
      lowerFreight: normalized.lowerFreight ?? normalized.freight ?? 0,
      lowerGstPct: normalized.lowerGstPct ?? normalized.gstPct ?? 18,
    });
    setIsPoModalOpen(true);
  };

  const handlePoPlChange = (nextPl: string) => {
    const nextSuppliers = getSuppliersForPl(nextPl, suppliersByPl, poLedger);
    setIsAddingNewSupplier(nextSuppliers.length === 0);
    setNewSupplierInput('');
    setPoForm((prev) => ({
      ...prev,
      pl: nextPl,
      vendorName: nextSuppliers[0] || '',
    }));
  };

  const handleSelectLowerPoInModal = (selected: POMilestone) => {
    setPoForm((prev) => ({
      ...prev,
      lowerPoNo: selected.poNo,
      lowerBaseDate: selected.baseDate,
      lowerBaseRate: selected.baseRate,
      lowerCifValue: selected.cifValue ?? 0,
      lowerFreight: selected.freight ?? 0,
      lowerGstPct: selected.gstPct ?? 18,
    }));
  };

  const handleAddDpHistoryRow = () => {
    setPoForm((prev) => {
      const nextSeq = prev.dpHistory.length + 1;
      const newEntry: DpHistoryEntry = {
        id: `dp-${Date.now()}-${nextSeq}`,
        seqNo: nextSeq,
        type: 'Refixed DP',
        dpDate: prev.origDp || '2026-03-31',
        applicableQty: prev.orderedQty || 1,
        amendmentRef: `MA-0${nextSeq}`,
      };
      return {
        ...prev,
        dpHistory: [...prev.dpHistory, newEntry],
      };
    });
  };

  const handleUpdateDpHistoryRow = (
    idx: number,
    patch: Partial<DpHistoryEntry>
  ) => {
    setPoForm((prev) => {
      const next = [...prev.dpHistory];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, dpHistory: next };
    });
  };

  const handleRemoveDpHistoryRow = (idx: number) => {
    setPoForm((prev) => ({
      ...prev,
      dpHistory: prev.dpHistory
        .filter((_, i) => i !== idx)
        .map((entry, i) => ({ ...entry, seqNo: i + 1 })),
    }));
  };

  const handleConfirmNewSupplierInline = () => {
    const trimmed = newSupplierInput.trim();
    if (!trimmed) {
      onNotify('Enter a supplier name to add.', 'warning');
      return;
    }
    onAddSupplier(poForm.pl, trimmed);
    setPoForm((prev) => ({ ...prev, vendorName: trimmed }));
    setIsAddingNewSupplier(false);
    setNewSupplierInput('');
  };

  const handleSavePoForm = (e: React.FormEvent) => {
    e.preventDefault();
    const finalVendor = isAddingNewSupplier
      ? newSupplierInput.trim()
      : poForm.vendorName.trim();

    if (!poForm.poNo.trim() || !poForm.pl.trim() || !poForm.origDp) {
      onNotify('PO Number, PL Number, and Original DP Date are required.', 'error');
      return;
    }
    if (!finalVendor) {
      onNotify('Select or add a Supplier Name.', 'error');
      return;
    }
    if (poForm.cifValue < 0 || poForm.cifValue > poForm.baseRate) {
      onNotify('CIF Value must be between ₹0 and the Basic Unit Rate.', 'error');
      return;
    }

    const cleanedPo = syncPoLegacyDpFields({
      ...poForm,
      poNo: poForm.poNo.trim(),
      poSr: poForm.poSr.trim() || '01',
      vendorName: finalVendor,
      cifValue: Number(poForm.cifValue) || 0,
      lowerCifValue: Number(poForm.lowerCifValue) || 0,
      lowerFreight: Number(poForm.lowerFreight) || 0,
      lowerGstPct: Number(poForm.lowerGstPct ?? poForm.gstPct ?? 18),
    });

    onAddSupplier(cleanedPo.pl, finalVendor);
    onSavePo(cleanedPo, editingPoIndex);
    setIsPoModalOpen(false);
  };

  const poBasicExclCif = Math.max(0, (poForm.baseRate || 0) - (poForm.cifValue || 0));
  const formTenderNo = extractTenderNo(poForm.poNo);

  return (
    <div className="space-y-6">
      {/* Compact Module Header & Action Toolbar (Manual PO Grouping Removed) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-xl border border-slate-200">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
            01. Item Master & PO Ledger
          </h1>
          <span className="hidden sm:inline text-xs font-mono text-slate-500 tabular-nums shrink-0">
            {itemsMaster.length} PL · {poLedger.length} PO Sr · {deemedGroups.length} Tender Groups
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:flex-none min-w-[180px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label="Search PL, PO, or Supplier"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search PL, PO, Tender, Supplier..."
              className="w-full sm:w-56 pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <button
            type="button"
            onClick={openNewItemModal}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Add PL Item
          </button>
          <button
            type="button"
            onClick={() => openNewPoModal()}
            className="px-3.5 py-2 text-xs font-semibold text-slate-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            Link PO
          </button>
        </div>
      </div>

      {/* Section 1: PO & PO Sr No Milestone Ledger */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <span>PO & Sr No Milestone Ledger</span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-500 tabular-nums">
              {filteredPoLedger.length} PO Sr Records
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter POs by PL Number"
              value={plFilter}
              onChange={(e) => setPlFilter(e.target.value)}
              className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white font-mono font-medium text-slate-700 max-w-full"
            >
              <option value="ALL">All PL Items</option>
              {itemsMaster.map((it) => (
                <option key={it.pl} value={it.pl}>
                  PL {it.pl}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              {(['ALL', 'Regular', 'Developmental'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    categoryFilter === cat
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat === 'ALL' ? 'All' : cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/70 text-slate-500 text-xs font-semibold border-b border-slate-200">
                <th className="py-3 px-4">PO No · Sr No · Tender</th>
                <th className="py-3 px-4">PL & Supplier</th>
                <th className="py-3 px-4 text-right">Basic Rate / CIF</th>
                <th className="py-3 px-4">PO Sr DP History (Qty) & Dates</th>
                <th className="py-3 px-4">Clauses</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredPoLedger.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No matching PO records.
                  </td>
                </tr>
              ) : (
                filteredPoLedger.map((po, idx) => {
                  const actualIdx = poLedger.findIndex(
                    (p) => p.poNo === po.poNo && p.poSr === po.poSr
                  );
                  const poGroups = findGroupsForPo(po.poNo, po.poSr, deemedGroups);
                  const tenderNo = extractTenderNo(po.poNo);
                  const exclCif = Math.max(0, po.baseRate - (po.cifValue || 0));
                  return (
                    <tr
                      key={`${po.poNo}-${po.poSr}-${idx}`}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-4 align-top font-mono tabular-nums">
                        <div className="font-bold text-slate-900 text-sm">{po.poNo}</div>
                        <div className="text-blue-700 font-semibold mt-0.5">
                          Sr {po.poSr} · Qty {po.orderedQty}
                        </div>
                        {tenderNo && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Tender {tenderNo}
                          </div>
                        )}
                        <div
                          className={`font-sans font-semibold mt-0.5 ${
                            po.category === 'Developmental'
                              ? 'text-emerald-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {po.category === 'Developmental' ? 'Developmental (LD=0)' : 'Regular'}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top max-w-[230px]">
                        <button
                          type="button"
                          onClick={() => onOpenIndicesForPl(po.pl)}
                          className="font-mono font-semibold text-blue-700 hover:underline tabular-nums cursor-pointer"
                        >
                          PL {po.pl}
                        </button>
                        <div className="text-slate-800 font-medium mt-0.5">{po.vendorName}</div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          Frt {formatINR(po.freight, 0)} · GST {po.gstPct}%
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top text-right font-mono tabular-nums">
                        <div className="font-bold text-slate-900">{formatINR(po.baseRate)}</div>
                        <div className="text-slate-500 text-[11px]">Base {po.baseDate}</div>
                        {(po.cifValue ?? 0) > 0 ? (
                          <div className="text-[11px] text-blue-700 mt-0.5">
                            CIF {formatINR(po.cifValue)} ({po.cifCurrency}/{po.cifLagRule})
                            <div className="text-slate-500">Excl. CIF {formatINR(exclCif)}</div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 mt-0.5">CIF Nil</div>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top font-mono tabular-nums space-y-0.5">
                        <div>
                          <span className="text-slate-500">Orig DP:</span>{' '}
                          <span className="font-semibold text-slate-900">{po.origDp}</span>{' '}
                          <span className="text-slate-500">(Qty {po.orderedQty})</span>
                        </div>
                        {(po.dpHistory || []).map((entry) => {
                          const shortLabel =
                            entry.type === 'Refixed DP'
                              ? 'Ref'
                              : entry.type === 'Extended DP (With LD)'
                                ? 'Ext LD'
                                : 'Ext No-LD';
                          const colorCls =
                            entry.type === 'Refixed DP'
                              ? 'text-blue-700'
                              : entry.type === 'Extended DP (With LD)'
                                ? 'text-amber-700'
                                : 'text-emerald-700';
                          return (
                            <div key={entry.id} className="text-[11px]">
                              <span className="text-slate-500">
                                #{entry.seqNo} {shortLabel}:
                              </span>{' '}
                              <span className={`font-semibold ${colorCls}`}>{entry.dpDate}</span>{' '}
                              <span className="text-slate-600">(Qty {entry.applicableQty})</span>
                            </div>
                          );
                        })}
                        <div className="text-[11px] text-slate-600 pt-0.5 border-t border-slate-100">
                          Call: <span className="font-semibold text-slate-800">{po.inspectionCallDate}</span>{' '}
                          · Supply: <span className="font-semibold text-slate-800">{po.actualSupplyDate}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top space-y-1">
                        {poGroups.length > 0 && (
                          <div className="font-semibold text-blue-700">
                            Tender Grp ({poGroups[0].memberPoKeys.length})
                          </div>
                        )}
                        {po.lowerApplicable === 'Yes' && (
                          <div className="text-amber-700 font-semibold">
                            Lower: {po.lowerPoNo || 'Custom'}
                            <div className="text-[11px] font-mono text-slate-600 font-normal">
                              Frt {formatINR(po.lowerFreight ?? po.freight, 0)} · GST{' '}
                              {po.lowerGstPct ?? po.gstPct}%
                            </div>
                          </div>
                        )}
                        {poGroups.length === 0 && po.lowerApplicable !== 'Yes' && (
                          <span className="text-slate-400">Standard</span>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onSelectPoForScrutiny(po, poGroups.length > 0)}
                            aria-label={`Scrutinize ${po.poNo} Sr ${po.poSr}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-blue-600 rounded-lg transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <span>Scrutinize</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openAddSrModal(po)}
                            aria-label={`Add Sr No to ${po.poNo}`}
                            title="Add new PO Sr No to this PO"
                            className="px-2 py-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap cursor-pointer"
                          >
                            + Sr
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditPoModal(po, actualIdx)}
                            aria-label={`Edit PO ${po.poNo} Sr ${po.poSr}`}
                            title="Edit PO Sr"
                            className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeletePo(actualIdx)}
                            aria-label={`Delete PO ${po.poNo} Sr ${po.poSr}`}
                            title="Delete PO Sr"
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
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

      {/* Section 2: Tender No Auto-Groups (First 8 Digits of PO No — Admin Controls) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <Layers className="w-4 h-4 text-blue-600" />
            <span>Tender Auto-Groups (8-Digit PO Prefix · Admin)</span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-500 tabular-nums">
              {deemedGroups.length} Active
            </span>
          </div>
          <button
            type="button"
            onClick={onRecreateAutoGroups}
            className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Recreate Auto-Groups
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {deemedGroups.length === 0 ? (
            <div className="col-span-full py-4 text-center text-xs text-slate-500">
              No active Tender Auto-Groups. Click "Recreate Auto-Groups" to match POs sharing an 8-digit Tender No.
            </div>
          ) : (
            deemedGroups.map((group) => {
              const nonMembers = poLedger.filter(
                (p) => !group.memberPoKeys.includes(getPoKey(p.poNo, p.poSr))
              );
              return (
                <div
                  key={group.id}
                  className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 text-sm truncate">
                        {group.name}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {group.tenderNo ? `Tender ${group.tenderNo}` : group.id} ·{' '}
                        {group.memberPoKeys.length} POs
                        {group.isAdminEdited ? ' · Admin Edited' : ' · Auto-Matched'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveTenderGroup(group.id)}
                      aria-label={`Remove group ${group.name}`}
                      title="Remove Tender Group"
                      className="px-2 py-1 text-[11px] font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-md inline-flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  </div>

                  {/* Member POs with Delete-from-Group button */}
                  <div className="flex flex-wrap gap-1.5">
                    {group.memberPoKeys.map((key) => {
                      const [poNo, poSr] = key.split('___');
                      const poObj = poLedger.find((p) => p.poNo === poNo && p.poSr === poSr);
                      return (
                        <div
                          key={key}
                          className="inline-flex items-center rounded-md bg-white border border-slate-200 overflow-hidden font-mono text-[11px]"
                        >
                          <button
                            type="button"
                            onClick={() => poObj && onSelectPoForScrutiny(poObj, true)}
                            className="px-2.5 py-1 hover:bg-blue-50 text-slate-800 transition-colors cursor-pointer"
                          >
                            {poNo} (Sr {poSr}){poObj ? ` · ${formatINR(poObj.baseRate, 0)}` : ''}
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemovePoFromGroup(group.id, key)}
                            aria-label={`Delete ${poNo} Sr ${poSr} from ${group.name}`}
                            title="Delete PO from Group"
                            className="px-1.5 py-1 text-slate-400 hover:text-red-600 hover:bg-red-50 border-l border-slate-200 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Admin Add PO to Group Control */}
                  {nonMembers.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 flex items-center gap-2">
                      <select
                        aria-label={`Add PO to ${group.name}`}
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          onAddPoToGroup(group.id, e.target.value);
                          e.target.value = '';
                        }}
                        className="flex-1 min-w-0 border border-slate-300 rounded-md px-2 py-1.5 text-[11px] font-mono bg-white text-slate-700"
                      >
                        <option value="">+ Admin: Add PO to this group...</option>
                        {nonMembers.map((p) => (
                          <option
                            key={getPoKey(p.poNo, p.poSr)}
                            value={getPoKey(p.poNo, p.poSr)}
                          >
                            {p.poNo} (Sr {p.poSr}) · PL {p.pl} · {formatINR(p.baseRate, 0)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Section 3: PL Item Master Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <span>PL Item Master</span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-500 tabular-nums">
              {filteredItems.length} Items
            </span>
          </div>
          <span className="text-xs font-mono text-slate-500 hidden sm:inline">
            P₁ = (P₀−CIF)×Σ(Wᵢ·I₁ᵢ/I₀ᵢ) + CIF×(ER₁/ER₀)×(Duty₁/Duty₀)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/70 text-slate-500 text-xs font-semibold border-b border-slate-200">
                <th className="py-3 px-4 w-36">PL Number</th>
                <th className="py-3 px-4 w-64">Item & Suppliers</th>
                <th className="py-3 px-4">PVC Components (Weight & Lag)</th>
                <th className="py-3 px-4 text-right w-48">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No matching PL items.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const plSuppliers = getSuppliersForPl(item.pl, suppliersByPl, poLedger);
                  return (
                    <tr key={item.pl} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 align-top font-mono tabular-nums">
                        <div className="font-bold text-slate-900 text-sm">{item.pl}</div>
                        <div className="text-slate-500 mt-0.5">Unit: {item.unit || 'Set'}</div>
                      </td>
                      <td className="py-3 px-4 align-top">
                        <div className="font-semibold text-slate-900 text-sm">{item.name}</div>
                        {item.specification && (
                          <div className="font-mono text-slate-500 mt-0.5">
                            {item.specification}
                          </div>
                        )}
                        <div className="text-slate-500 mt-1">
                          {plSuppliers.length} Approved Suppliers
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top">
                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                          {item.components.map((c) => (
                            <div
                              key={c.name}
                              className="p-2 rounded-lg bg-slate-50 border border-slate-200/80"
                            >
                              <div className="font-semibold text-slate-800 truncate" title={c.name}>
                                {c.name}
                              </div>
                              <div className="text-slate-500 font-mono tabular-nums mt-0.5 flex items-center justify-between">
                                <span>{(c.weight * 100).toFixed(0)}%</span>
                                <span className="font-semibold text-blue-700">{c.timelag}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top text-right">
                        <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                          <button
                            type="button"
                            onClick={() => onOpenIndicesForPl(item.pl)}
                            aria-label={`Open Monthly Indices for PL ${item.pl}`}
                            className="px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            <FileSpreadsheet className="w-3 h-3" />
                            Indices
                          </button>
                          <button
                            type="button"
                            onClick={() => openNewPoModal(item.pl)}
                            aria-label={`Link PO for PL ${item.pl}`}
                            className="px-2 py-1 text-[11px] font-semibold text-slate-800 bg-amber-100 hover:bg-amber-200 rounded-md whitespace-nowrap cursor-pointer"
                          >
                            + PO
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditItemModal(item, false)}
                            aria-label={`Edit PL Item ${item.pl}`}
                            title="Edit PL Item"
                            className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-md cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditItemModal(item, true)}
                            aria-label={`Clone PL Item ${item.pl}`}
                            title="Clone PL Item"
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteItem(item.pl)}
                            aria-label={`Delete PL Item ${item.pl}`}
                            title="Delete PL Item"
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

      {/* Modal 1: Add / Edit PL Item & Components */}
      {isItemModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PL Item Form"
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-xl max-w-2xl w-full p-5 sm:p-6 border border-slate-200 shadow-xl space-y-4 my-4 max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                {editingOriginalPl ? `Edit PL Item (${editingOriginalPl})` : 'Add PL Item'}
              </h2>
              <button
                type="button"
                aria-label="Close PL Item Modal"
                onClick={() => setIsItemModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItemForm} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="item-pl-input" className="block font-semibold text-slate-700 mb-1">
                    PL Number *
                  </label>
                  <input
                    id="item-pl-input"
                    type="text"
                    required
                    value={itemPl}
                    onChange={(e) => setItemPl(e.target.value)}
                    placeholder="29104820"
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label htmlFor="item-name-input" className="block font-semibold text-slate-700 mb-1">
                    Item Description *
                  </label>
                  <input
                    id="item-name-input"
                    type="text"
                    required
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="IGBT Propulsion Converter Assembly"
                    className="w-full border border-slate-300 rounded-lg p-2"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label htmlFor="item-spec-input" className="block font-semibold text-slate-700 mb-1">
                    Specification
                  </label>
                  <input
                    id="item-spec-input"
                    type="text"
                    value={itemSpec}
                    onChange={(e) => setItemSpec(e.target.value)}
                    placeholder="CLW/ES/3/..."
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="item-unit-input" className="block font-semibold text-slate-700 mb-1">
                    Unit
                  </label>
                  <input
                    id="item-unit-input"
                    type="text"
                    value={itemUnit}
                    onChange={(e) => setItemUnit(e.target.value)}
                    placeholder="Set"
                    className="w-full border border-slate-300 rounded-lg p-2"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800">PVC Components</span>
                    <span className="text-slate-400">·</span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        isWeightValid ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      Sum = {totalWeight.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isWeightValid && totalWeight > 0 && (
                      <button
                        type="button"
                        onClick={handleNormalizeWeights}
                        className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md cursor-pointer"
                      >
                        Normalize to 1.00
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setComponents([
                          ...components,
                          { name: '', weight: 0.1, timelag: 'M-2', indexAuthority: 'IEEMA' },
                        ])
                      }
                      className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Component
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {components.map((comp, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200"
                    >
                      <div className="col-span-5">
                        <input
                          type="text"
                          required
                          aria-label={`Component ${idx + 1} Name`}
                          placeholder="Component Name"
                          value={comp.name}
                          onChange={(e) => {
                            const next = [...components];
                            next[idx] = { ...comp, name: e.target.value };
                            setComponents(next);
                          }}
                          className="w-full border border-slate-300 rounded-md p-1.5 bg-white"
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          max="1"
                          required
                          aria-label={`Component ${idx + 1} Weight`}
                          value={comp.weight}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            const next = [...components];
                            next[idx] = { ...comp, weight: Number.isNaN(val) ? 0 : val };
                            setComponents(next);
                          }}
                          className="w-full border border-slate-300 rounded-md p-1.5 bg-white font-mono tabular-nums"
                        />
                      </div>
                      <div className="col-span-3">
                        <select
                          aria-label={`Component ${idx + 1} Time Lag`}
                          value={comp.timelag}
                          onChange={(e) => {
                            const next = [...components];
                            next[idx] = { ...comp, timelag: e.target.value as TimeLagRule };
                            setComponents(next);
                          }}
                          className="w-full border border-slate-300 rounded-md p-1.5 bg-white font-mono font-semibold"
                        >
                          {TIME_LAG_OPTIONS.map((lag) => (
                            <option key={lag} value={lag}>
                              {lag}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-1 text-right">
                        <button
                          type="button"
                          aria-label={`Remove component ${idx + 1}`}
                          onClick={() => setComponents(components.filter((_, i) => i !== idx))}
                          className="p-1 text-slate-400 hover:text-red-600 rounded-md cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsItemModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
                >
                  Save PL Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Add / Edit PO & Distinct PO Sr No Schedule */}
      {isPoModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PO Milestone Form"
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-xl max-w-3xl w-full p-5 sm:p-6 border border-slate-200 shadow-xl space-y-4 my-4 max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                {editingPoIndex !== undefined
                  ? `Edit PO ${poForm.poNo} (Sr ${poForm.poSr})`
                  : 'Link PO & PO Sr No Schedule'}
              </h2>
              <button
                type="button"
                aria-label="Close PO Modal"
                onClick={() => setIsPoModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePoForm} className="space-y-4 text-xs">
              {/* PO No, PL, Supplier & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="po-no-input" className="font-semibold text-slate-700">
                      PO Number *
                    </label>
                    {formTenderNo && (
                      <span className="font-mono text-[10px] font-semibold text-blue-700">
                        Tender {formTenderNo}
                      </span>
                    )}
                  </div>
                  <input
                    id="po-no-input"
                    type="text"
                    required
                    value={poForm.poNo}
                    onChange={(e) => setPoForm({ ...poForm, poNo: e.target.value })}
                    placeholder="26251048/004"
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="po-pl-select" className="block font-semibold text-slate-700 mb-1">
                    Linked PL No *
                  </label>
                  <select
                    id="po-pl-select"
                    value={poForm.pl}
                    onChange={(e) => handlePoPlChange(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 bg-white font-mono font-semibold"
                  >
                    {itemsMaster.map((item) => (
                      <option key={item.pl} value={item.pl}>
                        {item.pl} — {item.name.slice(0, 26)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="po-category-select" className="block font-semibold text-slate-700 mb-1">
                    PO Category *
                  </label>
                  <select
                    id="po-category-select"
                    value={poForm.category}
                    onChange={(e) =>
                      setPoForm({ ...poForm, category: e.target.value as POCategory })
                    }
                    className="w-full border border-slate-300 rounded-lg p-2 bg-white font-semibold"
                  >
                    <option value="Regular">Regular PO</option>
                    <option value="Developmental">Developmental (LD = 0)</option>
                  </select>
                </div>
              </div>

              {/* PL-Linked Supplier Dropdown + Add New Supplier */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="po-supplier-select" className="font-semibold text-slate-700">
                    Supplier Name (PL {poForm.pl}) *
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNewSupplier((prev) => !prev);
                      setNewSupplierInput('');
                    }}
                    className="text-[11px] font-semibold text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <UserPlus className="w-3 h-3" />
                    {isAddingNewSupplier ? 'Select Existing' : '+ New Supplier'}
                  </button>
                </div>

                {!isAddingNewSupplier ? (
                  <select
                    id="po-supplier-select"
                    value={poForm.vendorName}
                    onChange={(e) => {
                      if (e.target.value === ADD_NEW_SUPPLIER_VALUE) {
                        setIsAddingNewSupplier(true);
                        setNewSupplierInput('');
                      } else {
                        setPoForm({ ...poForm, vendorName: e.target.value });
                      }
                    }}
                    className="w-full border border-slate-300 rounded-lg p-2 bg-white font-medium"
                  >
                    <option value="">-- Select Supplier --</option>
                    {availableSuppliersForFormPl.map((supplier) => (
                      <option key={supplier} value={supplier}>
                        {supplier}
                      </option>
                    ))}
                    <option value={ADD_NEW_SUPPLIER_VALUE}>+ Add New Supplier...</option>
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input
                      id="po-supplier-select"
                      type="text"
                      required
                      value={newSupplierInput}
                      onChange={(e) => setNewSupplierInput(e.target.value)}
                      placeholder="Enter new supplier name"
                      className="flex-1 border border-blue-300 rounded-lg p-2 bg-white"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmNewSupplierInline}
                      className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold whitespace-nowrap cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              {/* Distinct PO Sr No Section: Orig DP, Call Date, Actual Supply Date & Multiple DP History */}
              <div className="p-3.5 rounded-lg bg-blue-50/50 border border-blue-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-blue-950">
                    PO Sr No Schedule, Dates & DP History (Sr {poForm.poSr || '01'})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddDpHistoryRow}
                    className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-white hover:bg-blue-100 border border-blue-300 rounded-md inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add DP Amendment
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div>
                    <label htmlFor="po-sr-input" className="block font-semibold text-slate-700 mb-1">
                      PO Sr No *
                    </label>
                    <input
                      id="po-sr-input"
                      type="text"
                      required
                      value={poForm.poSr}
                      onChange={(e) => setPoForm({ ...poForm, poSr: e.target.value })}
                      className="w-full border border-blue-300 rounded-lg p-2 font-mono bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label htmlFor="po-qty" className="block font-semibold text-slate-700 mb-1">
                      Sr Qty *
                    </label>
                    <input
                      id="po-qty"
                      type="number"
                      step="any"
                      min="1"
                      required
                      value={poForm.orderedQty}
                      onChange={(e) =>
                        setPoForm({ ...poForm, orderedQty: parseFloat(e.target.value) || 1 })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 font-mono tabular-nums bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="po-orig-dp" className="block font-semibold text-slate-700 mb-1">
                      Original DP *
                    </label>
                    <input
                      id="po-orig-dp"
                      type="date"
                      required
                      value={poForm.origDp}
                      onChange={(e) => setPoForm({ ...poForm, origDp: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="po-call-date" className="block font-semibold text-slate-700 mb-1">
                      Inspection Call Date *
                    </label>
                    <input
                      id="po-call-date"
                      type="date"
                      required
                      value={poForm.inspectionCallDate}
                      onChange={(e) =>
                        setPoForm({ ...poForm, inspectionCallDate: e.target.value })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="po-supply-date" className="block font-semibold text-slate-700 mb-1">
                      Actual Supply Date *
                    </label>
                    <input
                      id="po-supply-date"
                      type="date"
                      required
                      value={poForm.actualSupplyDate}
                      onChange={(e) =>
                        setPoForm({ ...poForm, actualSupplyDate: e.target.value })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
                    />
                  </div>
                </div>

                {/* DP History Records List */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-700">
                    Refixed / Extended DP History ({poForm.dpHistory.length} Records)
                  </div>
                  {poForm.dpHistory.length === 0 ? (
                    <div className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2">
                      No DP refixations or extensions logged for Sr {poForm.poSr}. Click "+ Add DP Amendment" to record history with specific quantity.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {poForm.dpHistory.map((entry, idx) => (
                        <div
                          key={entry.id}
                          className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-lg border border-blue-200"
                        >
                          <div className="col-span-4">
                            <select
                              aria-label={`DP Amendment ${idx + 1} Type`}
                              value={entry.type}
                              onChange={(e) =>
                                handleUpdateDpHistoryRow(idx, {
                                  type: e.target.value as DpAmendmentType,
                                })
                              }
                              className="w-full border border-slate-300 rounded-md p-1.5 bg-white font-medium"
                            >
                              {DP_AMENDMENT_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-3">
                            <input
                              type="date"
                              required
                              aria-label={`DP Amendment ${idx + 1} Date`}
                              value={entry.dpDate}
                              onChange={(e) =>
                                handleUpdateDpHistoryRow(idx, { dpDate: e.target.value })
                              }
                              className="w-full border border-slate-300 rounded-md p-1.5 font-mono bg-white"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="number"
                              step="any"
                              min="1"
                              required
                              aria-label={`DP Amendment ${idx + 1} Specific Qty`}
                              placeholder="Qty"
                              value={entry.applicableQty}
                              onChange={(e) =>
                                handleUpdateDpHistoryRow(idx, {
                                  applicableQty: parseFloat(e.target.value) || 1,
                                })
                              }
                              className="w-full border border-slate-300 rounded-md p-1.5 font-mono tabular-nums bg-white"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="text"
                              aria-label={`DP Amendment ${idx + 1} Ref`}
                              placeholder="MA Ref"
                              value={entry.amendmentRef || ''}
                              onChange={(e) =>
                                handleUpdateDpHistoryRow(idx, { amendmentRef: e.target.value })
                              }
                              className="w-full border border-slate-300 rounded-md p-1.5 font-mono bg-white"
                            />
                          </div>
                          <div className="col-span-1 text-right">
                            <button
                              type="button"
                              aria-label={`Remove DP Amendment ${idx + 1}`}
                              onClick={() => handleRemoveDpHistoryRow(idx)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded-md cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Basic Rate & CIF Value Details */}
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Rate, CIF, Freight & GST</span>
                  <span className="font-mono text-blue-700 font-semibold tabular-nums">
                    Basic Excl. CIF: {formatINR(poBasicExclCif)}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="po-base-date" className="block font-semibold text-slate-700 mb-1">
                      Base Month *
                    </label>
                    <input
                      id="po-base-date"
                      type="month"
                      required
                      value={poForm.baseDate}
                      onChange={(e) => setPoForm({ ...poForm, baseDate: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="po-base-rate" className="block font-semibold text-slate-700 mb-1">
                      Basic Rate Incl. CIF (₹) *
                    </label>
                    <input
                      id="po-base-rate"
                      type="number"
                      step="any"
                      required
                      value={poForm.baseRate}
                      onChange={(e) =>
                        setPoForm({ ...poForm, baseRate: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 font-mono tabular-nums bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="po-cif-value" className="block font-semibold text-slate-700 mb-1">
                      CIF Value in Basic (₹)
                    </label>
                    <input
                      id="po-cif-value"
                      type="number"
                      step="any"
                      min="0"
                      value={poForm.cifValue}
                      onChange={(e) =>
                        setPoForm({ ...poForm, cifValue: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 font-mono tabular-nums bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label htmlFor="po-cif-currency" className="block font-semibold text-slate-700 mb-1">
                        Currency
                      </label>
                      <select
                        id="po-cif-currency"
                        value={poForm.cifCurrency}
                        onChange={(e) =>
                          setPoForm({ ...poForm, cifCurrency: e.target.value as CurrencyCode })
                        }
                        className="w-full border border-slate-300 rounded-lg p-2 bg-white font-mono font-semibold"
                      >
                        {CURRENCY_OPTIONS.map((cur) => (
                          <option key={cur} value={cur}>
                            {cur}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="po-cif-lag" className="block font-semibold text-slate-700 mb-1">
                        CIF Lag
                      </label>
                      <select
                        id="po-cif-lag"
                        value={poForm.cifLagRule}
                        onChange={(e) =>
                          setPoForm({ ...poForm, cifLagRule: e.target.value as TimeLagRule })
                        }
                        className="w-full border border-slate-300 rounded-lg p-2 bg-white font-mono font-semibold"
                      >
                        {TIME_LAG_OPTIONS.map((lag) => (
                          <option key={lag} value={lag}>
                            {lag}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="po-freight" className="block font-semibold text-slate-700 mb-1">
                      Freight / Unit (₹)
                    </label>
                    <input
                      id="po-freight"
                      type="number"
                      step="any"
                      value={poForm.freight}
                      onChange={(e) =>
                        setPoForm({ ...poForm, freight: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 font-mono tabular-nums bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="po-gst" className="block font-semibold text-slate-700 mb-1">
                      GST (%)
                    </label>
                    <input
                      id="po-gst"
                      type="number"
                      step="any"
                      value={poForm.gstPct}
                      onChange={(e) =>
                        setPoForm({ ...poForm, gstPct: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full border border-slate-300 rounded-lg p-2 font-mono tabular-nums bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Lower Rate PO Reference with Available PO Picker, Freight & GST % */}
              <div className="p-3 rounded-lg bg-amber-50/50 border border-amber-200/80 space-y-3">
                <div className="flex items-center gap-2 font-semibold text-slate-800">
                  <input
                    id="po-lower-applicable"
                    type="checkbox"
                    checked={poForm.lowerApplicable === 'Yes'}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      if (checked && !poForm.lowerPoNo && availableLowerPos.length > 0) {
                        const first = availableLowerPos[0];
                        setPoForm({
                          ...poForm,
                          lowerApplicable: 'Yes',
                          lowerPoNo: first.poNo,
                          lowerBaseDate: first.baseDate,
                          lowerBaseRate: first.baseRate,
                          lowerCifValue: first.cifValue ?? 0,
                          lowerFreight: first.freight ?? 0,
                          lowerGstPct: first.gstPct ?? 18,
                        });
                      } else {
                        setPoForm({
                          ...poForm,
                          lowerApplicable: checked ? 'Yes' : 'No',
                        });
                      }
                    }}
                    className="w-4 h-4 text-amber-600 rounded border-amber-300 cursor-pointer"
                  />
                  <label htmlFor="po-lower-applicable" className="cursor-pointer">
                    Lower Rate PO Applicable (incl. Freight & GST %)
                  </label>
                </div>

                {poForm.lowerApplicable === 'Yes' && (
                  <div className="space-y-3 pt-2 border-t border-amber-200/70">
                    <div>
                      <label
                        htmlFor="po-available-lower-select"
                        className="block font-semibold text-slate-700 mb-1"
                      >
                        Select from Available POs ({availableLowerPos.length})
                      </label>
                      <select
                        id="po-available-lower-select"
                        value={
                          availableLowerPos.find((p) => p.poNo === poForm.lowerPoNo)
                            ? getPoKey(
                                availableLowerPos.find((p) => p.poNo === poForm.lowerPoNo)!.poNo,
                                availableLowerPos.find((p) => p.poNo === poForm.lowerPoNo)!.poSr
                              )
                            : '__CUSTOM__'
                        }
                        onChange={(e) => {
                          const key = e.target.value;
                          if (key === '__CUSTOM__') return;
                          const found = availableLowerPos.find(
                            (p) => getPoKey(p.poNo, p.poSr) === key
                          );
                          if (found) handleSelectLowerPoInModal(found);
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
                        <div className="mt-2 max-h-28 overflow-y-auto rounded-lg border border-amber-200 bg-white divide-y divide-slate-200">
                          {availableLowerPos.map((p) => {
                            const isSelected = p.poNo === poForm.lowerPoNo;
                            return (
                              <button
                                key={getPoKey(p.poNo, p.poSr)}
                                type="button"
                                onClick={() => handleSelectLowerPoInModal(p)}
                                className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px] transition-colors cursor-pointer ${
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

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label htmlFor="po-lower-no" className="block font-semibold text-slate-700 mb-1">
                          Lower PO No
                        </label>
                        <input
                          id="po-lower-no"
                          type="text"
                          value={poForm.lowerPoNo || ''}
                          onChange={(e) => setPoForm({ ...poForm, lowerPoNo: e.target.value })}
                          className="w-full border border-slate-300 rounded-lg p-1.5 font-mono bg-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="po-lower-base-date" className="block font-semibold text-slate-700 mb-1">
                          Lower Base Month
                        </label>
                        <input
                          id="po-lower-base-date"
                          type="month"
                          value={poForm.lowerBaseDate || ''}
                          onChange={(e) => setPoForm({ ...poForm, lowerBaseDate: e.target.value })}
                          className="w-full border border-slate-300 rounded-lg p-1.5 font-mono bg-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="po-lower-rate" className="block font-semibold text-slate-700 mb-1">
                          Lower Rate (₹)
                        </label>
                        <input
                          id="po-lower-rate"
                          type="number"
                          step="any"
                          value={poForm.lowerBaseRate || 0}
                          onChange={(e) =>
                            setPoForm({
                              ...poForm,
                              lowerBaseRate: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full border border-slate-300 rounded-lg p-1.5 font-mono bg-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="po-lower-cif" className="block font-semibold text-slate-700 mb-1">
                          Lower CIF (₹)
                        </label>
                        <input
                          id="po-lower-cif"
                          type="number"
                          step="any"
                          value={poForm.lowerCifValue || 0}
                          onChange={(e) =>
                            setPoForm({
                              ...poForm,
                              lowerCifValue: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full border border-slate-300 rounded-lg p-1.5 font-mono bg-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="po-lower-freight" className="block font-semibold text-slate-700 mb-1">
                          Lower Freight (₹)
                        </label>
                        <input
                          id="po-lower-freight"
                          type="number"
                          step="any"
                          min="0"
                          value={poForm.lowerFreight ?? 0}
                          onChange={(e) =>
                            setPoForm({
                              ...poForm,
                              lowerFreight: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full border border-amber-300 rounded-lg p-1.5 font-mono bg-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="po-lower-gst" className="block font-semibold text-slate-700 mb-1">
                          Lower GST (%)
                        </label>
                        <input
                          id="po-lower-gst"
                          type="number"
                          step="any"
                          min="0"
                          value={poForm.lowerGstPct ?? 18}
                          onChange={(e) =>
                            setPoForm({
                              ...poForm,
                              lowerGstPct: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full border border-amber-300 rounded-lg p-1.5 font-mono bg-white"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="po-remarks" className="block font-semibold text-slate-700 mb-1">
                  Remarks
                </label>
                <textarea
                  id="po-remarks"
                  rows={2}
                  value={poForm.remarks}
                  onChange={(e) => setPoForm({ ...poForm, remarks: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsPoModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold cursor-pointer"
                >
                  Save PO Sr Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
