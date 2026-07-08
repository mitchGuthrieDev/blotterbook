import { test, expect } from '@playwright/test';

// A69 SSG guarantee: the marketing/info pages must ship as fully server-rendered HTML — their key
// content present in the RAW response, BEFORE any JS runs — so SEO + first paint don't depend on
// hydration. We assert against the raw fetched HTML (request fixture, no script execution), which is
// exactly what a crawler / a no-JS first paint sees. This is the regression guard that the prerender
// step (vite-ssg.mjs) actually ran and injected each component's output into its template.
const PAGES = [
  {
    path: '/index.html',
    must: [
      'Everything in one private dashboard',
      'Bring trades from the platform you already use',
      'Free for everyone. Support if it helps.',
    ],
  },
  { path: '/help/index.html', must: ['How can we help?', 'Getting started', 'Importing your trades', 'Cloud sync'] },
  { path: '/help/getting-started.html', must: ['Getting started', 'First run', 'Broker &amp; costs', 'Reading the dashboard'] },
  { path: '/help/import.html', must: ['Importing your trades', 'What is futures trading?', 'Tradovate', 'Interactive Brokers'] },
  { path: '/help/cloud-sync.html', must: ['Cloud sync', 'recovery key', 'zero-knowledge'] },
  { path: '/help/support.html', must: ['Support', 'contact@blotterbook.com', 'never email us a CSV'] },
  { path: '/roadmap.html', must: ['Available now', 'In progress', 'Numbers you can trust to the cent'] },
  // Changelog server-renders the inline fallback (the live notes load via fetch on hydration).
  // F44: the changelog-email signup section is server-rendered (present before hydration).
  { path: '/changelog.html', must: ['Changelog', 'Beta released', 'class="entry', 'Get release notes by email', 'id="subscribe"'] },
  { path: '/legal.html', must: ['Legal &amp; Disclaimers', 'Not a broker. Not advice.', 'Terms of Service'] },
  // A293: the Account Dashboard prerenders its static frame + the loading skeleton (the session is
  // client-only, so account content hydrates from /api/me after load — never in the raw HTML).
  { path: '/account.html', must: ['Your Account', 'Loading account', 'name="robots" content="noindex'] },
  { path: '/admin.html', must: ['Configuration', 'Feature flags', 'Backlog'] },
];

for (const p of PAGES) {
  test(`${p.path} is server-rendered (content present before hydration)`, async ({ request }) => {
    const res = await request.get(p.path);
    expect(res.ok(), `${p.path} should return 200`).toBeTruthy();
    const html = await res.text();
    // Shared chrome is prerendered too (the wordmark from Nav/Home).
    expect(html, `${p.path} should contain the prerendered wordmark`).toContain('Blotterbook');
    for (const s of p.must) expect(html, `${p.path} raw HTML should contain: ${s}`).toContain(s);
  });
}

// A293: the Account page hydrates to the logged-out view (no session on the static test server —
// the /api/me probe fails, which resolves to "no user"), and the site header's CTA routes here.
test('/account.html hydrates to the logged-out view + the header CTA points at it', async ({ page }) => {
  await page.goto('/account.html', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Log in with a passkey' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account with a passkey' })).toBeVisible();
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: /^Account/ }).first()).toHaveAttribute('href', '/account.html');
});
