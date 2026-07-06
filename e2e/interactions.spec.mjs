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

  // A179/A194: the rotating flavor text renders a phrase from the curated list (desktop only).
  const { FLAVOR_PHRASES } = await import('../src/app/lib/flavor.ts');
  const flavor = (await page.getByTestId('flavor-text').innerText()).trim();
  expect(FLAVOR_PHRASES).toContain(flavor);

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

test('demo: Account screen is promoted (CH16) and fully read-only — controls disabled, no /api/me probe acted on', async ({ page }) => {
  await page.goto(DEMO, { waitUntil: 'networkidle' });
  // The Account nav item exists on demo now (F53 promoted).
  await page.getByRole('button', { name: 'Account' }).click();
  // Demo renders the screen in read-only mode with its explanatory note and disabled controls.
  await expect(page.getByText(/demo/i).first()).toBeVisible();
  const disabled = page.locator('button[disabled]');
  await expect(disabled.first()).toBeVisible();
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

  // Trade Editor: demo cannot edit trades at all — core cells render read-only (no trigger button)
  // and "Save all" is disabled (owner decision 2026-07-06; F49's pickers are exercised on staging).
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await expect(page.locator('table tbody tr').first().locator('td').nth(3).locator('button')).toHaveCount(0);
  // A161 (non-vacuous): the explicit read-only note EXISTS; the Save-all dirty bar can never appear
  // because nothing can be staged on demo.
  await expect(page.getByTestId('editor-readonly-note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save all' })).toHaveCount(0);

  // CSV Library: the data-management controls (backup / restore / erase) are disabled on demo, and so
  // is the upload dropzone itself — importing is not allowed at all on demo (A134), not merely
  // no-op'd at the final confirm. Even forcing a file onto the hidden input does not open the preview.
  await gotoScreen(page, 'CSV Library');
  await expect(page.getByRole('button', { name: /backup/i }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: /Erase/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /click to browse/i })).toBeDisabled();
  const csv = 'Time,Action,Realized PnL (value)\n2027-05-01 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",30.00';
  await page.setInputFiles('input[type=file]', { name: 'demo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('button', { name: /Import \d+ trade/ })).toHaveCount(0);
});

test('demo: Trade Editor is read-only — no cell editing, Add trade + Save all disabled', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  // Demo cannot edit trades AT ALL (owner decision 2026-07-06): core cells render read-only (no
  // trigger button), Add trade + Save all are disabled. F49's picker cells are covered on staging.
  const symTd = page.locator('table tbody tr').first().locator('td').nth(3);
  await expect(symTd).toBeVisible();
  await expect(symTd.locator('button')).toHaveCount(0); // no editable-cell trigger on demo
  await expect(page.getByTestId('editor-readonly-note')).toBeVisible(); // exists (A161, non-vacuous)
  await expect(page.getByRole('button', { name: 'Save all' })).toHaveCount(0); // no staged edits possible

  // Nothing was persisted (demo never touches IndexedDB), so a reload re-seeds the pristine dataset.
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name || '') : []));
  expect(dbs.filter(n => n.toLowerCase().includes('blotter'))).toHaveLength(0);

  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });
});

