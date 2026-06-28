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
    // Staging is the same Svelte 5 app on its isolated DB — boots straight into the Overview.
    name: 'staging',
    path: '/app/staging.html',
    check: async page => {
      await expect(page.locator('#sv-app [data-card="net"] .value')).not.toBeEmpty();
    },
  },
  { name: 'home', path: '/index.html', check: async () => {} },
  {
    name: 'changelog',
    path: '/changelog.html',
    check: async page => {
      await expect(page.locator('#log .entry').first()).toBeVisible();
    },
  },
  { name: 'admin', path: '/admin.html', check: async () => {} },
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
