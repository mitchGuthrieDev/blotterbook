import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { ssg } from './scripts/vite-ssg.mjs';

// Blotterbook build (ADR-001 / A26; source tree reorg A30; site→Svelte A69). Multi-page build — the
// marketing/info site is prerendered to static HTML at build time (A69, see vite-ssg.mjs); the /app/
// surface is the Svelte SPA.
//
// A69: each marketing/info page is a Svelte component server-rendered into its committed HTML
// template's `<!--ssg-outlet-->` (SEO + first paint preserved) and then hydrated in place — NOT
// pulled behind the app SPA shell. `url` is the page's path under the Vite root; the app surfaces
// (app/demo/staging.html) are intentionally absent (they're the SPA mounts).
const SSG_PAGES = [
  { url: 'index.html', component: 'src/site/components/Home.svelte' },
  { url: 'howto.html', component: 'src/site/components/Howto.svelte' },
  { url: 'roadmap.html', component: 'src/site/components/Roadmap.svelte' },
  { url: 'changelog.html', component: 'src/site/components/Changelog.svelte' },
  { url: 'legal.html', component: 'src/site/components/Legal.svelte' },
  { url: 'account.html', component: 'src/site/components/AccountDash.svelte' }, // A293 — noindex; session hydrates client-side
  { url: 'admin.html', component: 'src/site/components/Admin.svelte' },
];
//
// A30: the Vite root is now `src/` (the bundled/served tree); verbatim-static files live in
// `static/` (Vite's publicDir, copied to dist/ root — this retires scripts/copy-static.mjs). The
// build output is the repo-root `dist/` (outside root, so emptyOutDir is explicit). URLs are
// preserved 1:1: each HTML entry's path RELATIVE TO `src/` is mirrored into dist/ (src/index.html
// -> /, src/app/app.html -> /app/app.html, …), and `static/` is copied verbatim (static/data ->
// /data, static/_headers -> /_headers, static/assets/og-image.png -> /assets/og-image.png).
// Absolute https canonicals/og:image and runtime fetch() URLs (/data/*, /api/*) are string
// literals Vite does not touch, so they keep resolving unchanged.
const r = p => resolve(import.meta.dirname, p);

export default defineConfig({
  root: 'src',
  // Verbatim-static assets (data/*.json, _headers, _redirects, robots.txt, sitemap.xml,
  // assets/og-image.png) live in static/ and are copied to dist/ root by Vite (A30).
  publicDir: r('static'),
  // $lib → the shared lib (pure-logic core + the shadcn-svelte design system). Tailwind v4 scans
  // all source surfaces and emits the utility stylesheet (CSP-safe — a linked sheet).
  resolve: { alias: { $lib: r('src/lib') } },
  plugins: [tailwindcss(), svelte(), ssg(SSG_PAGES)],
  build: {
    // Pin the output baseline to match tsconfig's `target: ES2022` (A96) for deterministic,
    // reproducible bundles. Modern-browser audience (local-compute desktop tool) — deliberately
    // NO @vitejs/plugin-legacy (its polyfills/transitive deps would violate A28).
    target: 'es2022',
    outDir: r('dist'),
    emptyOutDir: true, // outDir is outside root (repo-root dist/), so opt in explicitly
    rollupOptions: {
      input: {
        index: r('src/index.html'),
        howto: r('src/howto.html'),
        roadmap: r('src/roadmap.html'),
        changelog: r('src/changelog.html'),
        legal: r('src/legal.html'),
        account: r('src/account.html'), // A293 — the standalone Account Dashboard page
        admin: r('src/admin.html'),
        app: r('src/app/app.html'),
        demo: r('src/app/demo.html'),
        staging: r('src/app/staging.html'),
        // Dev-only surface (UI mockup workflow): the live component + token reference (styleguide).
        // Built + deployed but noindex + robots-blocked and never linked from the product. (The
        // redesign preview harness /dev/app.html was retired post-CH16 — the real app IS the redesign.)
        devcomponents: r('src/dev/components.html'),
      },
    },
  },
});