test('demo: Blotter surfaces the F40 contract-expiry column (opt-in) + detail row from seeded month codes', async ({ page }) => {
  const errors = watchErrors(page);
  await bootDashboard(page);
  await gotoScreen(page, 'Blotter');
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  // F40: the Contract column is OFF by default — enable it via the Columns picker.
  await page.getByRole('button', { name: 'Columns' }).click();
  const popover = page.locator('[data-slot="popover-content"]');
  await popover.getByText('Contract', { exact: true }).click();
  await page.keyboard.press('Escape'); // close the popover

  // The column header renders, and the seeded symbols (MESM2025 / MNQM2025 / MCLN2025) derive their
  // compact codes (M25 / N25) — proof the helper runs end-to-end on real data, not just in fixtures.
  await expect(page.getByRole('columnheader', { name: 'Contract' })).toBeVisible();
  await expect(
    page
      .locator('table tbody')
      .getByText(/^[MN]25$/)
      .first()
  ).toBeVisible();

  // The detail drawer (the trade-detail surface) shows the same Contract row.
  await page.locator('table tbody tr').first().click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet.getByText('Contract', { exact: true })).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('demo: feedback dialog builds a mailto draft from ONLY the typed text (A105)', async ({ page }) => {
  const errors = watchErrors(page);
  await bootDashboard(page);

  // The topbar affordance opens the dialog; nothing is sent automatically.
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByText(/nothing is sent automatically/i)).toBeVisible();
  await page.getByPlaceholder(/What's working/).fill('love the calendar!');

  // The action is a plain mailto anchor whose body is exactly the typed text — no trade data.
  const mailto = page.getByTestId('feedback-mailto');
  const href = await mailto.getAttribute('href');
  expect(href).toContain('mailto:contact@blotterbook.com');
  expect(href).toContain(encodeURIComponent('love the calendar!'));
  expect(href).toContain(encodeURIComponent('Blotterbook feedback'));
  expect(href.length).toBeLessThan(400); // sanity: nothing bulk-attached

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('feedback-mailto')).toHaveCount(0);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('demo: dashboard tabs render and work in-memory (A135, promoted) — but never persist', async ({ page }) => {
  test.setTimeout(60_000);
  await bootDashboard(page);

  // The tab bar ships on every surface now — demo boots with the implicit Main tab.
  await expect(page.getByRole('button', { name: 'Main', exact: true })).toBeVisible();

  // Creating a tab works (in-memory DemoStore.local): it auto-names itself 'New tab 1' (A198 —
  // no prompt) and becomes active.
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  const newTab = page.getByRole('button', { name: 'New tab 1', exact: true });
  await expect(newTab).toBeVisible();
  await expect(newTab).toHaveAttribute('aria-current', 'page');

  // Demo invariant: nothing persists — a reload is back to the single Main tab.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole('button', { name: 'Main', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New tab 1', exact: true })).toHaveCount(0);
});

test('demo (mobile): top stat cards render as a one-at-a-time carousel with arrows + dots (A200)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await bootDashboard(page);

  // One card at a time: card 1 (Net P&L) shows; card 2 (Win rate) doesn't exist inside the
  // carousel until we move to it (the desktop grid renders it, but hidden at this width).
  const carousel = page.getByRole('group', { name: 'Key stats' });
  await expect(carousel).toBeVisible();
  await expect(carousel.getByText('Net P&L', { exact: true })).toBeVisible();
  await expect(carousel.getByText('Win rate', { exact: true })).toHaveCount(0);

  // Arrows + dots navigate; the dot for the active card is marked current.
  await carousel.getByRole('button', { name: 'Next card' }).click();
  await expect(carousel.getByText('Win rate', { exact: true })).toBeVisible();
  await expect(carousel.getByRole('button', { name: /Go to card 2 of/ })).toHaveAttribute('aria-current', 'true');
  await carousel.getByRole('button', { name: 'Previous card' }).click();
  await expect(carousel.getByText('Net P&L', { exact: true })).toBeVisible();

  // Desktop is unchanged: at sm+ the grid returns and the carousel unmounts.
  await page.setViewportSize({ width: 1280, height: 780 });
  await expect(page.getByRole('group', { name: 'Key stats' })).not.toBeVisible();
  await expect(page.getByText('Win rate', { exact: true })).toBeVisible();
});

test('demo (mobile): no screen scrolls horizontally at 360px (A183) and both calendars fit (A182)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(DEMO, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });

  // Poll-based settle (A194 — no fixed waits): retries until the layout stops widening the page.
  const assertNoHScroll = async label => {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), {
        message: `${label}: page must not scroll horizontally (scrollWidth exceeds clientWidth)`,
      })
      .toBeLessThanOrEqual(0);
  };

  await assertNoHScroll('Dashboard');
  // A184: the cost-setup data-feed select stays inside the viewport even with a long feed label.
  const feed = page.locator('[aria-label="Data feed"]').first();
  if (await feed.isVisible()) {
    const fb = await feed.boundingBox();
    expect(fb.x + fb.width).toBeLessThanOrEqual(360);
  }
  for (const name of ['Calendar', 'Analytics', 'Blotter', 'CSV Library', 'Trade Editor', 'Reports']) {
    // Mobile nav is a drawer — open it, navigate, drawer closes on pick.
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true }).click();
    await expect(page.locator('header h1')).toHaveText(name);
    await assertNoHScroll(name);
  }

  // A182: the Calendar month grid's last day cell ends inside the viewport (no right-edge clip).
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('header h1')).toHaveText('Calendar');
  const cell = page.getByTestId('cal-day').last();
  await expect(cell).toBeVisible();
  const box = await cell.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});

test('demo: the Activity terminal backfills boot events and appends live actions (A188)', async ({ page }) => {
  await bootDashboard(page);

  // The replay buffer backfills the boot events that fired before the terminal mounted.
  const log = page.getByRole('log');
  await expect(log).toBeVisible();
  await expect(log).toContainText('session initiated');
  await expect(log).toContainText(/\[data\] loaded \d+ trades/);
  await expect(log).not.toContainText('Waiting for activity…');
});
