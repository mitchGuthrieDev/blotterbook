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

// Staging is the Svelte 5 app (ADR-001/A27). It boots into the Overview by reusing the
// pure-logic core (loadRefData + compute) over its OWN isolated IndexedDB, seeded once. Verify
// it boots clean, renders real computed metrics, and that the seeded data PERSISTS across a
// reload (the isolated-DB guarantee + no duplicate re-seed). The vanilla render/data paths
// (calendar/day-notes/per-trade editor — B37) stay covered by the demo specs above and ship
// unchanged on prod/demo; their staging-Svelte ports return as A27 advances toward parity.
test('staging (Svelte): boots into Overview with computed metrics, seeded data persists', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });

  // Overview renders from compute() — the net P&L card must show a $ value.
  const net = page.locator('#sv-app [data-card="net"] .value');
  await expect(net).toContainText('$', { timeout: 5000 });
  const tradesText = await page.locator('#sv-app [data-card="trades"] .value').textContent();
  const seededCount = Number((tradesText || '').trim());
  expect(seededCount).toBeGreaterThan(0);

  // Performance equity curve renders an SVG path from compute()'s m.curve.
  const curve = page.locator('#sv-app svg.equity path.line');
  await expect(curve).toHaveAttribute('d', /^M[\d.]+,[\d.]+ L/);

  // Trading calendar renders day cells, including traded (colored) days from m.days.
  await expect(page.locator('#sv-app .calendar .calgrid .cell.traded').first()).toBeVisible();

  // Advanced statistics panel renders its metric rows from compute().
  await expect(page.locator('#sv-app .advstats .row').first()).toBeVisible();

  // Break-even/cost panel reuses costModel() verbatim against the seeded setup → take-home shows.
  await expect(page.locator('#sv-app .costpanel [data-cost-takehome]')).toContainText('$');

  // Reload: the isolated staging DB already has the seed, so the count is identical (no re-seed
  // duplication) and the app still boots clean from persisted data.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(net).toContainText('$', { timeout: 5000 });
  const afterText = await page.locator('#sv-app [data-card="trades"] .value').textContent();
  expect(Number((afterText || '').trim())).toBe(seededCount);

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
