import { test, expect } from '@playwright/test';
import { watchErrors } from './helpers.mjs';

// Every surface must boot with ZERO console/page errors — the core guarantee the A20 ESM
// migration is verified against (a missing import / dead reference surfaces here).
const surfaces = [
  {
    // A33 cutover: app is the Svelte app (data-mode="app"). Empty real Store → the landing/CSV flow.
    name: 'app',
    path: '/app/app.html',
    check: async page => {
      await expect(page.locator('#sv-app .landing')).toBeVisible();
    },
  },
  {
    // A33 cutover: demo is the Svelte app (data-mode="demo", in-memory DemoStore) — boots straight
    // into the seeded Overview.
    name: 'demo',
    path: '/app/demo.html',
    check: async page => {
      await expect(page.locator('#sv-app [data-card="net"] .value')).not.toBeEmpty();
    },
  },
  {
    // UI-redesign Phase-3 cutover: staging is the NEW sidebar-shell SPA (StagingApp) on its isolated,
    // seeded DB — boots straight into the redesigned Dashboard. (app/demo keep App.svelte above.)
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
