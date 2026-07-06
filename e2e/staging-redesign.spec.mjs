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
  // F37: the seed goes through the per-file path — a real file record, not a derived dataset row.
  await expect(page.getByText('Uploaded files')).toBeVisible();
  await expect(page.getByText('sample-trades.csv')).toBeVisible();

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

  // F37: per-file rows. Boot = the seeded sample file; the header carries the included-trade total.
  const header = page.locator('text=/\\d+ of \\d+ included · [\\d,]+ trades/');
  await expect(header).toBeVisible();
  const before = parseInt((((await header.textContent()) || '').match(/· ([\d,]+) trades/) || [])[1].replace(/,/g, ''), 10);
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
  // The imported file lands as its OWN row (2 trades) and the included total grows by 2.
  await expect(page.getByText('e2e-import.csv')).toBeVisible();
  await expect(page.locator(`text=/2 of 2 included · ${(before + 2).toLocaleString()} trades/`)).toBeVisible();

  // Persists across a reload (addTrades + addFile wrote to the isolated DB; no duplicate re-seed).
  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'CSV Library');
  await expect(page.getByText('e2e-import.csv')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`text=/2 of 2 included · ${(before + 2).toLocaleString()} trades/`)).toBeVisible();
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
  await page.locator('#dashmod-cal .grid button:not([disabled])').first().click();
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
  // A186: layout edits STAGE (dirty asterisk); Save persists, and only then does a reload keep it.
  await page.getByRole('button', { name: 'Save layout' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  expect(await order()).toEqual(['Trading Calendar', 'Performance']); // persisted via Store.local

  // A139/A189: hide a module, add it back via the always-visible 'Add modules' picker, save → persists.
  await page.locator('#dashmod-perf button[aria-label="Module menu"]').click();
  await page.getByRole('menuitem', { name: 'Hide' }).click();
  await expect(page.locator('#dashmod-perf')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add modules' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('label', { hasText: 'Performance' }).locator('input[type=checkbox]').check();
  await dlg.getByRole('button', { name: /Add module/ }).click();
  await expect(page.locator('#dashmod-perf')).toBeVisible();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(page.locator('#dashmod-perf')).toBeVisible(); // the add-back persisted too
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
  // F49: the symbol editor is now a filterable popover portaled to <body>.
  const input = page.getByPlaceholder('Filter or type a new root…');
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

// ── R1 pass-5 follow-through: interaction coverage for the controls A149/A152/A159 wired up ──────

test('staging redesign: Blotter drawer saves a journal note (A149) and the note dot appears', async ({ page }) => {
  await bootDashboard(page);
  await gotoScreen(page, 'Blotter');
  const firstRow = page.locator('table tbody tr').first();
  await expect(firstRow).toBeVisible();

  // Open the detail sheet via the keyboard-accessible symbol button, write a note, Save.
  await firstRow.locator('td').nth(2).getByRole('button').click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await sheet.getByPlaceholder('Notes for this trade…').fill('drawer note e2e');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();

  // The row now carries the note dot, and reopening the drawer shows the persisted note.
  // (10s like the file's other post-write asserts — under full-suite parallel load the
  //  save→reload→re-render roundtrip was observed to exceed the old 4s.)
  await expect(firstRow.locator('[title="Has a note"]')).toBeVisible({ timeout: 10_000 });
  await firstRow.locator('td').nth(2).getByRole('button').click();
  await expect(page.locator('[data-slot="sheet-content"]').getByPlaceholder('Notes for this trade…')).toHaveValue('drawer note e2e', {
    timeout: 10_000,
  });
});

test('staging redesign: Blotter bulk delete removes the selected trade (A149)', async ({ page }) => {
  await bootDashboard(page);
  await gotoScreen(page, 'Blotter');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  const countText = await page.getByText(/\d+ of \d+ trades/).innerText();
  const total = Number(countText.match(/of (\d+) trades/)[1]);

  await page.locator('table tbody tr').first().getByRole('checkbox', { name: 'Select trade' }).check();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Delete 1 trade?')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.getByText(`${total - 1} of ${total - 1} trades`)).toBeVisible({ timeout: 4000 });
});

test('staging redesign: Calendar day screenshot enlarges in the shared lightbox (A152)', async ({ page }) => {
  await bootDashboard(page);
  await gotoScreen(page, 'Calendar');
  // Open a traded day's detail rail (a grid cell button showing a $ figure).
  await page.locator('main').getByRole('button').filter({ hasText: /\$\d/ }).first().click();
  await expect(page.getByText('Journal note')).toBeVisible();

  // Attach a (1×1 PNG) screenshot via the day-detail file input, then click the thumbnail.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('main input[type="file"][accept="image/*"]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png });
  const thumb = page.getByRole('button', { name: 'Enlarge screenshot 1' });
  await expect(thumb).toBeVisible({ timeout: 4000 });
  await thumb.click();

  // The shared ScreenshotLightbox dialog opens with the enlarged image; Escape closes it.
  await expect(page.getByRole('dialog').locator('img[alt="Enlarged screenshot"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('staging redesign: the Dashboard Tag filter narrows to tagged trades (A159)', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);

  // Tag the first trade via the Trade Editor (metadata layer), then save.
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await page.getByRole('button', { name: '+ tag' }).first().click();
  const tagInput = page.getByPlaceholder('Add tag, Enter…');
  await tagInput.fill('filter-me');
  await tagInput.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Save all' }).click();
  await page.waitForTimeout(500);

  // Back on the Dashboard, the Filters popover now offers the Tag select; applying it narrows the set.
  await gotoScreen(page, 'Dashboard');
  await page.getByRole('button', { name: 'Filters' }).click();
  const popover = page.locator('[data-slot="popover-content"]');
  const before = Number((await popover.getByText(/[\d,]+ trades/).innerText()).replace(/[^\d]/g, ''));
  await popover.getByText('All tags').click();
  await page.getByRole('option', { name: 'filter-me' }).click();
  await expect(popover.getByText('1 trades')).toBeVisible({ timeout: 4000 });
  expect(before).toBeGreaterThan(1);
  // Clear all restores the full set.
  await popover.getByRole('button', { name: 'Clear all' }).click();
  await expect(popover.getByText(`${before.toLocaleString()} trades`)).toBeVisible();
  await page.keyboard.press('Escape'); // close the popover

  // A165: the tag also shows up as a row in the Analytics "Performance by tag" module, with the
  // untagged bucket carrying the remainder (the coverage stat).
  await gotoScreen(page, 'Analytics');
  await expect(page.getByText('Performance by tag')).toBeVisible();
  await expect(page.getByText('filter-me')).toBeVisible();
  await expect(page.getByText('untagged', { exact: true })).toBeVisible();
});

test('staging redesign: dashboard tabs — staged layouts, Save + dirty asterisk, ✕ close, add-modules picker (A135/A186/A189)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // The rename prompt supplies 'Scalping'; the ✕-close confirm is accepted.
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Scalping' : undefined));
  await bootDashboard(page);
  await expect(page.getByRole('button', { name: 'Main', exact: true })).toBeVisible();

  // A189: the add-modules '+' is ALWAYS visible, even on a full default layout; the picker lists
  // every module with already-added ones checked + disabled.
  const plus = page.getByRole('button', { name: 'Add modules' });
  await expect(plus).toBeVisible();
  await plus.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('Performance')).toBeVisible();
  await expect(dlg.getByText('Added').first()).toBeVisible();
  const addBtn = dlg.getByRole('button', { name: /Add module/ });
  await expect(addBtn).toBeDisabled(); // nothing selectable on a full layout
  await page.keyboard.press('Escape');

  // Create a second tab — it auto-names itself 'New tab 1' (A198, no prompt) and becomes active
  // with the default layout; the menu → Rename (prompt) then names it 'Scalping'.
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New tab 1', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Tab menu: New tab 1' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const scalpTab = page.getByRole('button', { name: /^Scalping/ });
  await expect(scalpTab).toBeVisible();
  await expect(scalpTab).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#dashmod-perf')).toBeVisible();

  // Hide Performance on the new tab — the layout STAGES: dirty asterisk + Save button appear (A186/A189).
  await page.locator('#dashmod-perf button[aria-label="Module menu"]').click();
  await page.getByRole('menuitem', { name: 'Hide' }).click();
  await expect(page.locator('#dashmod-perf')).toHaveCount(0);
  await expect(page.getByTitle('Unsaved layout changes')).toBeVisible();
  const save = page.getByRole('button', { name: 'Save layout' });
  await expect(save).toBeVisible();

  // Unsaved edits survive a tab SWITCH (in-memory draft): Main keeps its full layout.
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await expect(page.locator('#dashmod-perf')).toBeVisible();
  await scalpTab.click();
  await expect(page.locator('#dashmod-perf')).toHaveCount(0);

  // Save persists the layout and clears the asterisk; it then survives a reload.
  await save.click();
  await expect(page.getByTitle('Unsaved layout changes')).toHaveCount(0);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole('button', { name: /^Scalping/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#dashmod-perf')).toHaveCount(0);

  // A189: re-add Performance through the picker — it stages (asterisk returns) and renders.
  await page.getByRole('button', { name: 'Add modules' }).click();
  const dlg2 = page.getByRole('dialog');
  await dlg2.locator('label', { hasText: 'Performance' }).locator('input[type=checkbox]').check();
  await dlg2.getByRole('button', { name: /Add module/ }).click();
  await expect(page.locator('#dashmod-perf')).toBeVisible();
  await expect(page.getByTitle('Unsaved layout changes')).toBeVisible();

  // A186: the direct ✕ closes the tab (confirm accepted) — Main takes over with its full layout.
  await page.getByRole('button', { name: 'Close tab: Scalping' }).click();
  await expect(page.getByRole('button', { name: /^Scalping/ })).toHaveCount(0);
  await expect(page.locator('#dashmod-perf')).toBeVisible();
});

test('staging redesign: dashboard tabs drag-reorder — one commit on drop, Esc-style cancel reverts (A186/A192)', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);
  // A198: '+ New tab' auto-names — two clicks yield 'New tab 1' and 'New tab 2' (no prompts).
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  const order = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[aria-label^="Tab menu: "]')].map(el => el.getAttribute('aria-label').replace('Tab menu: ', ''))
    );
  expect(await order()).toEqual(['Main', 'New tab 1', 'New tab 2']);

  // HTML5 DnD is synthesized via dispatched DragEvents (Playwright's mouse API doesn't drive the
  // native drag pipeline headless). Drag 'New tab 2' to the left half of 'Main', then DROP → commits once.
  const drag = (fromName, overName, drop) =>
    page.evaluate(
      ([fromName, overName, drop]) => {
        const tabOf = name => document.querySelector(`[aria-label="Tab menu: ${name}"]`).closest('[draggable]');
        const from = tabOf(fromName),
          over = tabOf(overName);
        const dt = new DataTransfer();
        from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        const box = over.getBoundingClientRect();
        over.dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.x + 2, clientY: box.y + 2 })
        );
        if (drop) over.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
        from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      },
      [fromName, overName, drop]
    );

  await drag('New tab 2', 'Main', true);
  await expect.poll(order).toEqual(['New tab 2', 'Main', 'New tab 1']);

  // The committed order survives a reload (persisted once, on the drop).
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await expect.poll(order).toEqual(['New tab 2', 'Main', 'New tab 1']);

  // A cancelled drag (dragend without drop — what Esc produces) reverts to the entry order.
  await drag('New tab 1', 'New tab 2', false);
  await expect.poll(order).toEqual(['New tab 2', 'Main', 'New tab 1']);
});

