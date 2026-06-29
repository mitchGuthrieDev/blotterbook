// Playwright render/E2E config — DEV-ONLY (R19 Tier A). Closes the repo's render-test gap:
// every app surface + info page must boot with zero console/page errors, and the key
// interactions must run clean. Since ADR-001/A26 the deploy artifact is the Vite build
// output (dist/), so the webServer builds the site then serves dist/ over http — testing
// exactly what Cloudflare Pages serves (the app fetch()es /data/*.json, so file:// won't work).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8000',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  // Serve the Vite output dir (dist/) so URLs + bundled assets match production exactly
  // (Cloudflare Pages serves dist/). _redirects/_headers aren't applied by python's server, but the
  // specs hit page paths directly (e.g. /app/app.html), not the /app/ rewrite, so that doesn't
  // matter here. CI builds once in its own `npm run build` step (which also feeds the size budget),
  // so here we only serve the already-built dist/ — no double build (A96). Locally there's no prior
  // build step, so we build first for a single-command `npm run test:e2e`.
  webServer: {
    command: process.env.CI
      ? 'python3 -m http.server 8000 --directory dist'
      : 'npm run build && python3 -m http.server 8000 --directory dist',
    url: 'http://localhost:8000/app/app.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
