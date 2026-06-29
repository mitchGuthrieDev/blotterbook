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
  { path: '/howto.html', must: ['How to use Blotterbook', 'What is futures trading?', 'Importing by platform', 'Tradovate'] },
  { path: '/roadmap.html', must: ['Available now', 'In progress', 'Numbers you can trust to the cent'] },
  // Changelog server-renders the inline fallback (the live notes load via fetch on hydration).
  { path: '/changelog.html', must: ['Changelog', 'Beta released', 'class="entry'] },
  { path: '/legal.html', must: ['Legal &amp; Disclaimers', 'Not a broker. Not advice.', 'Terms of Use'] },
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
