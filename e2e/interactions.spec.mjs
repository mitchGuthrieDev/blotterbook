import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// Demo exercises the interaction-only handlers that boot doesn't reach (modals, calendar,
// export, scope) — these touch render/data/datamanager/widgets/export/ui end to end.
test('demo: stat-card modal, calendar, data manager, export, scope', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveClass(/loaded/);

  await page.click('.card[data-card="net"]');
  await expect(page.locator('#cardModal.open')).toBeVisible();
  await page.click('#cm_close');

  await page.locator('#cal .cell[data-date]').first().click();

  await page.click('#manageBtn');
  await expect(page.locator('#dataModal.open')).toBeVisible();
  await page.fill('#dm_search', 'MES');
  await page.click('#dm_close');

  await page.click('#exportBtn');
  await expect(page.locator('#exportModal.open')).toBeVisible();
  await page.locator('#exportModal [data-expclose]').first().click();

  await page.click('#scope button[data-s="month"]');
  expect(errors, errors.join('\n')).toHaveLength(0);
});

// B33: the equity curve's keyboard nav must announce each date's values via the aria-live tooltip.
test('curve keyboard nav fills the aria-live tooltip (B33)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveClass(/loaded/);
  const tip = page.locator('#curvetip');
  await expect(tip).toHaveAttribute('aria-live', 'polite');
  await page.focus('#curve');
  await page.keyboard.press('ArrowLeft');
  await expect(tip).not.toBeEmpty();
});

// B36: opening/closing a modal must lock then RELEASE body scroll (ref-counted in ui.js).
test('modal scroll-lock releases on close (B36)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveClass(/loaded/);
  await page.click('#manageBtn');
  await expect(page.locator('#dataModal.open')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  await page.click('#dm_close');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

// Staging persists to its own IndexedDB: a saved day-note must place a note dot on the curve
// (B37's Map/binary-search path), and the per-trade editor must persist a tag through the Store.
test('staging: day-note → curve note dot (B37) + per-trade tag persists', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await page.click('#startBtn');
  await expect(page.locator('body')).toHaveClass(/loaded/);

  await page.locator('#cal .cell[data-date]').first().click();
  await page.fill('#j_note', 'e2e note');
  await expect(page.locator('#curve .notedot').first()).toBeVisible({ timeout: 5000 });

  await page.click('#manageBtn');
  await expect(page.locator('#dataModal.open')).toBeVisible();
  await page.locator('#dm_trades button[data-edit]').first().click();
  await page.fill('#dm_tags', 'e2e, tag');
  await page.click('[data-editsave]');
  await expect(page.locator('#dm_trades')).toContainText('e2e');
  await page.click('#dm_close');
  expect(errors, errors.join('\n')).toHaveLength(0);
});

// B41: toggle/collapse controls must expose ARIA state (aria-pressed / aria-expanded).
test('toggle + collapse controls expose ARIA state (B41)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveClass(/loaded/);

  // scope toggle: aria-pressed follows selection
  await expect(page.locator('#scope button[data-s="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scope button[data-s="month"]')).toHaveAttribute('aria-pressed', 'false');
  await page.click('#scope button[data-s="month"]');
  await expect(page.locator('#scope button[data-s="month"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scope button[data-s="all"]')).toHaveAttribute('aria-pressed', 'false');

  // overlay toggle: enabling Net flips its aria-pressed
  await expect(page.locator('.curvebtn[data-k="net"]')).toHaveAttribute('aria-pressed', 'false');
  await page.click('.curvebtn[data-k="net"]');
  await expect(page.locator('.curvebtn[data-k="net"]')).toHaveAttribute('aria-pressed', 'true');

  // panel collapse chevron: aria-expanded + label flip
  const perfChev = page.locator('.panel[data-key="perf"] .chev');
  await expect(perfChev).toHaveAttribute('aria-expanded', 'true');
  await page.click('.panel[data-key="perf"] .phead');
  await expect(perfChev).toHaveAttribute('aria-expanded', 'false');
  await expect(perfChev).toHaveAttribute('aria-label', 'Expand');
});
