import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import React from 'react';
import { setupTestDom } from '../test/domSetup';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MonthlyIndicesModule } from './MonthlyIndicesModule';
import {
  DEFAULT_EXCISE_DUTY_PCT,
  INITIAL_ITEMS_MASTER,
  INITIAL_MONTHLY_INDICES,
} from '../data/initialData';
import { MonthlyIndexEntry } from '../types/pvc';

setupTestDom();

describe('MonthlyIndicesModule', () => {
  beforeEach(() => {
    setupTestDom();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders monthly matrix with all currency FX inputs and default 11% Rate of Duty', () => {
    render(
      <MonthlyIndicesModule
        itemsMaster={INITIAL_ITEMS_MASTER}
        itemMonthlyIndices={INITIAL_MONTHLY_INDICES}
        selectedPl={INITIAL_ITEMS_MASTER[0].pl}
        onSelectPl={() => {}}
        onSaveMonthlyIndex={() => {}}
        onDeleteMonthlyIndex={() => {}}
        onNotify={() => {}}
      />
    );

    assert.ok(screen.getByText('02. Monthly Indices, FX & Rate of Duty'));
    for (const cur of ['USD', 'EUR', 'GBP', 'JPY', 'CHF']) {
      const fxInput = screen.getByLabelText(new RegExp(`^${cur} \\(₹\\)`)) as HTMLInputElement;
      assert.ok(parseFloat(fxInput.value) > 0, `Expected positive FX rate for ${cur}`);
    }
    const dutyInput = screen.getByLabelText(/Rate of Duty \(%\)/i) as HTMLInputElement;
    assert.equal(parseFloat(dutyInput.value), DEFAULT_EXCISE_DUTY_PCT);

    // Table shows logged months and Duty % column
    assert.ok(screen.getByText('2025-07'));
    assert.ok(screen.getByText('2026-03'));
    assert.ok(screen.getAllByText('11.00%').length > 0);
  });

  it('saves a new monthly index entry with all-currency FX rates and changed Rate of Duty %', () => {
    const savedCalls: Array<{ pl: string; month: string; entry: MonthlyIndexEntry }> = [];
    const notifications: string[] = [];

    render(
      <MonthlyIndicesModule
        itemsMaster={INITIAL_ITEMS_MASTER}
        itemMonthlyIndices={INITIAL_MONTHLY_INDICES}
        selectedPl="29104820"
        onSelectPl={() => {}}
        onSaveMonthlyIndex={(pl, month, entry) => savedCalls.push({ pl, month, entry })}
        onDeleteMonthlyIndex={() => {}}
        onNotify={(msg) => notifications.push(msg)}
      />
    );

    const monthField = screen.getByLabelText(/Month \/ Year/i) as HTMLInputElement;
    fireEvent.change(monthField, { target: { value: '2026-05' } });

    fireEvent.change(screen.getByLabelText(/^USD \(₹\)/), { target: { value: '88.5' } });
    fireEvent.change(screen.getByLabelText(/^EUR \(₹\)/), { target: { value: '99.75' } });
    fireEvent.change(screen.getByLabelText(/^GBP \(₹\)/), { target: { value: '115.2' } });
    fireEvent.change(screen.getByLabelText(/^JPY \(₹\)/), { target: { value: '0.61' } });
    fireEvent.change(screen.getByLabelText(/^CHF \(₹\)/), { target: { value: '102.4' } });

    const dutyInput = screen.getByLabelText(/Rate of Duty \(%\)/i) as HTMLInputElement;
    fireEvent.change(dutyInput, { target: { value: '12.5' } });

    const saveBtn = screen.getByRole('button', { name: /Save Month \(2026-05\)/i });
    fireEvent.submit(saveBtn.closest('form')!);

    assert.equal(savedCalls.length, 1);
    assert.equal(savedCalls[0].pl, '29104820');
    assert.equal(savedCalls[0].month, '2026-05');
    assert.equal(savedCalls[0].entry.exchangeRates?.USD, 88.5);
    assert.equal(savedCalls[0].entry.exchangeRates?.EUR, 99.75);
    assert.equal(savedCalls[0].entry.exchangeRates?.GBP, 115.2);
    assert.equal(savedCalls[0].entry.exchangeRates?.JPY, 0.61);
    assert.equal(savedCalls[0].entry.exchangeRates?.CHF, 102.4);
    assert.equal(savedCalls[0].entry.exciseDutyPct, 12.5);
    assert.ok(notifications.some((m) => m.includes('Saved indices')));
  });

  it('switches PL item via selector and updates Time-Lag Lookup currency & CIF lag preview', () => {
    let selectedPl = '29104820';

    render(
      <MonthlyIndicesModule
        itemsMaster={INITIAL_ITEMS_MASTER}
        itemMonthlyIndices={INITIAL_MONTHLY_INDICES}
        selectedPl={selectedPl}
        onSelectPl={(pl) => {
          selectedPl = pl;
        }}
        onSaveMonthlyIndex={() => {}}
        onDeleteMonthlyIndex={() => {}}
        onNotify={() => {}}
      />
    );

    const plSelect = screen.getByLabelText('Select PL Item for Monthly Indices');
    fireEvent.change(plSelect, { target: { value: '29140112' } });
    assert.equal(selectedPl, '29140112');

    // Change CIF currency and lag rule in Time-Lag Lookup Inspector
    const cifCurSelect = screen.getByLabelText('CIF Currency Preview') as HTMLSelectElement;
    fireEvent.change(cifCurSelect, { target: { value: 'GBP' } });
    assert.equal(cifCurSelect.value, 'GBP');

    const cifLagSelect = screen.getByLabelText('CIF Lag Rule Preview') as HTMLSelectElement;
    fireEvent.change(cifLagSelect, { target: { value: 'M-2' } });
    assert.equal(cifLagSelect.value, 'M-2');
    assert.ok(screen.getAllByText(/2026-01 → 2026-01/).length > 0);
    assert.ok(screen.getByText(/GBP ₹111\.20/));
  });

  it('opens Attach Circular modal and saves circular metadata for target month', () => {
    const savedCalls: Array<{ pl: string; month: string; entry: MonthlyIndexEntry }> = [];

    render(
      <MonthlyIndicesModule
        itemsMaster={INITIAL_ITEMS_MASTER}
        itemMonthlyIndices={INITIAL_MONTHLY_INDICES}
        selectedPl="29104820"
        onSelectPl={() => {}}
        onSaveMonthlyIndex={(pl, month, entry) => savedCalls.push({ pl, month, entry })}
        onDeleteMonthlyIndex={() => {}}
        onNotify={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Attach Circular/i }));
    assert.ok(screen.getByRole('dialog', { name: /Attach Circular Document/i }));

    fireEvent.change(screen.getByLabelText(/Circular Reference/i), {
      target: { value: 'IEEMA/PVC/TEST-2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Circular Tag/i }));

    assert.equal(savedCalls.length, 1);
    assert.ok(String(savedCalls[0].entry.source).includes('IEEMA/PVC/TEST-2026'));
  });

  it('renders clean empty state when no PL items are configured', () => {
    render(
      <MonthlyIndicesModule
        itemsMaster={[]}
        itemMonthlyIndices={{}}
        selectedPl=""
        onSelectPl={() => {}}
        onSaveMonthlyIndex={() => {}}
        onDeleteMonthlyIndex={() => {}}
        onNotify={() => {}}
      />
    );
    assert.ok(screen.getByText('No PL Items configured.'));
  });
});
