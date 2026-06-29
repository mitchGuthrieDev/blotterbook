import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// A33 cutover: demo is now the SAME Svelte app (data-mode="demo") backed by the in-memory
// DemoStore. The interaction behaviors (modals, curve, calendar, export, scope) are covered by the
// staging Svelte tests below — the SAME code runs on demo. Here we cover what's DIFFERENT about
// demo: it boots + explores read-only, every write control is disabled, and the HARD invariant
// holds — NOTHING is written to IndexedDB.
test('demo (Svelte): boots, explores read-only, never persists, write controls disabled', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });

  // Boots into the overview with computed metrics (seeded in-memory, not from IndexedDB).
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });

  // Read-only interaction still works: a stat-card modal opens and closes.
  await page.click('#sv-app [data-card="net"]');
  await expect(page.locator('.modal[aria-label="Net PnL"]')).toBeVisible();
  await page.click('.modal[aria-label="Net PnL"] .x');

  // Manage-data: the write controls are DISABLED in demo.
  await page.click('.managebtn');
  await expect(page.locator('.modal .toolbar button', { hasText: 'Load CSV' })).toBeDisabled();
  await expect(page.locator('.modal .toolbar button', { hasText: 'Erase all local data' })).toBeDisabled();
  await expect(page.locator('.modal .edit').first()).toBeDisabled();
  await page.click('.modal[aria-label="Manage data"] .x');

  // Day-note editor is read-only in demo (the save is disabled + a note shown).
  await page.locator('#sv-app .calendar .calgrid .cell.traded').first().click();
  await expect(page.locator('#sv-app .journal .demonote')).toBeVisible();
  await expect(page.locator('#sv-app .journal .save')).toBeDisabled();

  // HARD invariant (demo never persists): no Blotterbook IndexedDB database was created.
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map(d => d.name || '') : []));
  expect(dbs.filter(n => n.toLowerCase().includes('blotter'))).toHaveLength(0);

  expect(errors, errors.join('\n')).toHaveLength(0);
});