// ── A212 (R1 pass-7): the F37 per-file actions + A211 broker override round-trip the Store ──────

test('staging redesign: CSV Library include-toggle narrows the active dataset and persists (F37)', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);
  await gotoScreen(page, 'CSV Library');

  // Seeded state: one included file carrying the whole dataset.
  await expect(page.getByText(/1 of 1 included · [\d,]+ trades/)).toBeVisible();
  const sw = page.getByRole('switch', { name: 'Include in dataset' });
  await sw.click();
  await expect(page.getByText(/0 of 1 included · 0 trades/)).toBeVisible();

  // The exclusion applies app-wide: the Dashboard's win-rate KPI now counts 0 trades.
  await gotoScreen(page, 'Dashboard');
  await expect(page.getByText('0 trades')).toBeVisible();

  // …and survives a reload (persisted via Store.updateFile) before being toggled back on.
  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'CSV Library');
  await expect(page.getByText(/0 of 1 included/)).toBeVisible();
  await page.getByRole('switch', { name: 'Include in dataset' }).click();
  await expect(page.getByText(/1 of 1 included · [\d,]+ trades/)).toBeVisible();
});

test('staging redesign: CSV Library rename + broker override persist on the file record (F37/A211)', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);
  await gotoScreen(page, 'CSV Library');

  // Rename via the row menu → dialog; the label replaces the filename in the table.
  await page.getByRole('button', { name: 'File actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox').fill('My Schwab era');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'My Schwab era' })).toBeVisible();

  // Broker override via the detail sheet's select (A211) — pick a non-global broker.
  await page.getByRole('button', { name: 'My Schwab era' }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  // (bits-ui Select.Trigger renders as a plain <button aria-label=…>, not role=combobox.)
  await sheet.locator('button[aria-label="Broker override for this file"]').click();
  await page.getByRole('option', { name: 'EdgeClear' }).click();
  // The trigger reflects the pick immediately; the Store write is fire-and-forget — give it a
  // beat before reloading (parity with the file's other post-write waits).
  await expect(sheet.locator('button[aria-label="Broker override for this file"]')).toContainText('EdgeClear');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape'); // close the sheet

  // Both persist across a reload (Store.updateFile wrote label + broker on the record).
  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'CSV Library');
  await page.getByRole('button', { name: 'My Schwab era' }).click();
  await expect(page.locator('[data-slot="sheet-content"]').locator('button[aria-label="Broker override for this file"]')).toContainText(
    'EdgeClear'
  );
});

