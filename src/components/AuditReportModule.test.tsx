import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import React from 'react';
import { setupTestDom } from '../test/domSetup';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuditReportModule } from './AuditReportModule';
import {
  INITIAL_DEEMED_GROUPS,
  INITIAL_ITEMS_MASTER,
  INITIAL_MONTHLY_INDICES,
  INITIAL_PO_LEDGER,
} from '../data/initialData';
import { buildTransactionFromPo } from '../utils/navigation';
import { evaluateScrutinyTransaction } from '../utils/pvcEngine';

setupTestDom();

function makeReport(poIndex: number) {
  const po = INITIAL_PO_LEDGER[poIndex];
  const item = INITIAL_ITEMS_MASTER.find((i) => i.pl === po.pl)!;
  const input = buildTransactionFromPo(po, INITIAL_DEEMED_GROUPS);
  return evaluateScrutinyTransaction(
    input,
    po,
    item,
    INITIAL_MONTHLY_INDICES,
    INITIAL_DEEMED_GROUPS,
    INITIAL_PO_LEDGER,
    INITIAL_ITEMS_MASTER
  );
}

describe('AuditReportModule', () => {
  beforeEach(() => {
    setupTestDom();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders institutional masthead, dual dates, 4-card split PVC KPI strip, and 02A/02B verification tables', () => {
    const report = makeReport(0);

    render(
      <AuditReportModule
        report={report}
        savedReports={[]}
        onSaveReportToRegister={() => {}}
        onSelectSavedReport={() => {}}
        onDeleteSavedReport={() => {}}
        onBackToTransaction={() => {}}
        onNotify={() => {}}
      />
    );

    assert.ok(screen.getByText('CHITTARANJAN LOCOMOTIVE WORKS (CLW)'));
    assert.ok(screen.getByText('1. Indigenous PVC (Excl. CIF)'));
    assert.ok(screen.getByText(/2\. CIF PVC/i));
    assert.ok(screen.getByText('Final Passed PVC Rate (1 + 2)'));
    assert.ok(screen.getByText('Inspection Call Date'));
    assert.ok(screen.getByText('Actual Supply Date'));
    assert.ok(screen.getByText(/02A\. Indigenous PVC/i));
    assert.ok(screen.getByText(/02B\. CIF Value PVC/i));
  });

  it('updates inspected scenario breakdown on row click and syncs when report prop changes', () => {
    const reportA = makeReport(0);
    const reportB = makeReport(2);

    const { rerender } = render(
      <AuditReportModule
        report={reportA}
        savedReports={[reportA, reportB]}
        onSaveReportToRegister={() => {}}
        onSelectSavedReport={() => {}}
        onDeleteSavedReport={() => {}}
        onBackToTransaction={() => {}}
        onNotify={() => {}}
      />
    );

    // Click another scenario in reportA matrix
    const otherScenario = reportA.matrix.find((m) => m.id !== reportA.selectedScenario.id);
    assert.ok(otherScenario, 'Expected at least 2 scenarios in matrix');
    fireEvent.click(screen.getByText(otherScenario.desc));
    assert.ok(screen.getAllByText(otherScenario.desc).length >= 2);

    // Switch report prop to reportB -> must sync inspectedScenarioId to reportB.selectedScenario.id
    rerender(
      <AuditReportModule
        report={reportB}
        savedReports={[reportA, reportB]}
        onSaveReportToRegister={() => {}}
        onSelectSavedReport={() => {}}
        onDeleteSavedReport={() => {}}
        onBackToTransaction={() => {}}
        onNotify={() => {}}
      />
    );

    assert.ok(screen.getAllByText(reportB.id).length >= 1);
    assert.ok(screen.getAllByText(reportB.selectedScenario.desc).length >= 2);
  });

  it('logs statement to register, selects saved report, deletes saved report, and exports CSV', () => {
    const report = makeReport(0);
    let loggedCount = 0;
    let deletedId = '';
    let selectedId = '';
    const notifications: string[] = [];

    const { rerender } = render(
      <AuditReportModule
        report={report}
        savedReports={[]}
        onSaveReportToRegister={() => {
          loggedCount += 1;
        }}
        onSelectSavedReport={(r) => {
          selectedId = r.id;
        }}
        onDeleteSavedReport={(id) => {
          deletedId = id;
        }}
        onBackToTransaction={() => {}}
        onNotify={(m) => notifications.push(m)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Log to Register/i }));
    assert.equal(loggedCount, 1);

    fireEvent.click(screen.getByRole('button', { name: /^CSV$/i }));
    assert.ok(notifications.some((m) => m.includes('CSV')));

    rerender(
      <AuditReportModule
        report={report}
        savedReports={[report]}
        onSaveReportToRegister={() => {}}
        onSelectSavedReport={(r) => {
          selectedId = r.id;
        }}
        onDeleteSavedReport={(id) => {
          deletedId = id;
        }}
        onBackToTransaction={() => {}}
        onNotify={() => {}}
      />
    );

    assert.ok(screen.getByRole('button', { name: /Logged/i }).hasAttribute('disabled'));
    fireEvent.click(screen.getByRole('button', { name: `Delete statement ${report.id}` }));
    assert.equal(deletedId, report.id);
    assert.equal(selectedId, '');
  });
});