// A89: the admin feature flags are live again — App.svelte fetches /api/config at boot and applies
// them. Mock the endpoint (the static e2e server has no Worker) and assert the betaRibbon badge +
// maintenanceBanner render. Default (unmocked) boots show neither — covered implicitly by the specs
// above, which never see a Beta badge or banner.
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
  // F25 (staging): the Overview keeps only the five interactive cards — the "trades" card was folded
  // into Advanced Statistics — so read the active trade count from the filter bar's "N trades" pill.
  const count = page.locator('#sv-app .filterbar .count');
  const seededCount = parseInt(((await count.textContent()) || '').replace(/[^\d]/g, ''), 10);
  expect(seededCount).toBeGreaterThan(0);

  // Stat-card detail modal (A35): clicking the Net card opens the drill-down with the waterfall.
  await page.click('#sv-app [data-card="net"]');
  await expect(page.locator('.modal[aria-label="Net PnL"]')).toBeVisible();
  await expect(page.locator('.modal[aria-label="Net PnL"] .bars')).toContainText('Take-home');
  await page.click('.modal[aria-label="Net PnL"] .x');

  // Avg Win/Loss card + its detail modal (A39 — parity with vanilla's 5th headline card).
  await expect(page.locator('#sv-app [data-card="wl"] .value')).toBeVisible();
  await page.click('#sv-app [data-card="wl"]');
  await expect(page.locator('.modal[aria-label="Avg Win / Loss"]')).toBeVisible();
  await expect(page.locator('.modal[aria-label="Avg Win / Loss"]')).toContainText('Win distribution');
  await page.click('.modal[aria-label="Avg Win / Loss"] .x');

  // Win-rate modal: proportional wins/losses/scratch split bar (A46).
  await page.click('#sv-app [data-card="win"]');
  await expect(page.locator('.modal[aria-label="Win Rate"] .split .seg').first()).toBeVisible();
  await page.click('.modal[aria-label="Win Rate"] .x');
  // Profit-factor modal: by-symbol table with PF + net columns (A46).
  await page.click('#sv-app [data-card="pf"]');
  await expect(page.locator('.modal[aria-label="Profit Factor"] .symtab tbody tr').first()).toBeVisible();
  await page.click('.modal[aria-label="Profit Factor"] .x');

  // Performance equity curve renders an SVG path from compute()'s m.curve.
  const curve = page.locator('#sv-app svg.equity path.line');
  await expect(curve).toHaveAttribute('d', /^M[\d.]+,[\d.]+ L/);
  // Axis furniture (A43): y-axis $ tick labels + end-of-line value labels render.
  await expect(page.locator('#sv-app svg.equity .ylab').first()).toBeVisible();
  await expect(page.locator('#sv-app svg.equity .endlab').first()).toBeVisible();

  // Trading calendar renders day cells, including traded (colored) days from m.days.
  await expect(page.locator('#sv-app .calendar .calgrid .cell.traded').first()).toBeVisible();
  // Calendar Week column (A40): each row carries an ISO week number + weekly P&L.
  await expect(page.locator('#sv-app .calendar .calgrid .wkcell .wkno').first()).toContainText('Wk');
  // Per-day trade count + win% in each traded cell (A44).
  await expect(page.locator('#sv-app .calendar .calgrid .cell.traded .dmeta').first()).toContainText('tr');

  // Advanced statistics panel renders its metric rows from compute().
  await expect(page.locator('#sv-app .advstats .row').first()).toBeVisible();

  // Break-even/cost panel reuses costModel() verbatim against the seeded setup → take-home shows.
  await expect(page.locator('#sv-app .costpanel [data-cost-takehome]')).toContainText('$');
  await expect(page.locator('#sv-app .costpanel .caveats summary')).toBeVisible(); // A38
  await expect(page.locator('#sv-app .costpanel .bysym thead')).toContainText('$/RT'); // A48 round-turn column

  // Filters/scope: switching to the calendar-month scope narrows the active trade count.
  await page.click('#sv-app .filterbar .scope button:last-child');
  const monthCount = parseInt(((await count.textContent()) || '').replace(/[^\d]/g, ''), 10);
  expect(monthCount).toBeLessThan(seededCount);

  // Day-notes journal: select a calendar day, write a note, save → a note dot appears + persists.
  await page.locator('#sv-app .calendar .calgrid .cell.traded').first().click();
  // Per-day trade table (A50): selecting a traded day shows its intraday trades.
  await expect(page.locator('#sv-app .daytrades .dttab tbody tr').first()).toBeVisible();
  await expect(page.locator('#sv-app .daytrades .dtnet')).toContainText('$');
  await page.fill('#sv-app .journal textarea', 'e2e day note');
  await page.click('#sv-app .journal .save');
  await expect(page.locator('#sv-app .calendar .calgrid .cell .notedot').first()).toBeVisible();

  // Day-note screenshot (A32): uploading an image adds a thumbnail (validShot allow-list).
  await page
    .locator('#sv-app .journal input[type=file]')
    .setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') });
  await expect(page.locator('#sv-app .journal .shot img')).toHaveCount(1);

  // Activity terminal logs bus events — the note save above should appear.
  await expect(page.locator('#sv-app .terminal .log')).toContainText('note saved');

  // F27 (staging): the Definitions & Caveats module is relegated to a page FOOTER (not a dashboard
  // panel). It keeps the trimmed parsing caveats (A97); the per-metric definitions live in the panels.
  await expect(page.locator('#sv-app .dash .panel[data-key="defs"]')).toHaveCount(0);
  await expect(page.locator('#sv-app footer.deffoot')).toContainText('Trade = one closed position');
  await expect(page.locator('#sv-app footer.deffoot')).not.toContainText('Win / Loss / Scratch');
  // The Advanced Statistics panel now carries its own "Assumptions & caveats" (mirror of CostPanel).
  await expect(page.locator('#sv-app .panel[data-key="adv"] .caveats')).toContainText('Payoff Ratio');

  // Equity curve interactivity (A32): the journaled day shows a note-dot on the curve, and the
  // keyboard cursor fills the aria-live tooltip (B33).
  await expect(page.locator('#sv-app svg.equity .notedot').first()).toBeVisible();
  await page.locator('#sv-app svg.equity').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#sv-app .axis .tip')).not.toHaveText('cumulative P&L');

  // Overlays (A32): default is gross-only (1 line); enabling Net adds a second series line.
  await expect(page.locator('#sv-app svg.equity .line')).toHaveCount(1);
  await page.click('#sv-app .overlays button:has-text("Net")');
  await expect(page.locator('#sv-app svg.equity .line')).toHaveCount(2);

  // Export report (A34): open the modal, the iframe preview renders the report sheet, switching the
  // format dropdown enables Download, and Email a copy is a mailto link.
  await page.click('button:has-text("Export report")');
  await expect(page.locator('#sv-app .modal[aria-label="Export performance report"]')).toBeVisible();
  const repFrame = page.frameLocator('iframe[title="Performance report preview"]');
  await expect(repFrame.locator('.sheet .brandline')).toContainText('Blotterbook');
  await expect(repFrame.locator('.tiles .rtile').first()).toBeVisible();
  await expect(page.locator('.modal[aria-label="Export performance report"] a:has-text("Email a copy")')).toHaveAttribute(
    'href',
    /^mailto:/
  );
  await page.selectOption('.modal[aria-label="Export performance report"] select', 'md');
  await expect(page.locator('.modal[aria-label="Export performance report"] .pri')).toBeEnabled();
  await page.click('.modal[aria-label="Export performance report"] [data-expclose]');
  await expect(page.locator('#sv-app .modal[aria-label="Export performance report"]')).toHaveCount(0);

  // A38 Tier-2 bits: filter trade-count, session pill, calendar Latest button all render.
  await expect(page.locator('#sv-app .filterbar .count')).toContainText('trade');
  await expect(page.locator('#sv-app .pill')).toBeVisible();
  await expect(page.locator('#sv-app .panel[data-key="cal"] .nav .today')).toBeVisible();
  // Session-pill legend popup (A49): clicking the pill opens the status legend.
  await page.click('#sv-app .pill');
  await expect(page.locator('#sv-app .sesspop')).toContainText('Online');

  // Manage data: open the modal, edit a trade's tags via the Store, and see them in the table.
  await page.click('.managebtn');
  await expect(page.locator('.modal table tbody tr').first()).toBeVisible();
  // Overview stats grid (A52): the modal shows trade count / date range / etc.
  await expect(page.locator('.modal .summary .dmstat')).toHaveCount(5);
  await expect(page.locator('.modal .summary')).toContainText('Trades');
  // A38: the day-notes list shows the note saved earlier.
  await expect(page.locator('.modal .daynotes')).toContainText('e2e day note');
  await page.locator('.modal .edit').first().click();
  await page.fill('.modal .etags', 'e2e, setup');
  await page.click('.modal .editrow .save');
  await expect(page.locator('.modal table tbody tr .tags').first()).toContainText('e2e');

  // Per-trade screenshot (A32): upload → save → reopen shows it persisted (saveTradeMeta path).
  await page.locator('.modal .edit').first().click();
  await page
    .locator('.modal .editshots input[type=file]')
    .setInputFiles({ name: 't.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') });
  await expect(page.locator('.modal .editshots .shot img')).toHaveCount(1);
  await page.click('.modal .editrow .save');
  await page.locator('.modal .edit').first().click();
  await expect(page.locator('.modal .editshots .shot img')).toHaveCount(1);
  await page.click('.modal .editrow .save');

  // Reload: the isolated staging DB already has the seed, so the count is identical (no re-seed
  // duplication) and the app still boots clean from persisted data.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(net).toContainText('$', { timeout: 5000 });
  const afterCount = parseInt(((await page.locator('#sv-app .filterbar .count').textContent()) || '').replace(/[^\d]/g, ''), 10);
  expect(afterCount).toBe(seededCount);

  expect(errors, errors.join('\n')).toHaveLength(0);
});

