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
// container (and optionally `<!--ssg-head-->` in <head>). During `vite build`, transformIndexHtml
// (order:'pre', so the injected markup still flows through Vite's asset pipeline — e.g. <img>/<link>
// refs get fingerprinted/inlined) renders the page component via a short-lived child Vite SSR server
// and substitutes the placeholders. The child server reuses svelte.config.js (vitePreprocess) so
// `<script lang="ts">` compiles; configFile:false keeps it from re-loading this plugin (no recursion).
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
  let server = null;

  async function getServer() {
    if (!server) {
      server = await createServer({
        configFile: false, // don't re-load vite.config (which registers this plugin) → no recursion
        root: projectRoot, // so svelte.config.js + bare imports resolve like the main build
        appType: 'custom',
        logLevel: 'warn',
        server: { middlewareMode: true, hmr: false },
        plugins: [svelte(svelteConfig)],
      });
    }
    return server;
  }

  return {
    name: 'blotterbook-ssg',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        // Only act on a registered template that actually carries the outlet — so app SPA shells and
        // any not-yet-converted page are left untouched (supports incremental migration).
        if (!html.includes(OUTLET)) return html;
        const page = pages.find(p => ctx.path === '/' + p.url || ctx.path.endsWith('/' + p.url));
        if (!page) return html;
        const s = await getServer();
        const { render } = await s.ssrLoadModule('svelte/server');
        const mod = await s.ssrLoadModule(resolve(projectRoot, page.component));
        const { head, body } = render(mod.default, { props: {} });
        return html.replace(HEAD, head || '').replace(OUTLET, body || '');
      },
    },
    async closeBundle() {
      if (server) {
        await server.close();
        server = null;
      }
    },
  };
}
