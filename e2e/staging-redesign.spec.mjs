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
  const line = page.locator('svg[aria-label*="P&L curve"] path.stroke-chart-2');
  await expect(line).toHaveAttribute('d', /^M[\d.]+,[\d.]+ L/);

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
  await expect(page.getByText(/Click a cell to edit/)).toBeVisible();
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

test('staging redesign: buttons drop the no-preflight UA chrome (no white fill / emboss)', async ({ page }) => {
  await bootDashboard(page);
  // The data-mode="staging" reset must reach bare <button>s: inactive nav items are transparent (not
  // the ~#efefef UA fill) and appearance is neutralized (no embossed bevel).
  const probe = await page.evaluate(() => {
    const inactive = document.querySelector('nav[aria-label="Primary"] button:not([aria-current])');
    const s = getComputedStyle(inactive);
    return { bg: s.backgroundColor, appearance: s.appearance };
  });
  expect(probe.appearance).toBe('none');
  expect(probe.bg).toBe('rgba(0, 0, 0, 0)'); // transparent, not a UA light-grey fill
});

test('staging redesign: Dashboard is interactive — chart overlays, day detail, KPI drill-in', async ({ page }) => {
  await bootDashboard(page);

  // Performance overlay toggle switches the primary series (Gross green → Net near-white line).
  await expect(page.locator('svg[aria-label*="P&L curve"] path.stroke-chart-2')).toBeVisible();
  await page.getByRole('button', { name: 'Net', exact: true }).click();
  await expect(page.locator('svg[aria-label*="P&L curve"] path.stroke-primary')).toBeVisible();
  await page.getByRole('button', { name: 'Gross', exact: true }).click();

  // Hover the curve → the live daily readout shows a date + value.
  const svg = page.locator('svg[aria-label*="P&L curve"]');
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  // The daily readout div is aria-live but role-less; a role="log" element is also aria-live, so scope it out.
  await expect(page.locator('[aria-live="polite"]:not([role])')).toContainText(/\d{4}-\d\d-\d\d.*\$/);

  // Trading Calendar day-click → the day's trades + a journal-note editor.
  await page.locator('div.grid.grid-cols-7 button:not([disabled])').first().click();
  await expect(page.getByText('Journal note')).toBeVisible();

  // KPI card → detail dialog (Net P&L shows the take-home waterfall row), closes clean + responsive.
  await page
    .getByRole('button', { name: /Net P&L/ })
    .first()
    .click();
  await expect(page.locator('[data-slot="dialog-content"]')).toBeVisible();
  await expect(page.getByText('Take-home').first()).toBeVisible();
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  // Safety net: the page stays interactive after dismissing the dialog.
  await page
    .getByRole('button', { name: /Profit factor/ })
    .first()
    .click({ timeout: 3000 });
  await expect(page.locator('[data-slot="dialog-content"]')).toBeVisible();
});

test('staging redesign: unstyled controls inherit the theme text color under a light OS theme', async ({ page }) => {
  // Reproduces the ButtonText system-color gap: without the reset, native <button>/<input> render dark
  // on a light-themed OS. Force light color-scheme and assert the controls compute to the light foreground.
  await page.emulateMedia({ colorScheme: 'light' });
  await bootDashboard(page);
  const filterColor = await page.getByRole('button', { name: 'Filters' }).evaluate(el => getComputedStyle(el).color);
  expect(filterColor).toBe('rgb(250, 250, 250)'); // theme foreground, not dark ButtonText
});

test('staging redesign: the Filters popover narrows the dataset and clears', async ({ page }) => {
  await bootDashboard(page);
  const count = () =>
    page
      .getByText(/\d[\d,]* trades/)
      .first()
      .textContent()
      .then(t => parseInt(t.replace(/[^\d]/g, ''), 10));
  const before = await count();
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('button', { name: 'Mon', exact: true }).click(); // Monday-only
  await expect.poll(count).toBeLessThan(before);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect.poll(count).toBe(before);
});