// A32: the staging filter bar's session (RTH/ETH) filter narrows the active dataset.
test('staging (Svelte): session filter narrows the dataset', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  // F25 (staging): the trade count comes from the filter bar's "N trades" pill (the Overview "trades"
  // card was folded into Advanced Statistics).
  const count = page.locator('#sv-app .filterbar .count');
  const readCount = async () => parseInt(((await count.textContent()) || '').replace(/[^\d]/g, ''), 10);
  const all = await readCount();
  expect(all).toBeGreaterThan(0);
  await page.getByLabel('Session').selectOption('rth');
  await expect(count).not.toHaveText(`${all} trades`); // RTH-only is a strict subset
  expect(await readCount()).toBeLessThan(all);

  // Saved-filter views: save the current filter set → a chip appears (persists to the Store).
  await page.fill('#sv-app .saved .vname', 'rth view');
  await page.click('#sv-app .saved .savebtn');
  await expect(page.locator('#sv-app .saved .chip .apply')).toContainText('rth view');

  // Manage-data Saved-filters section (A53): the saved view is listed and can be renamed.
  page.on('dialog', d => d.accept('renamed view')); // window.prompt for the new name
  await page.click('.managebtn');
  await page.click('.modal .savedfilters summary'); // expand the collapsed <details>
  await expect(page.locator('.modal .savedfilters')).toContainText('rth view');
  await page.locator('.modal .savedfilters .sfbtn').first().click();
  await expect(page.locator('.modal .savedfilters')).toContainText('renamed view');
});

