import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// A33 cutover: demo is the Svelte app (data-mode="demo") backed by the in-memory DemoStore — the
// SAME App.svelte that ships to prod. (The UI-redesign Phase-3 cutover re-platformed ONLY the
// staging surface onto the new sidebar shell — covered in staging-redesign.spec.mjs — so demo/prod
// keep the current dashboard and these specs continue to guard it.) Here we cover what's DIFFERENT
// about demo: it boots + explores read-only, every write control is disabled, and the HARD invariant
// holds — NOTHING is written to IndexedDB.
test('demo (Svelte): boots, explores read-only, never persists, write controls disabled', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });

  // Boots into the overview with computed metrics (seeded in-memory, not from IndexedDB).
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });

  // Read-only interaction still works: a stat-card modal opens and closes.
  await page.click('#sv-app [data-card="net"]');
  await expect(page.locator('.modal[aria-label="Net PnL"]')).toBeVisible();
  await page.click('.modal[aria-label="Net PnL"] [data-slot="dialog-close"]');

  // Manage-data: the write controls are DISABLED in demo.
  await page.click('.managebtn');
  await expect(page.locator('.modal .toolbar button', { hasText: 'Load CSV' })).toBeDisabled();
  await expect(page.locator('.modal .toolbar button', { hasText: 'Erase all local data' })).toBeDisabled();
  await expect(page.locator('.modal .edit').first()).toBeDisabled();
  await page.click('.modal[aria-label="Manage data"] [data-slot="dialog-close"]');

  // Day-note editor is read-only in demo (the save is disabled + a note shown).
  await page.locator('#sv-app .calendar .calgrid .cell.traded').first().click();
  await expect(page.locator('#sv-app .journal .demonote')).toBeVisible();
  await expect(page.locator('#sv-app .journal .save')).toBeDisabled();

  // HARD invariant (demo never persists): no Blotterbook IndexedDB database was created.
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name || '') : []));
  expect(dbs.filter(n => n.toLowerCase().includes('blotter'))).toHaveLength(0);

  expect(errors, errors.join('\n')).toHaveLength(0);
});

// A89: the admin feature flags are live — App.svelte fetches /api/config at boot and applies them.
// Mock the endpoint (the static e2e server has no Worker) and assert the betaRibbon badge +
// maintenanceBanner render.
test('demo (Svelte): admin flags drive the betaRibbon badge + maintenance banner (A89)', async ({ page }) => {
  await page.route('**/api/config', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flags: { betaRibbon: true, maintenanceBanner: true, showBetaAdapters: false } }),
    })
  );
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });

  // Boots into the overview, then the flags resolve and the chrome appears.
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .brand .badge.beta')).toHaveText('Beta');
  await expect(page.locator('#sv-app .maintbanner')).toBeVisible();
});

// F24 staging-gated: prod/demo show no Donate button.
test('demo (Svelte): no Donate button (F24 staging-gated)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .donatebtn')).toHaveCount(0);
});

// F25 staging-gated: prod/demo keep the full Overview card grid.
test('demo (Svelte): Overview keeps the full card grid (F25 staging-gated)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .cards [data-card="trades"]')).toBeVisible();
  await expect(page.locator('#sv-app .cards [data-card="exp"]')).toBeVisible();
});

// F26 staging-gated: prod/demo keep the modules stacked full-width (no grid).
test('demo (Svelte): no module grid — modules stay full-width (F26 staging-gated)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .modgrid')).toHaveCount(0);
});

// F27 staging-gated: demo keeps Definitions as a dashboard panel.
test('demo (Svelte): Definitions stays a dashboard panel (F27 staging-gated)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .dash .panel[data-key="defs"]')).toBeVisible();
  await expect(page.locator('#sv-app footer.deffoot')).toHaveCount(0);
});

// F23 promoted to all surfaces (CH16): the Trade Blotter appears on demo too, directly below the
// Trading Calendar — and stays NON-MUTATING on demo (the inline Note input is disabled).
test('demo (Svelte): Trade Blotter module present + non-mutating (F23, promoted)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const blotter = page.locator('#sv-app .panel[data-key="blotter"]');
  await expect(blotter).toBeVisible();
  const keys = await page.locator('#sv-app .dash section.panel').evaluateAll(els => els.map(e => e.getAttribute('data-key')));
  expect(keys.indexOf('blotter')).toBe(keys.indexOf('cal') + 1);
  await expect(blotter.locator('.bltab tbody tr').first()).toBeVisible();
  // F31/F32 staging-gated: demo keeps the 8-column blotter (no Broker column) and no pager.
  await expect(blotter.locator('.bltab thead th')).toHaveCount(8);
  await expect(blotter.locator('.bltab thead th', { hasText: 'Broker' })).toHaveCount(0);
  await expect(blotter.locator('.blpager')).toHaveCount(0);
  // Demo must not mutate: the inline Note input is disabled.
  await expect(blotter.locator('.bltab tbody tr .note').first()).toBeDisabled();
});

