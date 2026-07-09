import { test, expect } from '@playwright/test';

// A69 SSG guarantee: the marketing/info pages must ship as fully server-rendered HTML — their key
// content present in the RAW response, BEFORE any JS runs — so SEO + first paint don't depend on
// hydration. We assert against the raw fetched HTML (request fixture, no script execution), which is
// exactly what a crawler / a no-JS first paint sees. This is the regression guard that the prerender
// step (vite-ssg.mjs) actually ran and injected each component's output into its template.
//
// ARCHIVE FREEZE (2026-07-08, docs/archive-freeze.md): /account.html now SSRs ONLY an archived-notice
// card while archived (no login/signup UI), and the homepage header hides its Account link. Both are
// covered below, mirrored behind a local ARCHIVED constant (see the two spots it's used) so a thaw
// is a one-constant flip.
const ARCHIVED = true; // mirror of src/lib/archive.ts — flip on thaw (docs/archive-freeze.md)
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
  // ARCHIVE FREEZE (2026-07-08): while archived, /account.html SSRs ONLY the archived-notice card
  // (data-testid="archived-note", linking to /app/app.html + /help/support.html) — no login/signup
  // form. See the `must` list below, which is picked per ARCHIVED.
  {
    path: '/account.html',
    must: ARCHIVED
      ? ['Your Account', 'archived-note', '/app/app.html', '/help/support.html', 'name="robots" content="noindex']
      : ['Your Account', 'Loading account', 'name="robots" content="noindex'],
  },
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
// ARCHIVE FREEZE: preserved verbatim inside `if (!ARCHIVED)` (login/signup UI is unreachable while
// archived — /account.html renders only the archived notice, and the header link is hidden).
if (!ARCHIVED) {
  test('/account.html hydrates to the logged-out view + the header CTA points at it', async ({ page }) => {
    await page.goto('/account.html', { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Log in with a passkey' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account with a passkey' })).toBeVisible();
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await expect(page.getByRole('link', { name: /^Account/ }).first()).toHaveAttribute('href', '/account.html');
  });
} // if (!ARCHIVED)

if (ARCHIVED) {
  test('ARCHIVE FREEZE: /account.html hydrates to the archived notice, and the homepage header hides the Account link', async ({
    page,
  }) => {
    await page.goto('/account.html', { waitUntil: 'networkidle' });
    const note = page.getByTestId('archived-note');
    await expect(note).toBeVisible();
    // Scope to the note — the shared site header/footer also carries app/support links.
    await expect(note.locator('a[href="/app/app.html"]')).toBeVisible();
    await expect(note.locator('a[href="/help/support.html"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in with a passkey' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create account with a passkey' })).toHaveCount(0);

    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await expect(page.getByRole('link', { name: /^Account/ })).toHaveCount(0);
  });
} // if (ARCHIVED)