// A36: the dashboard panel system — collapse (with ARIA + persistence) and workspace templates.
test('staging (Svelte): panel collapse persists + workspace templates (A36)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  const perf = page.locator('#sv-app .panel[data-key="perf"]');
  await expect(perf).toBeVisible();
  await expect(perf.locator('svg.equity')).toBeVisible();

  // Collapse via the header: the chevron flips aria-expanded/label (B41) and the body is removed.
  const chev = perf.locator('.chev');
  await expect(chev).toHaveAttribute('aria-expanded', 'true');
  await perf.locator('.phead').click();
  await expect(chev).toHaveAttribute('aria-expanded', 'false');
  await expect(chev).toHaveAttribute('aria-label', 'Expand');
  await expect(perf.locator('svg.equity')).toHaveCount(0);

  // The collapsed state persists across a reload (Store.local seam, staging-namespaced key).
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app .panel[data-key="perf"] .chev')).toHaveAttribute('aria-expanded', 'false');

  // Workspace templates: save the current (perf-collapsed) layout under a name → it joins the select.
  page.on('dialog', d => d.accept('My Layout'));
  await page.click('#sv-app .wsbar .wssave');
  await expect(page.locator('#sv-app .wsbar select option', { hasText: 'My Layout' })).toHaveCount(1);

  // "— Default —" reverts to the default arrangement → the perf panel expands again.
  await page.selectOption('#sv-app .wsbar select', '');
  await expect(page.locator('#sv-app .panel[data-key="perf"] .chev')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#sv-app .panel[data-key="perf"] svg.equity')).toBeVisible();

  // Reloading the default layout selection → loads my saved template back (perf collapsed again).
  await page.selectOption('#sv-app .wsbar select', 'My Layout');
  await expect(page.locator('#sv-app .panel[data-key="perf"] .chev')).toHaveAttribute('aria-expanded', 'false');
});

