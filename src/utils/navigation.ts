import {
  DeemedPvcPoGroup,
  DpHistoryEntry,
  POMilestone,
  PVCComponent,
  ScrutinyTransactionInput,
  SuppliersByPlMap,
} from '../types/pvc';
import { findGroupsForPo, getPoKey } from './pvcEngine';

export type ActiveTab = 'master' | 'indices' | 'transaction' | 'report';

export interface NavItemConfig {
  id: ActiveTab;
  path: string;
  shortLabel: string;
  mobileLabel: string;
  title: string;
}

export const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'master',
    path: '/',
    shortLabel: 'Master & PO',
    mobileLabel: '01. Master',
    title: 'Item Master & PO Ledger',
  },
  {
    id: 'indices',
    path: '/indices',
    shortLabel: 'Monthly Indices',
    mobileLabel: '02. Indices',
    title: 'Monthly Indices Feed',
  },
  {
    id: 'transaction',
    path: '/scrutiny',
    shortLabel: 'Scrutiny Engine',
    mobileLabel: '03. Scrutiny',
    title: 'Transaction & Scrutiny Engine',
  },
  {
    id: 'report',
    path: '/statement',
    shortLabel: 'Audit Statement',
    mobileLabel: '04. Audit',
    title: 'Audit Scrutiny Statement',
  },
];

export function getPathForTab(tab: ActiveTab): string {
  const found = NAV_ITEMS.find((item) => item.id === tab);
  return found ? found.path : '/';
}

export function parseTabFromLocation(pathname: string, hash = ''): ActiveTab {
  const normalizedHash = hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (normalizedHash === 'indices') return 'indices';
  if (normalizedHash === 'transaction' || normalizedHash === 'scrutiny') return 'transaction';
  if (normalizedHash === 'report' || normalizedHash === 'statement') return 'report';
  if (normalizedHash === 'master') return 'master';

  const normalizedPath = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  if (normalizedPath === '/indices') return 'indices';
  if (normalizedPath === '/scrutiny' || normalizedPath === '/transaction') return 'transaction';
  if (normalizedPath === '/statement' || normalizedPath === '/report') return 'report';
  return 'master';
}

export function normalizeComponentWeights(components: PVCComponent[]): PVCComponent[] {
  const totalWeight = components.reduce(
    (acc, c) => acc + (Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0),
    0
  );
  if (totalWeight <= 0 || components.length === 0) return components;

  let runningSum = 0;
  return components.map((c, idx) => {
    if (idx === components.length - 1) {
      return {
        ...c,
        weight: Number(Math.max(0, 1 - runningSum).toFixed(4)),
      };
    }
    const safeWeight = Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0;
    const normalized = Number((safeWeight / totalWeight).toFixed(4));
    runningSum += normalized;
    return {
      ...c,
      weight: normalized,
    };
  });
}

export function escapeCsvCell(value: string | number | undefined | null): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Extracts the 8-digit Tender No prefix from a PO Number.
 * E.g. "26251048/001" -> "26251048", "26251048-002" -> "26251048".
 */
export function extractTenderNo(poNo: string): string {
  const trimmed = (poNo || '').trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 8) {
    return digits.slice(0, 8);
  }
  const compact = trimmed.replace(/\s+/g, '');
  return compact.length >= 8 ? compact.slice(0, 8).toUpperCase() : '';
}

/**
 * Normalizes a PO Sr No record:
 * - Backfills dpHistory from legacy refDp/extLd/extNoLd if empty
 * - Keeps dpHistory ordered chronologically with sequential seqNo
 * - Syncs latest refDp, extLd, extNoLd back onto the record
 */
