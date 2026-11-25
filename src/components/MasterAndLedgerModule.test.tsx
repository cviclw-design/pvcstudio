import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { setupTestDom } from '../test/domSetup';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  INITIAL_DEEMED_GROUPS,
  INITIAL_ITEMS_MASTER,
  INITIAL_PO_LEDGER,
  INITIAL_SUPPLIERS_BY_PL,
} from '../data/initialData';
import { POMilestone } from '../types/pvc';
import { MasterAndLedgerModule } from './MasterAndLedgerModule';

setupTestDom();

test('MasterAndLedgerModule renders 8-digit Tender POs, DP history with qty, removes manual Deemed Group button, and triggers Admin Tender Group controls', () => {
  cleanup();
  let scrutinizedPo: POMilestone | null = null;
  let openedIndicesPl = '';
  let recreatedCount = 0;
  let removedGroupId = '';
  let removedPoFromGroup: { groupId: string; poKey: string } | null = null;
  let addedPoToGroup: { groupId: string; poKey: string } | null = null;

  render(
    React.createElement(MasterAndLedgerModule, {
      itemsMaster: INITIAL_ITEMS_MASTER,
      poLedger: INITIAL_PO_LEDGER,
      deemedGroups: INITIAL_DEEMED_GROUPS,
      suppliersByPl: INITIAL_SUPPLIERS_BY_PL,
      onSaveItem: () => {},
      onDeleteItem: () => {},
      onSavePo: () => {},
      onDeletePo: () => {},
      onAddSupplier: () => {},
      onRecreateAutoGroups: () => {
        recreatedCount += 1;
      },
      onRemoveTenderGroup: (id) => {
        removedGroupId = id;
      },
      onAddPoToGroup: (groupId, poKey) => {
        addedPoToGroup = { groupId, poKey };
      },
      onRemovePoFromGroup: (groupId, poKey) => {
        removedPoFromGroup = { groupId, poKey };
      },
      onSelectPoForScrutiny: (po) => {
        scrutinizedPo = po;
      },
      onOpenIndicesForPl: (pl) => {
        openedIndicesPl = pl;
      },
      onNotify: () => {},
    })
  );

  // Manual top-bar "Deemed Group" button must be removed
  assert.equal(screen.queryByRole('button', { name: 'Deemed Group' }), null);

  // Renders Tender POs & distinct PO Sr No records
  assert.ok(screen.getByText('26251048/001'));
  assert.ok(screen.getByText('26251048/003'));
  assert.ok(screen.getAllByText('26251412/001').length === 2);

  // Admin Tender Group controls
  fireEvent.click(screen.getByRole('button', { name: /Recreate Auto-Groups/i }));
  assert.equal(recreatedCount, 1);

  fireEvent.click(
    screen.getByRole('button', {
      name: 'Delete 26251048/003 Sr 01 from Tender 26251048 — Auto PO Group',
    })
  );
  assert.deepEqual(removedPoFromGroup, {
    groupId: 'TND-26251048',
    poKey: '26251048/003___01',
  });

  const addPoSelect = screen.getByLabelText(
    'Add PO to Tender 26251048 — Auto PO Group'
  ) as HTMLSelectElement;
  fireEvent.change(addPoSelect, { target: { value: '26251780/001___01' } });
  assert.deepEqual(addedPoToGroup, {
    groupId: 'TND-26251048',
    poKey: '26251780/001___01',
  });

  fireEvent.click(
    screen.getByRole('button', { name: 'Remove group Tender 26251048 — Auto PO Group' })
  );
  assert.equal(removedGroupId, 'TND-26251048');

  // Filter by Developmental category
  fireEvent.click(screen.getByRole('button', { name: 'Developmental' }));
  assert.ok(screen.getByText('26251048/003'));
  assert.equal(screen.queryByText('26251048/001'), null);

  // Reset to All and click Scrutinize
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scrutinize 26251048/001 Sr 01' }));
  assert.equal((scrutinizedPo as POMilestone | null)?.poNo, '26251048/001');

  // Click Indices quick link on PL item
  fireEvent.click(screen.getByRole('button', { name: 'Open Monthly Indices for PL 29140112' }));
  assert.equal(openedIndicesPl, '29140112');
  cleanup();
});

