import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// ARCHIVE FREEZE (2026-07-08, docs/archive-freeze.md): the F56 login-gate (`launch-gate`) never
// arms while archived (`gateArmed = !isDemo && !ARCHIVED && accountGateEnabled()` in App.svelte), so
// every `bb:flags` ACCOUNT_GATE:false override below is now a no-op belt-and-suspenders bypass, not
// a load-bearing one — kept so the surfaces below thaw unmodified. See the dedicated archive-freeze
// assertion near the bottom of this file.
const ARCHIVED = true; // mirror of src/lib/archive.ts — flip on thaw (docs/archive-freeze.md)

// Every surface must boot with ZERO console/page errors — the core guarantee the A20 ESM
// migration is verified against (a missing import / dead reference surfaces here).
const surfaces = [
  {
    // CH16 cutover: ALL app surfaces render the ONE redesigned sidebar-shell SPA. app (data-mode="app")
    // is the real IndexedDB Store with NO seed → an EMPTY store shows the first-run onboarding view
    // ("Welcome to Blotterbook" + cost setup + CSV importer). We clear the DB + reload so the assertion
    // never depends on residual data from a prior test.
    name: 'app',
    path: '/app/app.html',
    // F56/CH16: the login gate is now armed on prod too — bypass it via the bb:flags override so this
    // boot-health check reaches the first-run onboarding (the gate has its own specs).
    init: async page => {
      await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
    },
    check: async page => {
      await page.evaluate(() => indexedDB.deleteDatabase('blotterbook'));
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Welcome to Blotterbook' })).toBeVisible({ timeout: 6000 });
    },
  },
  {
    // CH16 cutover: demo (data-mode="demo", in-memory DemoStore) is the SAME redesigned app, seeded —
    // boots straight into the sidebar-shell Dashboard with real computed metrics.
    name: 'demo',
    path: '/app/demo.html',
    check: async page => {
      await expect(page.locator('nav[aria-label="Primary"]')).toContainText('Dashboard');
      await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
    },
  },
  {
    // CH16 cutover: staging is the same redesigned app on its isolated, seeded blotterbookStaging DB —
    // boots straight into the redesigned Dashboard.
    name: 'staging',
    path: '/app/staging.html',
    // F56: the login gate is armed by default on staging (ACCOUNT_GATE = true) — bypass it via the
    // bb:flags override so this boot-health check reaches the dashboard (the gate has its own specs).
    init: async page => {
      await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
    },
    check: async page => {
      await expect(page.locator('nav[aria-label="Primary"]')).toContainText('Dashboard');
      await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
    },
  },
  // A69: the marketing/info site is the Svelte SSG (prerendered HTML that hydrates in place).
  {
    name: 'home',
    path: '/index.html',
    check: async page => {
      await expect(page.locator('h2.h2').first()).toContainText('Everything in one private dashboard');
    },
  },
  {
    // A273: the How-To wiki moved into the Help site.
    name: 'help',
    path: '/help/index.html',
    check: async page => {
      await expect(page.locator('h1')).toContainText('How can we help?');
    },
  },
  {
    name: 'roadmap',
    path: '/roadmap.html',
    check: async page => {
      await expect(page.locator('h1')).toContainText('Roadmap');
    },
  },
  {
    name: 'legal',
    path: '/legal.html',
    check: async page => {
      await expect(page.locator('h1')).toContainText('Legal');
    },
  },
  {
    name: 'changelog',
    path: '/changelog.html',
    check: async page => {
      await expect(page.locator('#log .entry').first()).toBeVisible();
    },
  },
  {
    name: 'admin',
    path: '/admin.html',
    check: async page => {
      await expect(page.locator('h1')).toContainText('Configuration');
    },
  },
];

for (const s of surfaces) {
  test(`${s.name} boots with no console/page errors`, async ({ page }) => {
    const errors = watchErrors(page);
    if (s.init) await s.init(page);
    await page.goto(s.path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await s.check(page);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
}

// A147: the onboarding "Choose a CSV file" CTA must actually open the file picker and import.
// (It used to be a <button> nested inside the <label> wrapping the file input — the HTML spec
// suppresses label activation for clicks on interactive descendants, so the CTA was dead and
// only drag-and-drop worked. This clicks the real button and drives a file through the picker.)
test('app: onboarding CSV CTA opens the picker and imports', async ({ page }) => {
  const errors = watchErrors(page);
  // F56/CH16: bypass the now-prod-armed login gate so onboarding renders (gate has its own specs).
  await page.addInitScript(() => localStorage.setItem('bb:flags', JSON.stringify({ ACCOUNT_GATE: false })));
  await page.goto('/app/app.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => indexedDB.deleteDatabase('blotterbook'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Welcome to Blotterbook' })).toBeVisible({ timeout: 6000 });

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 3000 }),
    page.getByRole('button', { name: 'Choose CSV files' }).click(),
  ]);
  // F47: a BATCH — the trade file imports, the Cash History file is recognized-non-trade (named,
  // not the generic refusal).
  await chooser.setFiles([
    {
      name: 'trades.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Time,Action,Realized PnL (value)\n' +
          '2026-06-02 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",50.00\n' +
          '2026-06-02 11:30:00,"Close short position for symbol MNQM2025 at price 18000.00",-20.00\n'
      ),
    },
    {
      name: 'cash.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Account,Transaction ID,Timestamp,Date,Delta,Amount,Cash Change Type,Currency,Contract\n' +
          'DEMO,1,06/16/2026 08:25:38,2026-06-16,"50,000.00","50,000.00", Fund Transaction,USD,\n'
      ),
    },
  ]);

  // F48: the import lands in the review list — the app does NOT auto-launch; the explicit
  // Launch button (enabled by the import) enters the dashboard.
  await expect(page.getByText('trades.csv')).toBeVisible({ timeout: 6000 });
  await expect(page.getByText(/TradingView · 2 trades/)).toBeVisible();
  // F47: the non-trade file is NAMED instead of refused generically.
  await expect(page.getByText('cash.csv')).toBeVisible();
  await expect(page.getByText(/Cash History · recognized, not a trade file/)).toBeVisible();
  const launch = page.getByRole('button', { name: /Launch Blotterbook/ });
  await expect(launch).toBeEnabled();
  await launch.click();
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });

  // A235: excluding the ONLY file must NOT bounce back to onboarding — the shell stays, with the
  // all-excluded banner and a path back; only Erase all data returns to the initial state.
  await page.locator('nav[aria-label="Primary"]').getByRole('button', { name: 'CSV Library', exact: true }).click();
  await page.getByRole('switch', { name: 'Include in dataset' }).click();
  await expect(page.getByText(/All imported files are excluded/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to Blotterbook' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Include in dataset' }).click(); // re-include
  await expect(page.getByText(/All imported files are excluded/)).toHaveCount(0);

  await page.evaluate(() => indexedDB.deleteDatabase('blotterbook')); // leave the surface clean
  expect(errors, errors.join('\n')).toHaveLength(0);
});

