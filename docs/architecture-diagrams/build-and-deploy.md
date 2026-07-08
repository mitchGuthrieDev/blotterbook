# Build & deploy flow

How `npm run build` turns `src/` + `static/` into the `dist/` artifact Cloudflare Pages serves,
including the manifest cache-bust step and the SSG prerender of the marketing pages.

**Source of truth:** [`vite.config.mjs`](../../vite.config.mjs) ·
[`scripts/build-manifest.mjs`](../../scripts/build-manifest.mjs) ·
[`scripts/vite-ssg.mjs`](../../scripts/vite-ssg.mjs) · [`package.json`](../../package.json) (`build`) ·
[ADR-001](../adr-001-vite-svelte-spa.md).

```mermaid
flowchart TD
    SRC["src/ — Vite root<br/>10 HTML entries + Svelte components + core"]
    STATIC["static/ — publicDir<br/>data/*.json · _headers · _redirects ·<br/>robots.txt · sitemap.xml · assets/og-image.png"]

    subgraph BUILD["npm run build"]
        BM["build-manifest.mjs<br/>SHA-256 (12 chars) of static/data/*.json<br/>→ static/data/manifest.json (COMMITTED source)"]
        VITE["vite build<br/>plugins: @tailwindcss/vite · svelte · ssg()"]
        SSG["ssg() prerender<br/>SSR-render site components into<br/>&lt;!--ssg-outlet--&gt; / &lt;!--ssg-head--&gt;<br/>(SEO + first paint) then hydrate client-side"]
        BM --> VITE --> SSG
    end

    SRC --> BUILD
    STATIC -->|"copied verbatim"| DIST
    BUILD --> DIST[("dist/ — gitignored artifact")]

    DIST --> PAGES["Cloudflare Pages<br/>build cmd: npm run build · output dir: dist"]
    FUNCS["functions/* (repo root, unserved by Vite)"] --> EDGE["Pages Functions (edge runtime)"]
    PAGES --> CDN["served surface:<br/>/ · /help/* · /account.html · /app/ · /app/demo.html ·<br/>/app/staging.html · /data/* · /dev/components.html"]
    EDGE --> CDN2["/api/* + /app/staging.html gate"]
```

## The 15 entry points

| Group | Entries |
| --- | --- |
| Marketing/info (prerendered via SSG) | `index` · `help/*` (×5, A273) · `roadmap` · `changelog` · `legal` · `account` · `admin` |
| App surfaces (SPA shells) | `app/app` · `app/demo` · `app/staging` |
| Dev-only (noindex, robots-blocked) | `dev/components` (styleguide) |

## Notes

- **`build-manifest.mjs` writes a *committed source*, not `dist/`.** It hashes the reference-data JSON
  so the app can cache-bust with `?v=<hash>`. It's deterministic (no timestamps) so CI's drift gate
  can re-run it and assert the committed `manifest.json` matches — see
  [ci-pipeline.md](ci-pipeline.md).
- **URLs are preserved 1:1** from source paths — see [repo-layout-url-contract.md](repo-layout-url-contract.md).
- **No SvelteKit** (ADR-001); the marketing pages are SSG (prerender + hydrate), the app surfaces are
  client-rendered SPAs, and `functions/` deploy as edge functions automatically.