test('MasterAndLedgerModule PO modal saves PO Sr No DP history with specific qty, Call/Supply dates, and Lower PO Freight & GST%', () => {
  cleanup();
  let savedPo: POMilestone | null = null;
  const addedSuppliers: Array<{ pl: string; vendor: string }> = [];

  render(
    React.createElement(MasterAndLedgerModule, {
      itemsMaster: INITIAL_ITEMS_MASTER,
      poLedger: INITIAL_PO_LEDGER,
      deemedGroups: INITIAL_DEEMED_GROUPS,
      suppliersByPl: INITIAL_SUPPLIERS_BY_PL,
      onSaveItem: () => {},
      onDeleteItem: () => {},
      onSavePo: (po) => {
        savedPo = po;
      },
      onDeletePo: () => {},
      onAddSupplier: (pl, vendor) => {
        addedSuppliers.push({ pl, vendor });
      },
      onRecreateAutoGroups: () => {},
      onRemoveTenderGroup: () => {},
      onAddPoToGroup: () => {},
      onRemovePoFromGroup: () => {},
      onSelectPoForScrutiny: () => {},
      onOpenIndicesForPl: () => {},
      onNotify: () => {},
    })
  );

  // Click "+ Sr" on 26251048/001 to attach a distinct PO Sr No ("02")
  fireEvent.click(screen.getByRole('button', { name: 'Add Sr No to 26251048/001' }));
  assert.equal((screen.getByLabelText(/PO Sr No/i) as HTMLInputElement).value, '02');

  // Set distinct Call & Supply dates for Sr 02
  fireEvent.change(screen.getByLabelText(/Inspection Call Date/i), {
    target: { value: '2026-03-05' },
  });
  fireEvent.change(screen.getByLabelText(/Actual Supply Date/i), {
    target: { value: '2026-03-19' },
  });

  // Add 2 DP Amendments with specific quantities
  fireEvent.click(screen.getByRole('button', { name: /Add DP Amendment/i }));
  fireEvent.change(screen.getByLabelText('DP Amendment 1 Type'), {
    target: { value: 'Refixed DP' },
  });
  fireEvent.change(screen.getByLabelText('DP Amendment 1 Date'), {
    target: { value: '2026-01-25' },
  });
  fireEvent.change(screen.getByLabelText('DP Amendment 1 Specific Qty'), {
    target: { value: '6' },
  });

  fireEvent.click(screen.getByRole('button', { name: /Add DP Amendment/i }));
  fireEvent.change(screen.getByLabelText('DP Amendment 2 Type'), {
    target: { value: 'Extended DP (With LD)' },
  });
  fireEvent.change(screen.getByLabelText('DP Amendment 2 Date'), {
    target: { value: '2026-03-31' },
  });
  fireEvent.change(screen.getByLabelText('DP Amendment 2 Specific Qty'), {
    target: { value: '4' },
  });

  // Select Available Lower PO -> populates Freight & GST %, then customize Lower GST %
  const availSelect = screen.getByLabelText(/Select from Available POs/i) as HTMLSelectElement;
  fireEvent.change(availSelect, { target: { value: '26251048/002___01' } });
  assert.equal((screen.getByLabelText(/Lower Freight/i) as HTMLInputElement).value, '7200');
  assert.equal((screen.getByLabelText(/Lower GST/i) as HTMLInputElement).value, '18');
  fireEvent.change(screen.getByLabelText(/Lower GST/i), { target: { value: '12' } });

  // Submit PO Sr Record
  const savePoBtn = screen.getByRole('button', { name: 'Save PO Sr Record' });
  fireEvent.submit(savePoBtn.closest('form')!);

  assert.ok(savedPo);
  const res = savedPo as POMilestone;
  assert.equal(res.poNo, '26251048/001');
  assert.equal(res.poSr, '02');
  assert.equal(res.inspectionCallDate, '2026-03-05');
  assert.equal(res.actualSupplyDate, '2026-03-19');
  assert.equal(res.dpHistory.length, 2);
  assert.equal(res.dpHistory[0].applicableQty, 6);
  assert.equal(res.dpHistory[1].applicableQty, 4);
  assert.equal(res.refDp, '2026-01-25');
  assert.equal(res.extLd, '2026-03-31');
  assert.equal(res.lowerFreight, 7200);
  assert.equal(res.lowerGstPct, 12);

  // Verify Add PL modal still has no CIF Currency or Default CIF Lag
  fireEvent.click(screen.getByRole('button', { name: /Add PL/i }));
  assert.equal(screen.queryByLabelText(/CIF Currency/i), null);
  assert.equal(screen.queryByLabelText(/Default CIF Lag/i), null);
  assert.ok(addedSuppliers.length >= 1);
  cleanup();
});