// F33 staging-gated: prod/demo keep the wordmark as plain text.
test('demo (Svelte): the Blotterbook logo is not a link (F33 staging-gated)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .brand a')).toHaveCount(0);
});

// A97 (R18) promoted to all surfaces (CH16): the Definitions panel is trimmed to the parsing caveats
// on demo too, and the per-metric definitions now ride in the panels that own each number.
test('demo (Svelte): definitions distributed + Definitions panel trimmed (A97, promoted)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  // Definitions panel trimmed: keeps the parsing caveat, drops the full glossary.
  await expect(page.locator('#sv-app .defs')).toContainText('Trade = one closed position');
  await expect(page.locator('#sv-app .defs')).not.toContainText('Win / Loss / Scratch');
  // The per-metric definition now lives in the Advanced Statistics panel's own caveats.
  await expect(page.locator('#sv-app .panel[data-key="adv"] .caveats')).toContainText('Payoff Ratio');
});

// A71/R12 promoted to all surfaces (CH16): demo now also has the module-header menu.
test('demo (Svelte): dashboard module headers have a menu (A71, promoted)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .dash section.panel').first()).toBeVisible();
  await expect(page.locator('#sv-app .dash .pmenubtn').first()).toBeVisible();
  await page.locator('#sv-app .dash section.panel .pmenubtn').first().click();
  await expect(page.locator('.pmenupop').getByRole('menuitem')).toHaveCount(4);
});

// A73 promoted to all surfaces (CH16): demo now also paginates the trades table.
test('demo (Svelte): Manage-data trades table paginates (A73, promoted)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await page.click('.managebtn');
  await expect(page.locator('.modal .tablewrap tbody tr')).toHaveCount(50);
  await expect(page.locator('.modal .pginfo')).toContainText('1–50 of');
});

// L11 safety net: a stuck inline `body { pointer-events: none }` (the modal scroll-lock's teardown
// being skipped) must never freeze the page — the global CSS keys the lock to a modal overlay being
// present, so with no overlay the body is forced interactive again. Guards the "unresponsive after
// dismissing a dialog" regression on every surface.
test('demo (Svelte): a stray body pointer-events lock cannot freeze the page (L11 safety net)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  // Simulate a leaked scroll-lock with NO modal overlay in the DOM.
  const computed = await page.evaluate(() => {
    document.body.style.pointerEvents = 'none';
    return getComputedStyle(document.body).pointerEvents;
  });
  expect(computed).toBe('auto'); // the safety net overrides the stale inline lock
  await page.click('#sv-app [data-card="net"]', { timeout: 3000 }); // page is genuinely clickable
  await expect(page.locator('.modal[aria-label="Net PnL"]')).toBeVisible();
  // While a real modal IS open, the guard does not apply — the overlay locks the background.
  expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).toBe('none');
});

// B41: toggle/collapse controls must expose ARIA state (aria-pressed / aria-expanded) on the Svelte
// surface (demo) after the A33 cutover.
test('toggle + collapse controls expose ARIA state (B41)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });

  // scope toggle: aria-pressed follows selection
  const all = page.locator('#sv-app .filterbar .scope button').first();
  const month = page.locator('#sv-app .filterbar .scope button').last();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(month).toHaveAttribute('aria-pressed', 'false');
  await month.click();
  await expect(month).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');

  // overlay toggle: enabling Net flips its aria-pressed
  const netBtn = page.locator('#sv-app .overlays button', { hasText: 'Net' });
  await expect(netBtn).toHaveAttribute('aria-pressed', 'false');
  await netBtn.click();
  await expect(netBtn).toHaveAttribute('aria-pressed', 'true');

  // panel collapse chevron: aria-expanded + label flip
  const perfChev = page.locator('#sv-app .panel[data-key="perf"] .chev');
  await expect(perfChev).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#sv-app .panel[data-key="perf"] .phead').click();
  await expect(perfChev).toHaveAttribute('aria-expanded', 'false');
  await expect(perfChev).toHaveAttribute('aria-label', 'Expand');
});
