import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_DEEMED_GROUPS,
  INITIAL_PO_LEDGER,
  INITIAL_SUPPLIERS_BY_PL,
} from '../data/initialData';
import { POMilestone } from '../types/pvc';
import {
  buildTransactionFromPo,
  escapeCsvCell,
  extractTenderNo,
  getPathForTab,
  getSuppliersForPl,
  normalizeComponentWeights,
  parseTabFromLocation,
  registerSupplierForPl,
  syncPoLegacyDpFields,
  syncTenderAutoGroups,
} from './navigation';

test('parseTabFromLocation and getPathForTab round-trip routes and hashes', () => {
  assert.equal(getPathForTab('master'), '/');
  assert.equal(getPathForTab('indices'), '/indices');
  assert.equal(getPathForTab('transaction'), '/scrutiny');
  assert.equal(getPathForTab('report'), '/statement');

  assert.equal(parseTabFromLocation('/'), 'master');
  assert.equal(parseTabFromLocation('/indices'), 'indices');
  assert.equal(parseTabFromLocation('/scrutiny'), 'transaction');
  assert.equal(parseTabFromLocation('/statement'), 'report');
  assert.equal(parseTabFromLocation('/', '#indices'), 'indices');
  assert.equal(parseTabFromLocation('/', '#report'), 'report');
  assert.equal(parseTabFromLocation('/unknown'), 'master');
});

test('normalizeComponentWeights normalizes arbitrary weights to exact sum 1.0000', () => {
  const normalized = normalizeComponentWeights([
    { name: 'Copper', weight: 2, timelag: 'M-2' },
    { name: 'Aluminium', weight: 1, timelag: 'M-2' },
    { name: 'Labour', weight: 1, timelag: 'M-3' },
  ]);
  const sum = normalized.reduce((acc, c) => acc + c.weight, 0);
  assert.equal(Number(sum.toFixed(4)), 1);
  assert.equal(normalized[0].weight, 0.5);
  assert.equal(normalized[1].weight, 0.25);
  assert.equal(normalized[2].weight, 0.25);
});

test('escapeCsvCell properly escapes commas, quotes, and newlines', () => {
  assert.equal(escapeCsvCell('Simple'), 'Simple');
  assert.equal(escapeCsvCell('Medha, Hyderabad'), '"Medha, Hyderabad"');
  assert.equal(escapeCsvCell('Quote "A"'), '"Quote ""A"""');
  assert.equal(escapeCsvCell(null), '');
});

test('extractTenderNo extracts the first 8 digits from PO numbers', () => {
  assert.equal(extractTenderNo('26251048/001'), '26251048');
  assert.equal(extractTenderNo('26251048-002'), '26251048');
  assert.equal(extractTenderNo('PO-26251412/99'), '26251412');
  assert.equal(extractTenderNo('1234'), '');
});

test('syncTenderAutoGroups automatically groups POs sharing 8-digit Tender No and honors admin dismissals & edits', () => {
  const autoGroups = syncTenderAutoGroups(INITIAL_PO_LEDGER, [], []);
  assert.equal(autoGroups.length, 2);
  const tnd1 = autoGroups.find((g) => g.tenderNo === '26251048');
  const tnd2 = autoGroups.find((g) => g.tenderNo === '26251412');
  assert.ok(tnd1);
  assert.equal(tnd1.memberPoKeys.length, 3);
  assert.ok(tnd2);
  assert.equal(tnd2.memberPoKeys.length, 2);

  // Dismissing tender 26251048 keeps it removed during sync
  const afterDismiss = syncTenderAutoGroups(INITIAL_PO_LEDGER, autoGroups, ['26251048']);
  assert.equal(afterDismiss.some((g) => g.tenderNo === '26251048'), false);
  assert.equal(afterDismiss.some((g) => g.tenderNo === '26251412'), true);

  // Admin-edited group preserves custom membership
  const edited = [
    {
      ...tnd1,
      isAdminEdited: true,
      memberPoKeys: ['26251048/001___01', '26251048/002___01'],
    },
  ];
  const syncedEdited = syncTenderAutoGroups(INITIAL_PO_LEDGER, edited, []);
  const preserved = syncedEdited.find((g) => g.tenderNo === '26251048');
  assert.ok(preserved);
  assert.deepEqual(preserved.memberPoKeys, ['26251048/001___01', '26251048/002___01']);
});

test('syncPoLegacyDpFields orders DP history chronologically and syncs latest refDp/extLd/extNoLd', () => {
  const po: POMilestone = {
    ...INITIAL_PO_LEDGER[0],
    refDp: '',
    extLd: '',
    extNoLd: '',
    dpHistory: [
      {
        id: 'h2',
        seqNo: 2,
        type: 'Extended DP (With LD)',
        dpDate: '2026-04-30',
        applicableQty: 3,
      },
      {
        id: 'h1',
        seqNo: 1,
        type: 'Refixed DP',
        dpDate: '2026-01-31',
        applicableQty: 7,
      },
      {
        id: 'h3',
        seqNo: 3,
        type: 'Refixed DP',
        dpDate: '2026-02-28',
        applicableQty: 5,
      },
    ],
  };

  const synced = syncPoLegacyDpFields(po);
  assert.equal(synced.dpHistory[0].dpDate, '2026-01-31');
  assert.equal(synced.dpHistory[0].seqNo, 1);
  assert.equal(synced.dpHistory[1].dpDate, '2026-02-28');
  assert.equal(synced.dpHistory[1].seqNo, 2);
  assert.equal(synced.dpHistory[2].dpDate, '2026-04-30');
  assert.equal(synced.dpHistory[2].seqNo, 3);
  assert.equal(synced.refDp, '2026-02-28');
  assert.equal(synced.extLd, '2026-04-30');
  assert.equal(synced.extNoLd, '');
});

test('getSuppliersForPl and registerSupplierForPl deduplicate and sort suppliers per PL', () => {
  const list = getSuppliersForPl('29104820', INITIAL_SUPPLIERS_BY_PL, INITIAL_PO_LEDGER);
  assert.ok(list.includes('Medha Servo Drives Pvt. Ltd., Hyderabad'));
  assert.ok(list.includes('BHEL Electronics Division, Bengaluru'));

  const updated = registerSupplierForPl(
    INITIAL_SUPPLIERS_BY_PL,
    '29104820',
    'Siemens Traction Systems, Nashik'
  );
  assert.ok(updated['29104820'].includes('Siemens Traction Systems, Nashik'));

  const dupAttempt = registerSupplierForPl(
    updated,
    '29104820',
    'siemens traction systems, nashik'
  );
  assert.equal(dupAttempt['29104820'].length, updated['29104820'].length);
});

test('buildTransactionFromPo pulls PO Sr No dates, CIF, and Lower Freight & GST%', () => {
  const po = INITIAL_PO_LEDGER[0];
  const tx = buildTransactionFromPo(po, INITIAL_DEEMED_GROUPS);
  assert.equal(tx.poNo, po.poNo);
  assert.equal(tx.poSr, po.poSr);
  assert.equal(tx.inspectionCallDate, po.inspectionCallDate);
  assert.equal(tx.actualSupplyDate, po.actualSupplyDate);
  assert.equal(tx.lowerFreight, po.lowerFreight);
  assert.equal(tx.lowerGstPct, po.lowerGstPct);
  assert.equal(tx.isDeemedPvc, true);

  const txDisabled = buildTransactionFromPo(po, INITIAL_DEEMED_GROUPS, false);
  assert.equal(txDisabled.isDeemedPvc, false);
});
