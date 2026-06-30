import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// UI-redesign Phase-3 cutover: the STAGING surface is re-platformed onto the new sidebar-shell SPA
// (StagingApp = AppShell + a hash router over the seven screens), booting the REAL engine over its
// isolated, seeded IndexedDB (loadRefData → Store → seed → compute/costModel). app/demo keep the
// current App.svelte (guarded by interactions.spec.mjs) until the redesign is promoted off staging.
// These specs verify the shell boots clean, every screen renders REAL data, and the three persistence
// paths (journal notes, per-trade tags, CSV import) round-trip through the isolated DB.

const STAGING = '/app/staging.html';
const nav = page => page.locator('nav[aria-label="Primary"]');
const gotoScreen = async (page, name) => {
  await nav(page).getByRole('button', { name, exact: true }).click();
  // The content topbar <h1> carries the active screen's label (the Reports preview also has its own
  // document <h1>, so scope to the header).
  await expect(page.locator('header h1')).toHaveText(name);
};
// Boot into the dashboard with real metrics rendered.
const bootDashboard = async page => {
  await page.goto(STAGING, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
};

test('staging redesign: boots into the sidebar shell + real Dashboard, no errors', async ({ page }) => {
  const errors = watchErrors(page);
  await bootDashboard(page);

  // Shell: brand + full nav rail; Dashboard is the active item.
  await expect(nav(page)).toContainText('Blotterbook');
  for (const item of ['Dashboard', 'Calendar', 'Analytics', 'Blotter', 'CSV Library', 'Trade Editor', 'Reports']) {
    await expect(nav(page).getByRole('button', { name: item, exact: true })).toBeVisible();
  }
  await expect(nav(page).getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');

  // Real KPIs (compute()): a money value renders, and the equity curve is a real SVG path.
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible();
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible();
  const line = page.locator('svg[aria-label="Cumulative P&L curve"] path.stroke-chart-2');
  await expect(line).toHaveAttribute('d', /^M[\d.]+ [\d.]+ L/);

  // Trading Calendar module renders real traded days (green/red P&L tiles).
  await expect(page.getByText('TRADING CALENDAR')).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('staging redesign: every screen navigates + renders real content', async ({ page }) => {
  const errors = watchErrors(page);
  await bootDashboard(page);

  await gotoScreen(page, 'Calendar');
  await expect(page.getByText('By weekday')).toBeVisible(); // month summary, real per-weekday P&L
  await expect(page.locator('text=/Wk \\d+/').first()).toBeVisible(); // ISO-week totals column

  await gotoScreen(page, 'Analytics');
  await expect(page.getByText('P&L distribution (per trade)')).toBeVisible();
  await expect(page.getByText('Advanced statistics')).toBeVisible();
  await expect(page.getByText('Performance by symbol')).toBeVisible();

  await gotoScreen(page, 'Blotter');
  await expect(page.locator('text=/of \\d+ trades/')).toBeVisible(); // footer count from real rows
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  await gotoScreen(page, 'CSV Library');
  await expect(page.getByText('Active dataset')).toBeVisible();
  await expect(page.getByText('Imported trades')).toBeVisible();

  await gotoScreen(page, 'Trade Editor');
  await expect(page.getByText('Imported trades are fixed', { exact: false })).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  await gotoScreen(page, 'Reports');
  await expect(page.getByRole('heading', { name: 'Performance report' })).toBeVisible();
  await expect(page.getByText('SUMMARY')).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('staging redesign: Calendar day detail shows real trades + the journal note persists', async ({ page }) => {
  await bootDashboard(page);
  await gotoScreen(page, 'Calendar');

  // Open a traded day → the detail rail shows its real trades + a journal-note editor.
  await page.locator('button:has(span.text-chart-2), button:has(span.text-destructive)').first().click();
  await expect(page.getByText('Journal note')).toBeVisible();
  await expect(page.locator('text=/Trades · \\d+/')).toBeVisible();

  // Write + save a note → persists through Store.saveJournal across a reload.
  const note = page.locator('textarea');
  await note.fill('e2e calendar note');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.waitForTimeout(300);

  // The hash persists across reload, so the app boots back into Calendar; re-navigate to be explicit.
  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'Calendar');
  await expect(page.getByText('By weekday')).toBeVisible({ timeout: 10_000 });
  // The day now carries a note dot; reopening it reloads the saved text.
  await page.locator('button:has(span.bg-primary)').first().click();
  await expect(page.locator('textarea')).toHaveValue('e2e calendar note');
});

test('staging redesign: Trade Editor persists a tag (read-only core, metadata layer)', async ({ page }) => {
  test.setTimeout(60_000); // the editor renders every seeded row; save + reload re-render is heavy
  await bootDashboard(page);
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible(); // table populated before interacting

  // Add a tag to the first row via its popover, then Save all → persists via saveTradeMeta.
  await page.getByRole('button', { name: '+ tag' }).first().click();
  const tagInput = page.getByPlaceholder('Add tag, Enter…');
  await tagInput.fill('e2e-tag');
  await tagInput.press('Enter');
  await page.waitForTimeout(300);
  await expect(page.locator('table tbody tr').first().getByText('e2e-tag')).toBeVisible(); // tag staged
  await page.keyboard.press('Escape'); // close the popover
  await page.waitForTimeout(400);
  await expect(page.getByRole('button', { name: 'Save all' })).toBeVisible();
  await page.getByRole('button', { name: 'Save all' }).click();
  await page.waitForTimeout(500);

  // Survives a reload (and the dirty/save bar is gone since nothing is staged).
  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('e2e-tag').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save all' })).toHaveCount(0);
});

test('staging redesign: CSV Library really imports a CSV and the dataset grows + persists', async ({ page }) => {
  test.setTimeout(60_000); // import + reload re-boots/recomputes the whole seeded dataset
  await bootDashboard(page);
  await gotoScreen(page, 'CSV Library');

  const datasetTrades = page.locator('table tbody tr').first().locator('td.tabular-nums').first();
  const before = parseInt(((await datasetTrades.textContent()) || '').replace(/[^\d]/g, ''), 10);
  expect(before).toBeGreaterThan(0);

  // Real Adapters parse → preview → import (two TradingView close-events in a fresh date range).
  const csv = [
    'Time,Action,Realized PnL (value)',
    '2027-03-01 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",50.00',
    '2027-03-01 11:30:00,"Close short position for symbol MNQM2025 at price 18000.00",-20.00',
  ].join('\n');
  await page.setInputFiles('input[type=file]', { name: 'e2e-import.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('Import CSV')).toBeVisible();
  // The parse preview reports 2 trades — the Import button label is the unambiguous signal.
  const importBtn = page.getByRole('button', { name: /Import 2 trades/ });
  await expect(importBtn).toBeVisible();
  await importBtn.click();
  await expect(datasetTrades).toHaveText((before + 2).toLocaleString());

  // Persists across a reload (addTrades wrote to the isolated DB; no duplicate re-seed).
  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'CSV Library');
  await expect(page.locator('table tbody tr').first().locator('td.tabular-nums').first()).toHaveText((before + 2).toLocaleString(), {
    timeout: 10_000,
  });
});

test('staging redesign: Reports custom range re-slices with a prior-period comparison + Markdown export', async ({ page }) => {
  await bootDashboard(page);
  await gotoScreen(page, 'Reports');

  // Custom date range exercises the real slice + prior-period comparison ("vs …" lines appear).
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(page.locator('text=/vs .*\\$/').first()).toBeVisible();

  // Markdown export downloads a real .md built from the report.ts builder.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.md$/);
});