// A42: a modal locks body scroll while open and closes on Escape, releasing the lock.
test('staging (Svelte): modal locks scroll + closes on Escape (A42)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await page.click('#sv-app [data-card="net"]');
  await expect(page.locator('.modal[aria-label="Net PnL"]')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden'); // B36 scroll-lock
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal[aria-label="Net PnL"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(''); // lock released
});

// A45: a trade can be deleted from the manage-data table (with its meta), shrinking the row count.
test('staging (Svelte): per-trade delete removes the trade (A45)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  page.on('dialog', d => d.accept()); // confirm()
  await page.click('.managebtn');
  // The trades table is paginated on staging (A73), so a delete refills the visible page — assert the
  // removal via the true total in the Manage-data summary, not the rendered row count.
  const total = page.locator('.modal .summary .dmstat').first().locator('.dv');
  await expect(total).toBeVisible();
  const before = parseInt((await total.textContent()).trim(), 10);
  await page.locator('.modal .del').first().click();
  await expect(total).toHaveText(String(before - 1));
});

// A73: the staging Manage-data trades table is paginated (50/page); search spans all trades.
test('staging (Svelte): Manage-data trades table paginates (A73)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await page.click('.managebtn');
  const rows = page.locator('.modal .tablewrap tbody tr');
  await expect(rows.first()).toBeVisible();
  await expect(rows).toHaveCount(50);
  await expect(page.locator('.modal .pginfo')).toContainText('1–50 of');
  await page.locator('.modal .pager button', { hasText: 'Next' }).click();
  await expect(page.locator('.modal .pginfo')).toContainText('51–100 of');
  await expect(rows).toHaveCount(50);
});

// A71/R12: the staging dashboard module headers have a menu popup (move/hide); hidden modules can be
// re-spawned from the "Add module" menu.
test('staging (Svelte): module-header menu hides + re-adds a module (A71/R12)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const panels = page.locator('#sv-app .dash section.panel');
  const start = await panels.count();
  expect(start).toBeGreaterThan(1);
  // Open the first module's header menu → accessible popup with the expected actions.
  await page.locator('#sv-app .dash section.panel .pmenubtn').first().click();
  const pop = page.locator('#sv-app .dash .pmenupop').first();
  await expect(pop).toBeVisible();
  await expect(pop.locator('button')).toHaveCount(4); // Collapse / Move up / Move down / Hide
  // Hide it → panel count drops and the "Add module" control appears.
  await pop.locator('button', { hasText: 'Hide module' }).click();
  await expect(panels).toHaveCount(start - 1);
  await expect(page.locator('#sv-app .addmodbtn')).toBeVisible();
  // Re-spawn it from the Add-module menu → back to the original count.
  await page.locator('#sv-app .addmodbtn').click();
  await page.locator('#sv-app .addmenu button').first().click();
  await expect(panels).toHaveCount(start);
});

