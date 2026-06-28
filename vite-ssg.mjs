// Blotterbook static-site generation (A69). Plain Vite has no server-side prerender, so this
// small build-only plugin server-renders each marketing/info page's Svelte component to static
// HTML at build time and injects it into that page's committed HTML template. The result:
//
//   • SEO + first paint are preserved — the shipped HTML already contains the fully-rendered page,
//     not an empty SPA shell that only fills in after hydration.
//   • Vite still owns the page: the template keeps its <head> meta/canonical/OG + the tokens <link>
//     and the client-entry <script>, so Vite fingerprints the CSS/JS and the component's scoped CSS
//     is emitted + linked exactly as for any MPA entry. URLs stay 1:1 (the template stays put).
//   • The marketing pages are NOT pulled behind the app SPA shell (ADR-001 constraint) — each is its
//     own prerendered MPA entry that then hydrates in place for interactivity. No SvelteKit (A62).
//
// How: each registered page template carries an `<!--ssg-outlet-->` placeholder inside its mount
// container (and optionally `<!--ssg-head-->` in <head>). All pages are server-rendered ONCE in
// buildStart() through a short-lived child Vite SSR server (which reuses svelte.config.js so
// `<script lang="ts">` compiles; configFile:false keeps it from re-loading this plugin → no
// recursion). The server is created and torn down entirely within buildStart — rendering all pages
// up front, then closing it — so there is exactly one server (no per-entry race / HMR-port collision)
// and no long-lived handle keeps the `vite build` process alive. transformIndexHtml (order:'pre', so
// the injected markup still flows through Vite's asset pipeline — <img>/<link> refs get
// fingerprinted/inlined) is then a pure cache lookup that substitutes the placeholders.
//
// Minimal, pinned, dev-only (A28): no new dependency — vite + @sveltejs/vite-plugin-svelte + svelte
// are already in the toolchain; svelte/server's render() is loaded through the child server itself so
// it shares the components' compiled-internals instance.
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import svelteConfig from './svelte.config.js';

const OUTLET = '<!--ssg-outlet-->';
const HEAD = '<!--ssg-head-->';

/**
 * @param {{url: string, component: string}[]} pages  url = the page's path under the Vite root
 *   (e.g. 'legal.html'); component = repo-root-relative path to its .svelte page component.
 */
export function ssg(pages) {
  const projectRoot = import.meta.dirname;
  const rendered = new Map(); // url -> { head, body }

  return {
    name: 'blotterbook-ssg',
    apply: 'build',
    async buildStart() {
      const server = await createServer({
        configFile: false, // don't re-load vite.config (which registers this plugin) → no recursion
        root: projectRoot, // so svelte.config.js + bare imports resolve like the main build
        appType: 'custom',
        logLevel: 'warn',
        // We only need ssrLoadModule(): suppress the HMR WebSocket and the chokidar file watcher
        // (both long-lived handles) — and we close the server here in buildStart regardless.
        server: { middlewareMode: true, hmr: false, watch: null },
        optimizeDeps: { noDiscovery: true },
        plugins: [svelte(svelteConfig)],
      });
      try {
        const { render } = await server.ssrLoadModule('svelte/server');
        for (const page of pages) {
          const mod = await server.ssrLoadModule(resolve(projectRoot, page.component));
          const { head, body } = render(mod.default, { props: {} });
          rendered.set(page.url, { head: head || '', body: body || '' });
        }
      } finally {
        await server.close();
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // Only act on a registered template that carries the outlet — app SPA shells and any
        // not-yet-converted page are left untouched (supports incremental migration).
        if (!html.includes(OUTLET)) return html;
        const page = pages.find(p => ctx.path === '/' + p.url || ctx.path.endsWith('/' + p.url));
        if (!page) return html;
        const r = rendered.get(page.url);
        if (!r) return html;
        return html.replace(HEAD, r.head).replace(OUTLET, r.body);
      },
    },
  };
}