export function syncPoLegacyDpFields(po: POMilestone): POMilestone {
  const fallbackQty = Number.isFinite(po.orderedQty) && po.orderedQty > 0 ? po.orderedQty : 1;
  let history: DpHistoryEntry[] = Array.isArray(po.dpHistory)
    ? po.dpHistory
        .filter((entry) => entry && typeof entry.dpDate === 'string' && entry.dpDate.trim() !== '')
        .map((entry, idx) => ({
          ...entry,
          id: entry.id || `dp-${po.poNo}-${po.poSr}-${idx + 1}`,
          seqNo: idx + 1,
          dpDate: entry.dpDate.trim(),
          applicableQty:
            Number.isFinite(entry.applicableQty) && entry.applicableQty > 0
              ? entry.applicableQty
              : fallbackQty,
        }))
    : [];

  if (history.length === 0) {
    const legacy: DpHistoryEntry[] = [];
    if (po.refDp) {
      legacy.push({
        id: `dp-${po.poNo}-${po.poSr}-ref`,
        seqNo: legacy.length + 1,
        type: 'Refixed DP',
        dpDate: po.refDp,
        applicableQty: fallbackQty,
      });
    }
    if (po.extLd) {
      legacy.push({
        id: `dp-${po.poNo}-${po.poSr}-extld`,
        seqNo: legacy.length + 1,
        type: 'Extended DP (With LD)',
        dpDate: po.extLd,
        applicableQty: fallbackQty,
      });
    }
    if (po.extNoLd) {
      legacy.push({
        id: `dp-${po.poNo}-${po.poSr}-extnold`,
        seqNo: legacy.length + 1,
        type: 'Extended DP (Without LD)',
        dpDate: po.extNoLd,
        applicableQty: fallbackQty,
      });
    }
    history = legacy;
  }

  history.sort((a, b) => a.dpDate.localeCompare(b.dpDate));
  history = history.map((entry, idx) => ({ ...entry, seqNo: idx + 1 }));

  const latestByType = (type: DpHistoryEntry['type']): string => {
    const matching = history.filter((e) => e.type === type);
    return matching.length > 0 ? matching[matching.length - 1].dpDate : '';
  };

  return {
    ...po,
    orderedQty: fallbackQty,
    dpHistory: history,
    refDp: latestByType('Refixed DP'),
    extLd: latestByType('Extended DP (With LD)'),
    extNoLd: latestByType('Extended DP (Without LD)'),
    inspectionCallDate: po.inspectionCallDate || po.origDp || '2026-03-10',
    actualSupplyDate: po.actualSupplyDate || po.inspectionCallDate || po.origDp || '2026-03-22',
    lowerFreight:
      typeof po.lowerFreight === 'number' && Number.isFinite(po.lowerFreight)
        ? po.lowerFreight
        : po.freight ?? 0,
    lowerGstPct:
      typeof po.lowerGstPct === 'number' && Number.isFinite(po.lowerGstPct)
        ? po.lowerGstPct
        : po.gstPct ?? 18,
  };
}

/**
 * Automatically creates & synchronizes PO groups whenever 2+ PO records share
 * the same 8-digit Tender No prefix, while honoring admin removals (`dismissedTenderNos`)
 * and admin manual edits (`isAdminEdited`).
 */
export function syncTenderAutoGroups(
  poLedger: POMilestone[],
  existingGroups: DeemedPvcPoGroup[],
  dismissedTenderNos: string[] = []
): DeemedPvcPoGroup[] {
  const validKeys = new Set(poLedger.map((p) => getPoKey(p.poNo, p.poSr)));
  const dismissedSet = new Set(dismissedTenderNos);

  const tenderMap = new Map<string, string[]>();
  poLedger.forEach((po) => {
    const tenderNo = extractTenderNo(po.poNo);
    if (!tenderNo) return;
    const key = getPoKey(po.poNo, po.poSr);
    const list = tenderMap.get(tenderNo) || [];
    if (!list.includes(key)) list.push(key);
    tenderMap.set(tenderNo, list);
  });

  const result: DeemedPvcPoGroup[] = [];
  const handledTenders = new Set<string>();

  existingGroups.forEach((grp) => {
    const prunedKeys = Array.from(new Set(grp.memberPoKeys.filter((k) => validKeys.has(k))));
    const tenderNo = grp.tenderNo;

    if (grp.isAutoTenderGroup && tenderNo) {
      if (dismissedSet.has(tenderNo)) {
        return;
      }
      handledTenders.add(tenderNo);
      if (grp.isAdminEdited) {
        if (prunedKeys.length > 0) {
          result.push({ ...grp, memberPoKeys: prunedKeys });
        }
        return;
      }
      const matchedKeys = tenderMap.get(tenderNo) || [];
      if (matchedKeys.length >= 2) {
        result.push({
          ...grp,
          memberPoKeys: matchedKeys,
        });
      }
      return;
    }

    // Custom / admin-retained group
    if (prunedKeys.length > 0) {
      result.push({ ...grp, memberPoKeys: prunedKeys });
    }
  });

  // Create new automatic Tender groups for any 8-digit Tender No with 2+ POs
  tenderMap.forEach((keys, tenderNo) => {
    if (keys.length < 2) return;
    if (handledTenders.has(tenderNo) || dismissedSet.has(tenderNo)) return;
    result.push({
      id: `TND-${tenderNo}`,
      name: `Tender ${tenderNo} — Auto PO Group`,
      tenderNo,
      isAutoTenderGroup: true,
      isAdminEdited: false,
      memberPoKeys: keys,
      createdAt: new Date().toISOString().slice(0, 10),
      remarks: `Auto-grouped by 8-digit Tender No ${tenderNo}`,
    });
  });

  return result;
}

