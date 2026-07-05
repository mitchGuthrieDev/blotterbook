import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

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
    name: 'howto',
    path: '/howto.html',
    check: async page => {
      await expect(page.locator('h1')).toContainText('How to use Blotterbook');
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
