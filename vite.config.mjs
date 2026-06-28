import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

// Blotterbook build (ADR-001 / A26). Multi-page build — the marketing site stays
// statically rendered; only the /app/ surface will later become a Svelte app (A27).
//
// URLs are preserved 1:1 with the old no-build layout: every HTML entry keeps its
// path (index.html at root, app/*.html under /app/), and Vite fingerprints the JS/CSS
// it bundles while rewriting the references in the HTML. Absolute https canonicals/
// og:image tags and runtime fetch() URLs (/data/*, /api/*) are string literals Vite
// does not touch, so they keep resolving unchanged.
//
// publicDir is disabled: the verbatim-static files (_headers, _redirects, robots.txt,
// sitemap.xml, data/*.json, assets/og-image.png) are scattered across the source tree
// rather than in one folder, so scripts/copy-static.mjs copies them into dist/ after
// the build (run via `npm run build`). See docs/adr-001-vite-svelte-spa.md.
const r = p => resolve(import.meta.dirname, p);

export default defineConfig({
  // Svelte (ADR-001): post-A33, all three app surfaces (app/app.html, app/demo.html,
  // app/staging.html) mount the Svelte app in app/staging-svelte/; the marketing/info pages carry
  // no .svelte imports, so the plugin is a no-op for them. Svelte 5, runes-first.
  plugins: [svelte()],
  // Verbatim-static assets are copied by scripts/copy-static.mjs, not Vite's publicDir
  // (the source files don't live in a single directory). Keeps data/ etc. unmoved so the
  // build-manifest / bump-version path assumptions and the README image refs stay valid.
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // No minify size win to chase yet, but keep it on — it's the point of the build.
    rollupOptions: {
      input: {
        index: r('index.html'),
        howto: r('howto.html'),
        roadmap: r('roadmap.html'),
        changelog: r('changelog.html'),
        legal: r('legal.html'),
        admin: r('admin.html'),
        app: r('app/app.html'),
        demo: r('app/demo.html'),
        staging: r('app/staging.html'),
      },
    },
  },
});