test('staging redesign: Analytics click-to-filter narrows every screen and the chips clear it (A197)', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);

  // Baseline: the Blotter's unfiltered trade count.
  await gotoScreen(page, 'Blotter');
  const footer = page.locator('text=/of [\\d,]+ trades/');
  const countOf = async () => parseInt((((await footer.textContent()) || '').match(/of ([\d,]+) trades/) || [])[1].replace(/,/g, ''), 10);
  const before = await countOf();
  expect(before).toBeGreaterThan(0);

  // Click the top symbol row on Analytics — pressed state + the filter chip bar appear.
  await gotoScreen(page, 'Analytics');
  await page.locator('button[title^="Filter every screen to"]').first().click();
  await expect(page.getByText('Filtered:')).toBeVisible();
  await expect(page.locator('button[aria-pressed="true"]').first()).toBeVisible();

  // The narrowing is app-wide: the Blotter now shows fewer trades (seed spans several roots).
  await gotoScreen(page, 'Blotter');
  await expect.poll(countOf).toBeLessThan(before);

  // Back on Analytics, Clear all removes the chips and restores the full set.
  await gotoScreen(page, 'Analytics');
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByText('Filtered:')).toHaveCount(0);
  await gotoScreen(page, 'Blotter');
  await expect.poll(countOf).toBe(before);
});

