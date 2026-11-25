import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import React from 'react';
import { setupTestDom } from './test/domSetup';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

setupTestDom();

describe('App integration & navigation', () => {
  beforeEach(() => {
    setupTestDom();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without a left sidebar and loads Module 1 with Tender Auto-Groups & PO Sr Ledger', async () => {
    const { container } = render(<App />);

    assert.equal(container.querySelector('aside'), null);

    assert.ok(screen.getByRole('banner'));
    assert.ok(screen.getByRole('navigation', { name: /Primary Navigation/i }));
    assert.ok(screen.getByRole('button', { name: 'New Scrutiny' }));

    await waitFor(() => {
      assert.ok(screen.getByText('01. Item Master & PO Ledger'));
    });

    // Automatic 8-digit Tender Groups rendered
    assert.ok(screen.getByText('Tender 26251048 — Auto PO Group'));
    assert.ok(screen.getByText('Tender 26251412 — Auto PO Group'));

    assert.ok(screen.getByRole('button', { name: /Export JSON/i }));
    assert.ok(screen.getByRole('button', { name: /Restore Defaults/i }));
  });

  it('admin can remove and recreate 8-digit Tender Auto-Groups end-to-end', async () => {
    render(<App />);

    await waitFor(() => {
      assert.ok(screen.getByText('Tender 26251048 — Auto PO Group'));
    });

    // Remove Tender 26251048 group
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove group Tender 26251048 — Auto PO Group' })
    );
    assert.equal(screen.queryByText('Tender 26251048 — Auto PO Group'), null);

    // Recreate Auto-Groups restores it
    fireEvent.click(screen.getByRole('button', { name: /Recreate Auto-Groups/i }));
    assert.ok(screen.getByText('Tender 26251048 — Auto PO Group'));
  });

  it('navigates cleanly across all 4 lazy-loaded routes and syncs URL paths', async () => {
    render(<App />);

    await waitFor(() => {
      assert.ok(screen.getByText('01. Item Master & PO Ledger'));
    });

    const nav = screen.getByRole('navigation', { name: /Primary Navigation/i });
    const indicesLink = Array.from(nav.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Indices')
    )!;
    fireEvent.click(indicesLink);

    await waitFor(() => {
      assert.ok(screen.getByText('02. Monthly Indices, FX & Rate of Duty'));
    });
    assert.equal(window.location.pathname, '/indices');

    fireEvent.click(screen.getByRole('button', { name: 'New Scrutiny' }));
    await waitFor(() => {
      assert.ok(screen.getByText('03. Transaction & PVC Scrutiny Engine'));
    });
    assert.equal(window.location.pathname, '/scrutiny');

    const generateBtn = screen.getByRole('button', { name: /Generate Audit Statement/i });
    fireEvent.submit(generateBtn.closest('form')!);
    await waitFor(() => {
      assert.ok(screen.getByText('04. Official Audit Scrutiny Statement'));
    });
    assert.equal(window.location.pathname, '/statement');
  });

  it('supports cross-module jump from PL Master to Monthly Indices for that PL and mobile drawer', async () => {
    render(<App />);

    await waitFor(() => {
      assert.ok(screen.getByText('01. Item Master & PO Ledger'));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open Monthly Indices for PL 29140112' }));
    await waitFor(() => {
      assert.ok(screen.getByText('02. Monthly Indices, FX & Rate of Duty'));
    });
    const plSelect = screen.getByLabelText(
      'Select PL Item for Monthly Indices'
    ) as HTMLSelectElement;
    assert.equal(plSelect.value, '29140112');

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Mobile Navigation' });
    fireEvent.click(within(drawer).getByRole('button', { name: /Master & PO/i }));
    await waitFor(() => {
      assert.ok(screen.getByText('01. Item Master & PO Ledger'));
    });
  });
});
