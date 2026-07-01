import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// CH16 cutover: ALL app surfaces (app/demo/staging) now render the ONE redesigned sidebar-shell SPA
// (src/app/App.svelte = AppShell + a hash router over the seven screens). This file guards what's
// DIFFERENT about the DEMO surface (data-mode="demo", in-memory DemoStore, seeded): it boots read-only
// into the redesigned dashboard, NEVER persists (no "blotterbook" IndexedDB is created), and every
// write control is disabled/guarded. The full redesign-DOM engine coverage lives in
// staging-redesign.spec.mjs; here we only assert the demo-specific guarantees.

const DEMO = '/app/demo.html';
const nav = page => page.locator('nav[aria-label="Primary"]');
const gotoScreen = async (page, name) => {
  await nav(page).getByRole('button', { name, exact: true }).click();
  await expect(page.locator('header h1')).toHaveText(name);
};
const bootDashboard = async page => {
  await page.goto(DEMO, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
};

test('demo: boots into the redesigned sidebar dashboard with real seeded metrics', async ({ page }) => {
  const errors = watchErrors(page);
  await bootDashboard(page);

  // Shell: brand + full nav rail; Dashboard is the active item.
  await expect(nav(page)).toContainText('Blotterbook');
  for (const item of ['Dashboard', 'Calendar', 'Analytics', 'Blotter', 'CSV Library', 'Trade Editor', 'Reports']) {
    await expect(nav(page).getByRole('button', { name: item, exact: true })).toBeVisible();
  }
  await expect(nav(page).getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');

  // Real KPIs (compute over the in-memory seed): a money value renders + the equity curve is a real SVG path.
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible();
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible();
  await expect(page.locator('svg[aria-label*="P&L curve"] path.stroke-chart-2')).toHaveAttribute('d', /^M[\d.]+,[\d.]+ L/);

  // The header carries the Demo environment pill (prod /app shows none; staging shows Staging).
  await expect(page.locator('header').getByText('Demo', { exact: true })).toBeVisible();

  // Regression: the no-preflight UA button reset must reach demo too (it was scoped to dev/staging
  // only pre-CH16, so demo/app rendered raw <button>s with a light UA fill — the "white outline" bug).
  const chrome = await nav(page)
    .locator('button:not([aria-current])')
    .first()
    .evaluate(el => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, appearance: s.appearance };
    });
  expect(chrome.appearance).toBe('none');
  expect(chrome.bg).toBe('rgba(0, 0, 0, 0)'); // transparent, not a UA light-grey fill

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('demo: HARD invariant — nothing is persisted (no "blotterbook" IndexedDB database)', async ({ page }) => {
  await bootDashboard(page);
  // Exercise a couple of screens so any accidental write path would have fired.
  await gotoScreen(page, 'Blotter');
  await gotoScreen(page, 'CSV Library');
  await gotoScreen(page, 'Dashboard');

  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name || '') : []));
  expect(dbs.filter(n => n.toLowerCase().includes('blotter'))).toHaveLength(0);
});

test('demo: write controls are disabled — cost model + data management + CSV import', async ({ page }) => {
  await bootDashboard(page);

  // Dashboard Break-even & Cost module: the Broker combobox is disabled on demo (never mutates).
  // The bits-ui Select.Trigger renders as a <button aria-label="Broker"> (not role=combobox).
  const brokerTrigger = page.locator('#dashmod-cost button[aria-label="Broker"]');
  await expect(brokerTrigger).toBeVisible();
  await expect(brokerTrigger).toBeDisabled();

  // Trade Editor: a staged cell edit cannot be saved — "Save all" is disabled on demo.
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  const cell = page.locator('table tbody tr').first().locator('td').nth(3).locator('button');
  await cell.click();
  const input = page.locator('table tbody tr').first().locator('td').nth(3).locator('input');
  await input.fill('ZZDEMO');
  await input.press('Enter');
  const saveAll = page.getByRole('button', { name: 'Save all' });
  if (await saveAll.count()) await expect(saveAll).toBeDisabled();

  // CSV Library: the data-management controls (backup / restore / erase) are disabled on demo, and so
  // is the import-confirm CTA once a file is parsed (the import silently no-ops on demo). Done last —
  // parsing a file opens the preview sheet, whose overlay would block further nav.
  await gotoScreen(page, 'CSV Library');
  await expect(page.getByRole('button', { name: /backup/i }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: /Erase/i })).toBeDisabled();
  const csv = 'Time,Action,Realized PnL (value)\n2027-05-01 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",30.00';
  await page.setInputFiles('input[type=file]', { name: 'demo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('button', { name: /Import \d+ trade/ })).toBeDisabled();
});

test('demo: Trade Editor stages edits in-memory but persists nothing across reload', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  // Edit the first row's Symbol cell → ZZDEMO (an in-memory draft edit). On demo the Save-all control
  // is DISABLED (isDemo), so the staged edit can never be persisted.
  const symCell = page.locator('table tbody tr').first().locator('td').nth(3).locator('button');
  await symCell.click();
  const input = page.locator('table tbody tr').first().locator('td').nth(3).locator('input');
  await input.fill('ZZDEMO');
  await input.press('Enter');
  const saveAll = page.getByRole('button', { name: 'Save all' });
  if (await saveAll.count()) await expect(saveAll).toBeDisabled();
  await page.waitForTimeout(300);

  // Nothing was persisted (demo never touches IndexedDB), so a reload re-seeds the pristine dataset.
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name || '') : []));
  expect(dbs.filter(n => n.toLowerCase().includes('blotter'))).toHaveLength(0);

  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('ZZDEMO')).toHaveCount(0); // the edit did not survive
});
