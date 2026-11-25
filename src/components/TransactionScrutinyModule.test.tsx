import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import React, { useState } from 'react';
import { setupTestDom } from '../test/domSetup';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TransactionScrutinyModule } from './TransactionScrutinyModule';
import {
  INITIAL_DEEMED_GROUPS,
  INITIAL_ITEMS_MASTER,
  INITIAL_MONTHLY_INDICES,
  INITIAL_PO_LEDGER,
} from '../data/initialData';
import {
  ScrutinyReportResult,
  ScrutinyTransactionInput,
} from '../types/pvc';
import { buildTransactionFromPo } from '../utils/navigation';

setupTestDom();

function ScrutinyHarness({
  onGenerateReport,
  onOpenIndicesForPl,
}: {
  onGenerateReport: (r: ScrutinyReportResult) => void;
  onOpenIndicesForPl?: (pl: string) => void;
}) {
  const [tx, setTx] = useState<ScrutinyTransactionInput>(() =>
    buildTransactionFromPo(INITIAL_PO_LEDGER[0], INITIAL_DEEMED_GROUPS)
  );

  return (
    <TransactionScrutinyModule
      itemsMaster={INITIAL_ITEMS_MASTER}
      poLedger={INITIAL_PO_LEDGER}
      itemMonthlyIndices={INITIAL_MONTHLY_INDICES}
      deemedGroups={INITIAL_DEEMED_GROUPS}
      transactionInput={tx}
      onChangeTransactionInput={setTx}
      onSelectPoKey={(poNo, poSr) => {
        const found = INITIAL_PO_LEDGER.find((p) => p.poNo === poNo && p.poSr === poSr);
        if (found) setTx(buildTransactionFromPo(found, INITIAL_DEEMED_GROUPS));
      }}
      onGenerateReport={onGenerateReport}
      onResetToPoDefaults={() =>
        setTx(buildTransactionFromPo(INITIAL_PO_LEDGER[0], INITIAL_DEEMED_GROUPS))
      }
      onOpenIndicesForPl={onOpenIndicesForPl || (() => {})}
      onNotify={() => {}}
    />
  );
}

describe('TransactionScrutinyModule', () => {
  beforeEach(() => {
    setupTestDom();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders PO Sr No DP history, distinct Call & Supply dates, and 2-part Split PVC output without manual group builder', () => {
    render(<ScrutinyHarness onGenerateReport={() => {}} />);

    const callDateInput = screen.getByLabelText(/Inspection Call Date/i) as HTMLInputElement;
    const supplyDateInput = screen.getByLabelText(/Actual Supply Date/i) as HTMLInputElement;
    assert.equal(callDateInput.value, '2026-03-10');
    assert.equal(supplyDateInput.value, '2026-03-22');

    // Manual "Create PO Group" button removed from Scrutiny Engine
    assert.equal(screen.queryByRole('button', { name: /Create PO Group/i }), null);

    // Shows DP Amendments count & split PVC output
    assert.ok(screen.getByText('2 Recorded'));
    assert.ok(screen.getByText('1. Basic Excl. CIF PVC'));
    assert.ok(screen.getByText(/2\. CIF PVC/i));
    assert.ok(screen.getByText('Final Passed PVC Rate (1 + 2)'));
  });

  it('recalculates split PVC live when CIF Value, Currency, or Lag Month changes', () => {
    const reports: ScrutinyReportResult[] = [];
    render(<ScrutinyHarness onGenerateReport={(r) => reports.push(r)} />);

    const cifInput = screen.getByLabelText(/CIF Value in Basic/i) as HTMLInputElement;
    const cifLagSelect = screen.getByLabelText(/CIF FX & Duty Lag Month/i) as HTMLSelectElement;

    fireEvent.change(cifInput, { target: { value: '50000' } });
    fireEvent.change(cifLagSelect, { target: { value: 'M-2' } });
    fireEvent.change(screen.getByLabelText(/Inspection Call Date/i), {
      target: { value: '2026-02-15' },
    });
    fireEvent.change(screen.getByLabelText(/Actual Supply Date/i), {
      target: { value: '2026-03-10' },
    });

    const generateBtn = screen.getByRole('button', { name: /Generate Audit Statement/i });
    fireEvent.submit(generateBtn.closest('form')!);

    assert.equal(reports.length, 1);
    const rep = reports[0];
    assert.equal(rep.input.cifValue, 50000);
    assert.equal(rep.input.cifLagRule, 'M-2');
    assert.equal(rep.callDateMonthNorm, '2026-02');
    assert.equal(rep.actualSupplyMonthNorm, '2026-03');
    const cb = rep.selectedScenario.cifBreakdown;
    assert.ok(
      Math.abs(cb.indigenousCalculatedRate + cb.cifCalculatedRate - rep.selectedScenario.rate) <
        0.01
    );
  });

  it('supports Lower Rate PO Freight & GST% auto-fill from Available POs and updates governing applied terms', () => {
    let jumpedPl = '';
    const reports: ScrutinyReportResult[] = [];

    render(
      <ScrutinyHarness
        onGenerateReport={(r) => reports.push(r)}
        onOpenIndicesForPl={(pl) => {
          jumpedPl = pl;
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Edit PL 29104820 Indices/i }));
    assert.equal(jumpedPl, '29104820');

    // Toggle Lower Rate PO Clause off then on
    const lowerCheckbox = screen.getByLabelText(/Lower Rate PO Clause/i) as HTMLInputElement;
    assert.equal(lowerCheckbox.checked, true);
    fireEvent.click(lowerCheckbox);
    assert.equal(lowerCheckbox.checked, false);
    assert.equal(screen.queryByLabelText(/Available POs/i), null);

    fireEvent.click(lowerCheckbox);
    assert.equal(lowerCheckbox.checked, true);

    // Select 26251048/002 from Available POs -> fills Freight 7200 and GST 18%, then set Lower GST to 12%
    const availableSelect = screen.getByLabelText(/Available POs/i) as HTMLSelectElement;
    assert.ok(availableSelect.innerHTML.includes('26251048/002'));
    fireEvent.change(availableSelect, { target: { value: '26251048/002___01' } });
    assert.equal((screen.getByLabelText('Lower PO No') as HTMLInputElement).value, '26251048/002');
    assert.equal(
      (screen.getByLabelText(/Lower Freight \/ Unit/i) as HTMLInputElement).value,
      '7200'
    );
    fireEvent.change(screen.getByLabelText(/Lower GST/i), { target: { value: '12' } });

    const generateBtn = screen.getByRole('button', { name: /Generate Audit Statement/i });
    fireEvent.submit(generateBtn.closest('form')!);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].input.lowerPoNo, '26251048/002');
    assert.equal(reports[0].input.lowerFreight, 7200);
    assert.equal(reports[0].input.lowerGstPct, 12);
    assert.equal(reports[0].appliedFreight, 7200);
    assert.equal(reports[0].appliedGstPct, 12);
  });
});