// F23 (staging-only): the Trade Blotter module lists every trade in a scrollable, read-only table
// below the calendar; the Note column is inline-editable and persists via the shared trademeta path.
test('staging (Svelte): Trade Blotter lists trades + inline note persists (F23)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const blotter = page.locator('#sv-app .panel[data-key="blotter"]');
  await expect(blotter).toBeVisible();
  // F26 (staging): cal/cost/adv now sit parallel in the module grid; the blotter stays a full-width
  // row and is NOT inside the grid (it follows the grid block).
  const gridKeys = await page.locator('#sv-app .modgrid section.panel').evaluateAll(els => els.map(e => e.getAttribute('data-key')));
  expect(gridKeys).toEqual(['cal', 'cost', 'adv']);
  expect(await page.locator('#sv-app .modgrid section.panel[data-key="blotter"]').count()).toBe(0);
  // Read-only table with rows + the nine columns (F31 adds a staging-only Broker column).
  await expect(blotter.locator('.bltab tbody tr').first()).toBeVisible();
  await expect(blotter.locator('.bltab thead th')).toHaveCount(9);
  await expect(blotter.locator('.bltab thead th', { hasText: 'Broker' })).toHaveCount(1);
  // F32 (staging): the blotter paginates at 50/page by default.
  await expect(blotter.locator('.bltab tbody tr')).toHaveCount(50);
  await expect(blotter.locator('.blpager .pginfo')).toContainText('1–50 of');
  await blotter.locator('.blpsize select').selectOption('25');
  await expect(blotter.locator('.bltab tbody tr')).toHaveCount(25);
  await blotter.locator('.blpsize select').selectOption('all'); // "All" shows every row + hides the pager nav
  await expect(blotter.locator('.blnav')).toHaveCount(0);
  await blotter.locator('.blpsize select').selectOption('50'); // back to a paged view for the note test below
  // Inline note: editable, persists across a reload via Store.saveTradeMeta (trademeta).
  const note = blotter.locator('.bltab tbody tr .note').first();
  await note.fill('e2e blotter note');
  await note.blur();
  await expect(page.locator('#sv-app .terminal .log')).toContainText('trade metadata updated');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app .panel[data-key="blotter"] .bltab tbody tr .note').first()).toHaveValue('e2e blotter note');
});

// F24 (staging): the header Donate button opens the Stripe page in a separate popup window (window.open
// in a new tab (A125: target _blank) so the dashboard isn't navigated away. window.open is stubbed so
// no real external request is made.
test('staging (Svelte): header Donate button opens a new tab (F24/A125)', async ({ page }) => {
  await page.addInitScript(() => {
    window.__donate = [];
    window.open = (url, target, features) => {
      window.__donate.push({ url, target, features });
      return null;
    };
  });
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const donate = page.locator('#sv-app .donatebtn');
  await expect(donate).toBeVisible();
  await expect(donate).toHaveText('Donate'); // A125: no heart emoji
  await donate.click();
  const calls = await page.evaluate(() => window.__donate);
  expect(calls).toHaveLength(1);
  expect(calls[0].target).toBe('_blank'); // A125: new tab, not a popup window
  expect(calls[0].features).toContain('noopener');
  expect(calls[0].url).toContain('stripe');
});

// F24 staging-gated: prod/demo show no Donate button (until promoted via CH16).
test('demo (Svelte): no Donate button (F24 staging-gated)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .donatebtn')).toHaveCount(0);
});

// F25 (staging): the Overview keeps ONLY the five interactive (modal) cards; the rest fold into the
// Advanced Statistics panel.
test('staging (Svelte): Overview trimmed to 5 interactive cards; rest folded into Advanced Stats (F25)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .cards [data-card]')).toHaveCount(5);
  for (const k of ['net', 'win', 'pf', 'wl', 'dd']) {
    await expect(page.locator(`#sv-app .cards [data-card="${k}"]`)).toBeVisible();
  }
  await expect(page.locator('#sv-app .cards [data-card="trades"]')).toHaveCount(0);
  // The metrics removed from the Overview now appear in the Advanced Statistics panel (which lives in
  // the F26 grid).
  const adv = page.locator('#sv-app .panel[data-key="adv"] .advstats');
  await expect(adv).toContainText('Avg daily P&L');
  await expect(adv).toContainText('Best day');
  await expect(adv).toContainText('Sharpe (daily)');
});

// F25 staging-gated: prod/demo keep the full Overview card grid (until promoted via CH16).
test('demo (Svelte): Overview keeps the full card grid (F25 staging-gated)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .cards [data-card="trades"]')).toBeVisible();
  await expect(page.locator('#sv-app .cards [data-card="exp"]')).toBeVisible();
});