// ── A207/F41: static boot skeleton + preload hints ─────────────────────────────────────────────
// The skeleton/preload markup is hand-authored directly into the three shells (no drift gate covers
// them — they're marker-free mount points), so assert against the SERVED bytes rather than racing the
// live DOM (the real app can mount before a test even gets a chance to look).

for (const path of ['/app/app.html', '/app/demo.html', '/app/staging.html']) {
  test(`${path}: served HTML carries the static boot skeleton + preload hints, no style="" (F41)`, async ({ page }) => {
    const html = await (await page.request.get(path)).text();
    expect(html).toContain('data-testid="boot-skeleton"');
    expect(html).toContain('<meta name="color-scheme" content="dark" />');
    expect(html).toMatch(/<link rel="preload" as="font" type="font\/woff2" crossorigin href="[^"]+\.woff2" \/>/);
    expect(html).toContain('<link rel="preload" as="fetch" crossorigin href="/data/versions.json" />');
    expect(html).toContain('<link rel="preload" as="fetch" crossorigin href="/api/config" />');
    // CSP (style-src 'self', no 'unsafe-inline'): never a literal style="" attribute.
    expect(html).not.toMatch(/\sstyle="/);
  });
}

test('demo: the static boot skeleton is cleared once the real app mounts (F41)', async ({ page }) => {
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });
  // main.ts's target.replaceChildren() removed the static skeleton before mount() appended the app.
  await expect(page.getByTestId('boot-skeleton')).toHaveCount(0);
});

// ── A239: status pill — clickable popover + dot-only on mobile ─────────────────────────────────
// /api/status isn't served by the plain python static server e2e boots against, so the pill is
// mocked here to exercise the popover deterministically (it otherwise renders null on a fetch miss —
// intentional per A234, "convenience only").

test('demo: status pill opens a popover explaining the current status (A239)', async ({ page }) => {
  await page.route('**/api/status', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'maintenance', label: 'Partial outage' }) })
  );
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });

  const pill = page.getByTestId('status-pill');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('aria-label', 'Status: Partial outage');
  await expect(page.getByTestId('status-pill-label')).toBeVisible(); // sm+ viewport: label shown too

  await pill.click();
  const pop = page.locator('[data-slot="popover-content"]');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Partial outage');
  await expect(pop).toContainText(/degraded/i);
  await expect(pop.getByRole('link', { name: 'Status detail' })).toHaveAttribute('href', '/api/status');
});

test('demo (360px): status pill is dot-only on mobile, but still opens the popover on tap (A239)', async ({ page }) => {
  await page.route('**/api/status', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'live', label: 'Online' }) })
  );
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/app/demo.html', { waitUntil: 'networkidle' });
  await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 6000 });

  const pill = page.getByTestId('status-pill');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('aria-label', 'Status: Online'); // a11y name survives the hidden label
  await expect(page.getByTestId('status-pill-label')).toBeHidden(); // dot-only below sm

  await pill.click(); // popover works on tap even though the label is visually hidden
  const pop = page.locator('[data-slot="popover-content"]');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Online');
  await expect(pop).toContainText('All systems normal.');
});

// ── ARCHIVE FREEZE (2026-07-08, docs/archive-freeze.md) ─────────────────────────────────────────
if (ARCHIVED) {
  test('ARCHIVE FREEZE: app + staging boot straight to their content, with NO bb:flags override and no launch-gate', async ({ page }) => {
    // Deliberately NOT setting the ACCOUNT_GATE bb:flags override — pre-freeze this would have armed
    // the gate on staging (and prod, post-F56/CH16). Direct local access must hold regardless.
    await page.goto('/app/staging.html', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('launch-gate')).toHaveCount(0);
    await expect(page.getByText('Net P&L', { exact: true })).toBeVisible({ timeout: 8000 });

    await page.evaluate(() => indexedDB.deleteDatabase('blotterbook'));
    await page.goto('/app/app.html', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('launch-gate')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Welcome to Blotterbook' })).toBeVisible({ timeout: 8000 });
    await page.evaluate(() => indexedDB.deleteDatabase('blotterbook')); // leave the surface clean
  });
}
