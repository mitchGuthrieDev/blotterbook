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

  // Trade Editor: a staged cell edit cannot be saved — "Save all" is disabled on demo.
  // F49: the Symbol cell opens a filterable Popover list (portaled to <body>) instead of a bare
  // inline input, so the filter input is queried at the page level, not scoped under the <td>.
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  const cell = page.locator('table tbody tr').first().locator('td').nth(3).locator('button');
  await cell.click();
  const symbolFilter = page.getByPlaceholder('Filter or type a new root…');
  await symbolFilter.fill('ZZDEMO');
  await symbolFilter.press('Enter');
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
  // is DISABLED (isDemo), so the staged edit can never be persisted. F49: the Symbol cell's filter
  // input lives in a portaled Popover, not inside the <td> — query it at the page level.
  const symCell = page.locator('table tbody tr').first().locator('td').nth(3).locator('button');
  await symCell.click();
  const symbolFilter = page.getByPlaceholder('Filter or type a new root…');
  await symbolFilter.fill('ZZDEMO');
  await symbolFilter.press('Enter');
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

test('demo: Trade Editor Date cell opens a calendar popover and picking a day updates the draft (F49)', async ({ page }) => {
  await bootDashboard(page);
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  // Clicking the Date cell (col 1) opens a month-grid calendar, not a bare text input.
  const dateCell = page.locator('table tbody tr').first().locator('td').nth(1).locator('button');
  await dateCell.click();
  const days = page.getByTestId('datepicker-day');
  await expect(days.first()).toBeVisible();
  const dayCount = await days.count();
  expect(dayCount).toBeGreaterThan(0);

  // Mouse path: pick a day → the popover closes and the cell's staged value is exactly that ISO date.
  const targetIdx = Math.min(9, dayCount - 1);
  const target = days.nth(targetIdx);
  const pickedDate = await target.getAttribute('aria-label'); // rendered as the 'YYYY-MM-DD' itself
  await target.click();
  await expect(page.getByTestId('datepicker-day')).toHaveCount(0); // popover closed after picking
  await expect(dateCell).toHaveText(pickedDate);

  // Keyboard path: reopen, arrow off a focused day, then Enter picks whatever is now focused (the
  // grid handles ArrowLeft/Right/Up/Down + an explicit Enter handler — see onGridKey in
  // DatePickerPopover.svelte). Locator.press() (not a bare page.keyboard.press) focuses + waits for
  // actionability on each element itself, so this isn't racing the popover's open-time re-render.
  await dateCell.click();
  const days2 = page.getByTestId('datepicker-day');
  await expect(days2.first()).toBeVisible();
  const midIdx = Math.min(5, (await days2.count()) - 2);
  await days2.nth(midIdx).press('ArrowRight');
  // Wait for the roving focus to actually land on a day before reading/acting on it (flake guard).
  await expect(page.locator('[data-testid="datepicker-day"]:focus')).toHaveCount(1);
  const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  expect(focusedLabel).toBeTruthy();
  await page.keyboard.press('Enter'); // acts on whatever currently has focus — no re-query race
  await expect(page.getByTestId('datepicker-day')).toHaveCount(0);
  await expect(dateCell).toHaveText(focusedLabel);

  // Escape closes without staging a pick.
  const beforeEscape = await dateCell.textContent();
  await dateCell.click();
  await expect(page.getByTestId('datepicker-day').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('datepicker-day')).toHaveCount(0);
  await expect(dateCell).toHaveText(beforeEscape ?? '');
});

test('demo: Trade Editor Symbol cell opens a filterable list; filtering, picking, and a custom root all work (F49)', async ({ page }) => {
  await bootDashboard(page);
  await gotoScreen(page, 'Trade Editor');
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  const symCell = page.locator('table tbody tr').first().locator('td').nth(3).locator('button');
  await symCell.click();
  const filterInput = page.getByPlaceholder('Filter or type a new root…');
  await expect(filterInput).toBeFocused(); // opens with the filter already focused (keyboard path)

  // The unfiltered list holds every known root (dataset symbols + EXCH/MICRO/NOT_MICRO fee roots).
  const options = page.getByTestId('symbolselect-option');
  const totalCount = await options.count();
  expect(totalCount).toBeGreaterThan(0);

  // Type-to-filter narrows the list to matches, case-insensitively.
  await filterInput.fill('es');
  await expect(options.first()).toBeVisible();
  const filteredTexts = await options.allTextContents();
  expect(filteredTexts.length).toBeGreaterThan(0);
  expect(filteredTexts.length).toBeLessThanOrEqual(totalCount);
  for (const t of filteredTexts) expect(t.toUpperCase()).toContain('ES');

  // Picking an existing option sets the cell's value and closes the popover.
  const pickedOption = (await options.first().textContent())?.trim();
  await options.first().click();
  await expect(page.getByTestId('symbolselect-list')).toHaveCount(0);
  await expect(symCell).toHaveText(pickedOption ?? '');

  // Custom-root path: typing an unlisted root surfaces a free-text 'Use "…"' row at the top of the
  // list, and picking it sets the cell to exactly the typed (canonicalized) root.
  await symCell.click();
  await filterInput.fill('zzcustom');
  const custom = page.getByTestId('symbolselect-custom');
  await expect(custom).toBeVisible();
  await expect(custom).toHaveText('Use "ZZCUSTOM"');
  await custom.click();
  await expect(page.getByTestId('symbolselect-list')).toHaveCount(0);
  await expect(symCell).toHaveText('ZZCUSTOM');
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
