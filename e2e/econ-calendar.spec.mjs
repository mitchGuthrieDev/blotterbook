import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// R14b — the economic-event Calendar overlay. The R14a dataset (static/data/econ-events.json) is a
// curated US-government release calendar (FOMC/CPI/NFP/GDP high-impact + weekly EIA medium); the
// overlay defaults ON at high-impact, with an Off/High/All toolbar control on the Calendar screen,
// persisted per-surface via Store.local ('bb:econCal' / 'bb:staging:econCal') and lazily fetched
// (NOT in the boot loadRefData path). These specs assert (a) marks render on known real dates when
// enabled, (b) the pref persists across a reload, and (c) the demo non-persistence invariant holds.
//
// The seeded surfaces (staging/demo) span Jul-2024 → Jun-2026, so the calendar cursor lands on a
// 2026 month whose real high-impact releases (FOMC/CPI/NFP) fall on weekdays with seed trades — the
// dataset covers 2021–2026, so those cells carry marks with the default High overlay.

const STAGING = '/app/staging.html';
const DEMO = '/app/demo.html';
const nav = page => page.locator('nav[aria-label="Primary"]');
// Staging arms the F56 login gate by default; bypass it (these specs exercise the calendar, not the gate).
const bypassGate = page => page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
const gotoCalendar = async page => {
  await nav(page).getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('header h1')).toHaveText('Calendar');
};
// The Off/High/All overlay control (a SegmentedControl) lives in the Calendar toolbar next to "Econ".
const econSeg = (page, label) => page.getByRole('button', { name: label, exact: true });

test('staging: econ overlay defaults ON (High) and marks render on real release dates', async ({ page }) => {
  const errors = watchErrors(page);
  await bypassGate(page);
  await page.goto(STAGING, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await gotoCalendar(page);

  // Default is High (owner v1 decision): the control shows High selected and marks appear once the
  // lazily-fetched dataset resolves. The cursor month (a 2026 month) has FOMC/CPI/NFP high-impact
  // releases, so at least one cell carries an econ mark.
  await expect(page.getByTestId('econ-mark').first()).toBeVisible({ timeout: 6000 });
  const highCount = await page.getByTestId('econ-mark').count();
  expect(highCount).toBeGreaterThan(0);

  // Switching to All reveals the medium-impact weekly EIA rows too → strictly MORE marked cells.
  await econSeg(page, 'All').click();
  await expect.poll(async () => page.getByTestId('econ-mark').count(), { timeout: 4000 }).toBeGreaterThan(highCount);

  // Turning it Off removes every mark.
  await econSeg(page, 'Off').click();
  await expect(page.getByTestId('econ-mark')).toHaveCount(0);

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('staging: the day drill-in lists the econ events (time ET · label · impact)', async ({ page }) => {
  await bypassGate(page);
  await page.goto(STAGING, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await gotoCalendar(page);

  // Open the first marked day; the right-rail detail shows an "Economic events" list.
  await expect(page.getByTestId('econ-mark').first()).toBeVisible({ timeout: 6000 });
  await page.getByTestId('econ-mark').first().locator('xpath=ancestor::button').click();
  await expect(page.getByText('Economic events', { exact: true })).toBeVisible();
});

test('staging: the overlay preference persists across a reload (real Store.local)', async ({ page }) => {
  await bypassGate(page);
  await page.goto(STAGING, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await gotoCalendar(page);

  // Flip to Off and confirm marks clear.
  await expect(page.getByTestId('econ-mark').first()).toBeVisible({ timeout: 6000 });
  await econSeg(page, 'Off').click();
  await expect(page.getByTestId('econ-mark')).toHaveCount(0);
  // It persisted to the isolated staging DB's localStorage under the namespaced key.
  const stored = await page.evaluate(() => localStorage.getItem('bb:staging:econCal'));
  expect(stored).toBe('"off"');

  // Reload → the pref is restored (still Off), so no marks render on the Calendar.
  await bypassGate(page);
  await page.goto(STAGING, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await gotoCalendar(page);
  // Give the (skipped) lazy load a beat; Off must stay Off with zero marks.
  await expect(page.getByTestId('econ-mark')).toHaveCount(0);
  await expect(econSeg(page, 'Off')).toBeVisible();
});

test('demo: HARD invariant — toggling the econ overlay persists NOTHING (no blotterbook IndexedDB)', async ({ page }) => {
  await page.goto(DEMO, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  await gotoCalendar(page);

  // The overlay is interactive on demo (DemoStore.local is in-memory) — cycle through the modes.
  await expect(page.getByTestId('econ-mark').first()).toBeVisible({ timeout: 6000 });
  await econSeg(page, 'All').click();
  await econSeg(page, 'Off').click();
  await econSeg(page, 'High').click();

  // Nothing reached IndexedDB: demo never creates a "blotterbook" database, by construction.
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name || '') : []));
  expect(dbs.filter(n => n.toLowerCase().includes('blotter'))).toHaveLength(0);
});
