import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

// Blotterbook build (ADR-001 / A26; source tree reorg A30). Multi-page build — the marketing
// site stays statically rendered; the /app/ surface is the Svelte SPA.
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
  plugins: [svelte()],
  build: {
    outDir: r('dist'),
    emptyOutDir: true, // outDir is outside root (repo-root dist/), so opt in explicitly
    rollupOptions: {
      input: {
        index: r('src/index.html'),
        howto: r('src/howto.html'),
        roadmap: r('src/roadmap.html'),
        changelog: r('src/changelog.html'),
        legal: r('src/legal.html'),
        admin: r('src/admin.html'),
        app: r('src/app/app.html'),
        demo: r('src/app/demo.html'),
        staging: r('src/app/staging.html'),
      },
    },
  },
});
