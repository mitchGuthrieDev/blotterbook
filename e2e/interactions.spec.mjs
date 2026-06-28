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
  const monthText = await page.locator('#sv-app [data-card="trades"] .value').textContent();
  expect(Number((monthText || '').trim())).toBeLessThan(seededCount);

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

  // Definitions & Caveats panel (A37) renders its glossary.
  await expect(page.locator('#sv-app .defs')).toContainText('Win / Loss / Scratch');

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
  const afterText = await page.locator('#sv-app [data-card="trades"] .value').textContent();
  expect(Number((afterText || '').trim())).toBe(seededCount);

  expect(errors, errors.join('\n')).toHaveLength(0);
});

// A32: the staging filter bar's session (RTH/ETH) filter narrows the active dataset.
test('staging (Svelte): session filter narrows the dataset', async ({ page }) => {
  await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
  const trades = page.locator('#sv-app [data-card="trades"] .value');
  const all = Number(((await trades.textContent()) || '').trim());
  expect(all).toBeGreaterThan(0);
  await page.getByLabel('Session').selectOption('rth');
  await expect(trades).not.toHaveText(String(all)); // RTH-only is a strict subset
  expect(Number(((await trades.textContent()) || '').trim())).toBeLessThan(all);

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
  const rows = page.locator('.modal table tbody tr');
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  await page.locator('.modal .del').first().click();
  await expect(rows).toHaveCount(before - 1);
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