// L8 (staging): the dashboard uses the full viewport width (no 1100px centered column) so the modules
// reclaim the side margins.
test('staging (Svelte): dashboard uses full width (L8)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const w = await page.locator('#sv-app').evaluate(el => el.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(1300); // full-width on a 1600px viewport, not the ~1100px centered column
});

// F26 (staging): cal/cost/adv line up parallel in a reorderable grid; the module menu's "Move
// left"/"Move right" reorders them within the grid (the keyboard fallback for drag), and it persists.
test('staging (Svelte): grid modules reorder within the parallel grid (F26)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const gridKeys = () => page.locator('#sv-app .modgrid section.panel').evaluateAll(els => els.map(e => e.getAttribute('data-key')));
  expect(await gridKeys()).toEqual(['cal', 'cost', 'adv']);
  // Open the Calendar module's menu → "Move left" is disabled (already first); "Move right" moves it.
  await page.locator('#sv-app .modgrid section.panel[data-key="cal"] .pmenubtn').click();
  const pop = page.locator('#sv-app .modgrid section.panel[data-key="cal"] .pmenupop');
  await expect(pop.locator('button', { hasText: 'Move left' })).toBeDisabled();
  await pop.locator('button', { hasText: 'Move right' }).click();
  expect(await gridKeys()).toEqual(['cost', 'cal', 'adv']);
  // Persists across a reload (Store.local seam, staging-namespaced key).
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  expect(await gridKeys()).toEqual(['cost', 'cal', 'adv']);
});

// F26 staging-gated: prod/demo keep the modules stacked full-width (no grid) until promoted (CH16).
test('demo (Svelte): no module grid — modules stay full-width (F26 staging-gated)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .modgrid')).toHaveCount(0);
});

// F27 (staging): the Definitions & Caveats module is a page footer, not a dashboard panel, and is not
// offered in the "Add module" menu. Demo keeps it as a dashboard panel (staging-gated until CH16).
test('staging (Svelte): Definitions is a footer, not a dashboard module (F27)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .dash .panel[data-key="defs"]')).toHaveCount(0);
  await expect(page.locator('#sv-app footer.deffoot')).toContainText('US dates & Eastern time assumed');
});
test('demo (Svelte): Definitions stays a dashboard panel (F27 staging-gated)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .dash .panel[data-key="defs"]')).toBeVisible();
  await expect(page.locator('#sv-app footer.deffoot')).toHaveCount(0);
});

// A124: the Activity Terminal logs the boot/status events (it subscribes after boot, so App re-emits
// them post-mount) — not just the single "staging app ready" line.
test('staging (Svelte): Activity Terminal shows boot status events (A124)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  const log = page.locator('#sv-app .terminal .log');
  await expect(log).toContainText('staging app ready');
  await expect(log).toContainText('reference data loaded');
  await expect(log).toContainText(/loaded \d+ trades/);
});

// A126 + F28: the performance graph shows NO red drawdown band by default; enabling Net + Take-home
// adds a gradient area fill per series (gross/net/take), each layered with its line.
test('staging (Svelte): graph has no stray red band; net/take get gradient fills (A126/F28)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const perf = page.locator('#sv-app .panel[data-key="perf"]');
  // A126: no drawdown band element at all (removed).
  await expect(perf.locator('svg.equity rect.ddband')).toHaveCount(0);
  // Default = gross only → one fill + one line.
  await expect(perf.locator('svg.equity path.areafill')).toHaveCount(1);
  await expect(perf.locator('svg.equity path.line')).toHaveCount(1);
  // F28: enabling all three overlays → three gradient fills + three lines.
  await perf.locator('.overlays button', { hasText: 'Net' }).click();
  await perf.locator('.overlays button', { hasText: 'Take-home' }).click();
  await expect(perf.locator('svg.equity path.areafill')).toHaveCount(3);
  await expect(perf.locator('svg.equity path.line')).toHaveCount(3);
});

