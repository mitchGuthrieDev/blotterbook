import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// A221: below Tailwind's sm breakpoint the Blotter's 13-column table (usable but hostile at phone
// widths — A199) is replaced by a card list, one card per trade (symbol+side+qty / P&L+date-time /
// tags), via the same conditional-RENDER MediaQuery pattern as the Dashboard's A200 stat carousel —
// never CSS-hiding both variants. Desktop is unchanged. These specs cover the 360px sweep: cards
// render (table doesn't), no horizontal scroll, selection/bulk actions stay reachable, and a card
// tap opens the same detail Sheet as the desktop row.
//
// A222 (below): the file also carries the coarse-pointer touch-target pass's interaction coverage —
// this is the sole e2e file that workstream is allowed to touch (extends A221's scope per the sprint
// plan), so it's the natural home even though a couple of assertions exercise Calendar/Dashboard.
//
// Uses the STAGING surface (real IndexedDB-backed engine, seeded) so bulk delete/tag actually work —
// the DEMO surface disables those (dataDisabled=isDemo), which would leave the "row actions reachable
// on mobile" claim untested. The F56 login gate is bypassed the same way staging-redesign.spec.mjs
// does (bb:flags override), matching that file's bootDashboard helper.

const STAGING = '/app/staging.html';
const bootDashboard = async page => {
  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto(STAGING, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
};
// Mobile nav is a drawer (A182-family pattern) — open it, navigate, drawer closes on pick.
const gotoScreenMobile = async (page, name) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await bootDashboard(page);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true }).click();
  await expect(page.locator('header h1')).toHaveText(name);
};
const gotoBlotterMobile = page => gotoScreenMobile(page, 'Blotter');

test('mobile blotter (360px): cards render instead of the table, no horizontal scroll', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoBlotterMobile(page);

  // The card list renders (one listitem per trade)…
  const list = page.getByRole('list', { name: 'Trades' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem').first()).toBeVisible();
  // …and the 13-column desktop table does NOT exist in the DOM (conditional render, not CSS-hidden —
  // A200 pattern: the table would double every row for locators/AT if both existed at once).
  await expect(page.locator('table')).toHaveCount(0);

  // No horizontal scroll at 360px (A183-style poll-based settle).
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('mobile blotter (360px): a card tap opens the same detail Sheet as the desktop row', async ({ page }) => {
  await gotoBlotterMobile(page);

  const firstCard = page.getByRole('list', { name: 'Trades' }).getByRole('listitem').first();
  // The symbol is a real <button> inside the card (keyboard/AT trigger — the card div's own onclick
  // is a pointer-only convenience, same convention as the desktop row's symbol button). Note this is
  // role=button specifically — the leading selection control is role=checkbox, not role=button.
  await firstCard.getByRole('button').first().click();

  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByPlaceholder('Notes for this trade…')).toBeVisible();
  // bits-ui's Sheet.Content also renders its own auto-labeled "Close" corner button (the X) ahead
  // of the footer's explicit ghost Close button in DOM order — `.last()` picks the latter.
  await sheet.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(sheet).not.toBeVisible();
});

test('mobile blotter (360px): selection + bulk delete stay reachable from the card list', async ({ page }) => {
  await gotoBlotterMobile(page);

  const countText = await page.getByText(/\d+ of \d+ trades/).innerText();
  const total = Number(countText.match(/of (\d+) trades/)[1]);

  // Each card carries its own selection checkbox (reuses the desktop table's `selected` set —
  // there's no "select all" affordance in the card view since there's no table header row).
  const firstCard = page.getByRole('list', { name: 'Trades' }).getByRole('listitem').first();
  await firstCard.getByRole('checkbox', { name: 'Select trade' }).check();
  await expect(page.getByText('1 selected')).toBeVisible();

  // The bulk-action bar (Tag / Delete) is the same shared toolbar as desktop — reachable at 360px.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Delete 1 trade?')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.getByText(`${total - 1} of ${total - 1} trades`)).toBeVisible({ timeout: 4000 });
});

// A222: coarse-pointer touch-target pass. The sweep raised a tail of sub-24px icon buttons
// (Calendar's daily-target stepper, chip remove ✕s, the shared Checkbox/Switch primitives, …) to a
// WCAG-2.2-AA-compliant tap area via an invisible `pointer-coarse:before:absolute` hit-slop (a
// positioned ::before extending past the visible box — no visual/layout change outside `hasTouch`
// contexts) rather than growing the control itself. These specs run under real `hasTouch` emulation
// (which flips `(pointer: coarse)` in Chromium) and TAP just past a control's own visible edge —
// inside the hit-slop, outside the glyph — to prove the enlarged area is actually reachable, not
// just present in the stylesheet. A couple of directly-adjacent clusters (DashTabs' menu/close ✕,
// Dashboard's rename/delete-filter pair) used a plain `pointer-coarse:size-8` bump instead, since an
// invisible overlay would have bled into the touching neighbor — those are covered by a
// bounding-box assertion instead of an off-target tap.
test.describe('A222 coarse-pointer touch targets', () => {
  test.use({ hasTouch: true });

  test('hasTouch emulation actually flips the pointer-coarse media query', async ({ page }) => {
    await gotoScreenMobile(page, 'Calendar');
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
  });

  test('Calendar daily-target stepper: a tap just outside the 20px button still registers', async ({ page }) => {
    await gotoScreenMobile(page, 'Calendar');
    const value = page.getByTestId('cal-target-value');
    const before = await value.innerText();
    // 4px outside the button's own left edge — inside the pointer-coarse -inset-2 (8px) hit-slop,
    // outside the size-5 (20px) visible box.
    await page.getByRole('button', { name: 'Raise target', exact: true }).tap({ position: { x: -4, y: 10 } });
    await expect(value).not.toHaveText(before);
  });

  test('mobile Blotter card: a tap just outside the 16px checkbox still toggles selection', async ({ page }) => {
    await gotoBlotterMobile(page);
    const checkbox = page
      .getByRole('list', { name: 'Trades' })
      .getByRole('listitem')
      .first()
      .getByRole('checkbox', { name: 'Select trade' });
    // 5px outside the checkbox's own box on both axes — inside the shared Checkbox primitive's
    // pointer-coarse -inset-1.5 (6px) hit-slop, outside the size-4 (16px) visible box.
    await checkbox.tap({ position: { x: -5, y: -5 } });
    await expect(page.getByText('1 selected')).toBeVisible();
  });

  test('DashTabs menu/close buttons grow to 32px on coarse pointers (adjacent cluster — size bump, not hit-slop)', async ({ page }) => {
    await gotoScreenMobile(page, 'Dashboard');
    const closeBtn = page.getByRole('button', { name: /^Close tab: /, exact: false }).first();
    const box = await closeBtn.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.height).toBeGreaterThanOrEqual(32);
  });
});