test('staging redesign: Analytics histogram drill-down + sortable breakdown columns (A197)', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);
  await gotoScreen(page, 'Analytics');

  // Clicking a P&L bucket label opens the drill-down panel naming the bucket + its trade count;
  // clicking again (or ✕) closes it.
  await page.locator('button[title^="Show the"]').first().click();
  const panel = page.locator('text=/— \\d+ trades?/');
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'Close bucket detail' }).click();
  await expect(panel).toHaveCount(0);

  // Sortable columns: the symbol table re-sorts alphabetically on the Sym header (default is
  // impact order), and flips direction on a second click.
  const symCard = page.locator('[data-slot="card"]', { hasText: 'Performance by symbol' });
  const syms = () => symCard.locator('button[aria-pressed] > span:first-child').allTextContents();
  // The header buttons' accessible name is their column label (the title attr is supplementary).
  await symCard.getByRole('button', { name: 'Sym', exact: true }).click();
  await expect
    .poll(async () => {
      const s = await syms();
      return s.every((v, i) => i === 0 || s[i - 1].localeCompare(v) <= 0);
    })
    .toBe(true);
  await symCard.getByRole('button', { name: 'Sym', exact: true }).click();
  await expect
    .poll(async () => {
      const s = await syms();
      return s.every((v, i) => i === 0 || s[i - 1].localeCompare(v) >= 0);
    })
    .toBe(true);

  // Hour click-to-filter (A197 final slice): an hour label toggles the shared hour filter — the
  // chip bar shows it (…h) and Clear all removes it.
  const hourCard = page.locator('[data-slot="card"]', { hasText: 'Avg P&L by hour' });
  await hourCard.locator('button[aria-pressed]').first().click();
  await expect(page.getByText('Filtered:')).toBeVisible();
  await expect(page.locator('button[aria-label^="Remove filter:"]', { hasText: 'h' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByText('Filtered:')).toHaveCount(0);

  // Quick date scoping: a preset writes the shared from/to (range chip appears); All clears it.
  await page.getByRole('button', { name: '90D', exact: true }).click();
  await expect(page.getByText('Filtered:')).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByText('Filtered:')).toHaveCount(0);
});

test('staging redesign: Commission Compare module adds via the picker and ranks brokers (A203)', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);

  // Add the module through the A189 picker (it's not in the default layout).
  await page.getByRole('button', { name: 'Add modules' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.locator('label', { hasText: 'Commission Compare' }).locator('input[type=checkbox]').check();
  await dlg.getByRole('button', { name: /Add module/ }).click();

  // The table renders every broker, cheapest-first with the Cheapest badge on row 1.
  const mod = page.locator('#dashmod-compare');
  await expect(mod).toBeVisible();
  const rows = mod.locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(3);
  await expect(rows.first().getByText('Cheapest')).toBeVisible();
  await expect(mod.getByText(/exchange\/clearing\/NFA \$\d/)).toBeVisible();
});
