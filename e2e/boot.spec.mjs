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