// A121 (staging): a calendar day deselects when its cell is re-clicked, or when the user clicks off
// the calendar module; navigating months does NOT collapse the panel.
test('staging (Svelte): calendar day deselects on reclick / click-off; month nav keeps panel open (A121)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const cal = page.locator('#sv-app .panel[data-key="cal"]');
  const day = cal.locator('.calgrid .cell.traded').first();
  await day.click();
  await expect(cal.locator('.cell.selected')).toHaveCount(1);
  await day.click(); // reclick → deselect
  await expect(cal.locator('.cell.selected')).toHaveCount(0);
  // reselect, then click off the calendar (the filter bar) → deselect
  await day.click();
  await expect(page.locator('#sv-app .cell.selected')).toHaveCount(1);
  await page.locator('#sv-app .filterbar .count').click();
  await expect(page.locator('#sv-app .cell.selected')).toHaveCount(0);
  // month nav must not collapse the calendar panel (its chevron stays expanded + reachable)
  await cal.locator('.nav button[aria-label="Previous month"]').click();
  await expect(cal.locator('.chev')).toHaveAttribute('aria-expanded', 'true');
});

// L9 (staging): the five interactive cards span the full row (no large right-margin gap) on a wide
// viewport.
test('staging (Svelte): the five headline cards span the full width (L9)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const gap = await page.evaluate(() => {
    const cards = document.querySelector('#sv-app .cards');
    const last = cards.querySelector('[data-card="dd"]');
    return Math.round(cards.getBoundingClientRect().right - last.getBoundingClientRect().right);
  });
  expect(gap).toBeLessThanOrEqual(2); // last card reaches the row's right edge
});

// L10 (staging): the three grid modules stretch to a common height (bottoms aligned).
test('staging (Svelte): grid modules share an equal height (L10)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  const heights = await page
    .locator('#sv-app .modgrid > .panel')
    .evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
  expect(heights).toHaveLength(3);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1); // equal height
});

// F23 promoted to all surfaces (CH16): the Trade Blotter now appears on demo too, directly below the
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

// F33 (staging): the Blotterbook wordmark links to the homepage; prod/demo keep it as plain text.
test('staging (Svelte): the Blotterbook logo links home (F33)', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await expect(page.locator('#sv-app .brand a.brandlink')).toHaveAttribute('href', '/');
});
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
  await expect(page.locator('#sv-app .dash .pmenupop button')).toHaveCount(4);
});

// A73 promoted to all surfaces (CH16): demo now also paginates the trades table.
test('demo (Svelte): Manage-data trades table paginates (A73, promoted)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  await page.click('.managebtn');
  await expect(page.locator('.modal .tablewrap tbody tr')).toHaveCount(50);
  await expect(page.locator('.modal .pginfo')).toContainText('1–50 of');
});

// A51: on a phone viewport the dashboard must not scroll the PAGE horizontally (body overflow-x:
// hidden + the calendar scrolls within its own panel, not the page).
test('staging (Svelte): no horizontal page scroll on mobile (A51)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#sv-app [data-card="net"] .value')).toContainText('$', { timeout: 5000 });
  // Select a day so the calendar + day-trades + journal are all present (the widest content).
  await page.locator('#sv-app .calendar .calgrid .cell.traded').first().click();
  // body overflow-x:hidden means the page cannot scroll horizontally even if content is wider.
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowX)).toBe('hidden');
  await page.evaluate(() => window.scrollTo(9999, 0));
  expect(await page.evaluate(() => Math.round(window.scrollX))).toBe(0);
  // The wide calendar scrolls within its own panel rather than the page.
  const calScrolls = await page.evaluate(() => {
    const el = document.querySelector('#sv-app .calendar');
    return !!el && getComputedStyle(el).overflowX === 'auto';
  });
  expect(calScrolls).toBe(true);
});

// B41: toggle/collapse controls must expose ARIA state (aria-pressed / aria-expanded). Now on the
// Svelte surface (demo) after the A33 cutover.
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