test('staging redesign: Performance chart overlays multiple series at once', async ({ page }) => {
  await bootDashboard(page);
  const curve = page.locator('svg[aria-label*="P&L curve"]'); // substring: the label now also names the click affordance
  await expect(curve.locator('path.stroke-chart-2')).toBeVisible(); // wait for the first line to draw (clientWidth measured)
  const lines = () => curve.locator('path[class*="stroke-"]').count();
  expect(await lines()).toBe(1); // Gross by default
  await page.getByRole('button', { name: 'Net', exact: true }).click();
  await page.getByRole('button', { name: 'Take-home', exact: true }).click();
  expect(await lines()).toBe(3); // all three overlaid
});

test('staging redesign: Dashboard modules hide/reorder and persist across reload', async ({ page }) => {
  await bootDashboard(page);
  const order = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('span')].map(s => s.textContent.trim()).filter(t => t === 'Performance' || t === 'Trading Calendar')
    );
  expect(await order()).toEqual(['Performance', 'Trading Calendar']);
  await page.locator('#dashmod-cal button[aria-label="Module menu"]').click(); // Trading Calendar's own menu
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  expect(await order()).toEqual(['Trading Calendar', 'Performance']);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  expect(await order()).toEqual(['Trading Calendar', 'Performance']); // persisted via Store.local
});

test('staging redesign: the Blotter paginates (50/page)', async ({ page }) => {
  await bootDashboard(page);
  await gotoScreen(page, 'Blotter');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  expect(await page.locator('table tbody tr').count()).toBe(50);
  await expect(page.getByText(/1–50 of/)).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(/51–100 of/)).toBeVisible();
});

test('staging redesign: Trade Editor edits a core field and it persists (updateTrade seam)', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  // Edit the first row's Symbol cell → ZZTEST, save.
  const symCell = page.locator('table tbody tr').first().locator('td').nth(3).locator('button');
  await symCell.click();
  const input = page.locator('table tbody tr').first().locator('td').nth(3).locator('input');
  await input.fill('ZZTEST');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Save all' })).toBeVisible();
  await page.getByRole('button', { name: 'Save all' }).click();
  await page.waitForTimeout(600);
  // Persists across a reload under its recomputed id.
  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr td', { hasText: 'ZZTEST' }).first()).toBeVisible({ timeout: 10_000 });
});

test('staging redesign: the header shows Beta + environment pills and the version', async ({ page }) => {
  await bootDashboard(page);
  const header = page.locator('header');
  // Environment pill names the surface; Beta pill shows while prod major < 1; version reads from versions.json.
  await expect(header.getByText('Staging', { exact: true })).toBeVisible();
  await expect(header.getByText('Beta', { exact: true })).toBeVisible();
  await expect(header.getByText(/^v\d+\.\d+\.\d+/)).toBeVisible();
});

test('staging redesign: the Break-even/Cost + Advanced Statistics modules render real data', async ({ page }) => {
  await bootDashboard(page);
  // Break-even & Cost waterfall (costModel): the take-home total + per-trade break-even rows render.
  const cost = page.locator('#dashmod-cost');
  await expect(cost.getByText('Break-even & Cost')).toBeVisible();
  await expect(cost.getByText('Take-home')).toBeVisible();
  await expect(cost.getByText('Break-even / trade')).toBeVisible();
  await expect(cost.getByText(/\$[\d,]/).first()).toBeVisible(); // a real money figure
  // Advanced Statistics grid (Analytics view-model): the payoff-ratio stat renders.
  const adv = page.locator('#dashmod-adv');
  await expect(adv.getByText('Advanced Statistics')).toBeVisible();
  await expect(adv.getByText(/Payoff ratio/)).toBeVisible();
});

test('staging redesign: clicking the Performance chart jumps the Dashboard calendar to that day', async ({ page }) => {
  await bootDashboard(page);
  const svg = page.locator('svg[aria-label*="P&L curve"]');
  const box = await svg.boundingBox();
  // Click near the right edge of the curve (a late trading day) → the calendar cursor + selected day sync.
  await svg.click({ position: { x: box.width * 0.85, y: box.height * 0.5 } });
  // The calendar module opens the day-detail rail for the picked day (journal-note editor appears).
  await expect(page.getByText('Journal note')).toBeVisible({ timeout: 4000 });
});
