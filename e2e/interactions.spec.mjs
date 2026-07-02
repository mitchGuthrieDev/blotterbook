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
  // A161: assert the control EXISTS before asserting disabled — the old `if (count())` guard
  // vacuously passed if "Save all" was ever renamed/removed, silencing the demo write-guard.
  const saveAll = page.getByRole('button', { name: 'Save all' });
  await expect(saveAll).toHaveCount(1);
  await expect(saveAll).toBeDisabled();

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
  await expect(saveAll).toHaveCount(1); // A161: no vacuous pass if the control is renamed
  await expect(saveAll).toBeDisabled();
  await page.waitForTimeout(300);

  // Nothing was persisted (demo never touches IndexedDB), so a reload re-seeds the pristine dataset.
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name || '') : []));
  expect(dbs.filter(n => n.toLowerCase().includes('blotter'))).toHaveLength(0);

  await page.reload({ waitUntil: 'networkidle' });
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('ZZDEMO')).toHaveCount(0); // the edit did not survive
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
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Swing' : undefined));
  await bootDashboard(page);

  // The tab bar ships on every surface now — demo boots with the implicit Main tab.
  await expect(page.getByRole('button', { name: 'Main', exact: true })).toBeVisible();

  // Creating a tab works (in-memory DemoStore.local) and becomes active.
  await page.getByRole('button', { name: 'New tab' }).click();
  const swingTab = page.getByRole('button', { name: 'Swing', exact: true });
  await expect(swingTab).toBeVisible();
  await expect(swingTab).toHaveAttribute('aria-current', 'page');

  // Demo invariant: nothing persists — a reload is back to the single Main tab.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(page.getByRole('button', { name: 'Main', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Swing', exact: true })).toHaveCount(0);
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