export function getSuppliersForPl(
  pl: string,
  suppliersByPl: SuppliersByPlMap,
  poLedger: POMilestone[]
): string[] {
  const merged = new Set<string>();
  (suppliersByPl[pl] || []).forEach((s) => {
    const trimmed = s.trim();
    if (trimmed) merged.add(trimmed);
  });
  poLedger
    .filter((po) => po.pl === pl)
    .forEach((po) => {
      const trimmed = po.vendorName.trim();
      if (trimmed) merged.add(trimmed);
    });
  return Array.from(merged).sort((a, b) => a.localeCompare(b));
}

export function registerSupplierForPl(
  suppliersByPl: SuppliersByPlMap,
  pl: string,
  vendorName: string
): SuppliersByPlMap {
  const trimmedPl = pl.trim();
  const trimmedVendor = vendorName.trim();
  if (!trimmedPl || !trimmedVendor) return suppliersByPl;
  const existing = suppliersByPl[trimmedPl] || [];
  if (existing.some((s) => s.toLowerCase() === trimmedVendor.toLowerCase())) {
    return suppliersByPl;
  }
  return {
    ...suppliersByPl,
    [trimmedPl]: [...existing, trimmedVendor],
  };
}

export function buildTransactionFromPo(
  po: POMilestone,
  groups: DeemedPvcPoGroup[],
  enableDeemedOverride?: boolean
): ScrutinyTransactionInput {
  const matchingGroups = findGroupsForPo(po.poNo, po.poSr, groups);
  const isDeemedPvc =
    typeof enableDeemedOverride === 'boolean'
      ? enableDeemedOverride
      : matchingGroups.length > 0;

  return {
    poNo: po.poNo,
    poSr: po.poSr,
    inspectionCallDate: po.inspectionCallDate || '2026-03-10',
    actualSupplyDate: po.actualSupplyDate || '2026-03-22',
    billRef: `INV-${po.poNo.slice(-3)}-SR${po.poSr}`,
    rNoteNo: `RN-CLW-${po.poSr}-2026`,
    baseDate: po.baseDate || '2025-08',
    baseRate: po.baseRate || 300000,
    cifValue: po.cifValue ?? 0,
    cifCurrency: po.cifCurrency || 'USD',
    cifLagRule: po.cifLagRule || 'M-1',
    freight: po.freight ?? 8500,
    gstPct: po.gstPct ?? 18,
    qty: po.orderedQty || 10,
    isDeemedPvc,
    deemedGroupId: matchingGroups[0]?.id ?? (isDeemedPvc ? groups[0]?.id : undefined),
    useLowerRate: po.lowerApplicable === 'Yes',
    lowerPoNo: po.lowerPoNo || '',
    lowerBaseDate: po.lowerBaseDate || '2025-05',
    lowerBaseRate: po.lowerBaseRate || 285000,
    lowerCifValue: po.lowerCifValue ?? 0,
    lowerFreight: po.lowerFreight ?? po.freight ?? 0,
    lowerGstPct: po.lowerGstPct ?? po.gstPct ?? 18,
  };
}
