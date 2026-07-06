import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// A221: below Tailwind's sm breakpoint the Blotter's 13-column table (usable but hostile at phone
// widths — A199) is replaced by a card list, one card per trade (symbol+side+qty / P&L+date-time /
// tags), via the same conditional-RENDER MediaQuery pattern as the Dashboard's A200 stat carousel —
// never CSS-hiding both variants. Desktop is unchanged. These specs cover the 360px sweep: cards
// render (table doesn't), no horizontal scroll, selection/bulk actions stay reachable, and a card
// tap opens the same detail Sheet as the desktop row.
//
// Uses the STAGING surface (real IndexedDB-backed engine, seeded) so bulk delete/tag actually work —
// the DEMO surface disables those (dataDisabled=isDemo), which would leave the "row actions reachable
// on mobile" claim untested. The F56 login gate is bypassed the same way staging-redesign.spec.mjs
// does (bb:flags override), matching that file's bootDashboard helper.

const STAGING = '/app/staging.html';
const nav = page => page.locator('nav[aria-label="Primary"]');
const gotoScreen = async (page, name) => {
  await nav(page).getByRole('button', { name, exact: true }).click();
  await expect(page.locator('header h1')).toHaveText(name);
};
const bootDashboard = async page => {
  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto(STAGING, { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
};
const gotoBlotterMobile = async page => {
  await page.setViewportSize({ width: 360, height: 780 });
  await bootDashboard(page);
  // Mobile nav is a drawer (A182-family pattern) — open it, navigate, drawer closes on pick.
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Blotter', exact: true }).click();
  await expect(page.locator('header h1')).toHaveText('Blotter');
};

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
