# Project-structure audit & target-layout plan (A70 → A30/A69)

**Status:** audit complete · target layout decided · **EXECUTED by A30 + A76 (2026-06-28)** —
the `src/` + `static/` split below is now live (folded together with the A61 full-TS conversion);
A18 retired. A69 (marketing → Svelte) fills the prepared `src/site/` homes next.

> Deliverable for backlog **A70** ("audit project structure to optimize for Vite + Svelte"). It is a
> **read-only audit** plus the **concrete target layout** that **A30** (source-tree reorg) executes.
> Per the owner's call, the target layout is designed to **absorb A69** (convert homepage/admin/info
> site to Svelte) so the A30 reorg is done **once and is final** — A69 fills in prepared homes rather
> than re-shaping the tree. This doc is the "target layout decided" precondition A30's prompt requires.

## Summary

The repo still uses the **flat, root-as-web-root source layout** from the pre-build era. A26 already
reversed the deploy contract (Vite builds to `dist/`, Pages serves `dist/`) **without moving any
sources**, so source paths still mirror public URLs by coincidence, not necessity. That coincidence is
the only thing the flat layout still buys — and it has already eroded (no surface is servable
un-built; `staging.html` never was post-A27). **The flat layout no longer earns its keep**; a one-time
reorg into a Vite/Svelte-shaped `src/` + `static/` split is justified as a maintainability cleanup
(not a functional change, hence **P3**).

The reorg is worth doing **once**, coordinated with A69, because A69 changes the *shape* of the
marketing surfaces (HTML+`assets/*.js` → Svelte components + shared chrome components, retiring
`partials/` + `build-includes.mjs`). Reorganizing before A69 then again after would be the
"reorg twice" A30's prompt explicitly warns against. This plan gives both a single target.

## Current structure — findings

### What's where today

| Group | Files | Notes |
| --- | --- | --- |
| **Pure-logic core** (A29, framework-agnostic, node-tested) | `app/adapters.js` (780), `app/core.js` (522), `app/store.js` (404), `app/demostore.js` (150), `app/curveseries.js` (51), `app/report.js` (208), `app/sampledata.js` (40), `app/types.js` (108, JSDoc typedefs), **`assets/util.js`** (shared `esc`/`platformLabel`/version-badge) | The hard-won value. Imported verbatim by the Svelte app **and** by `scripts/test-*.mjs`. Note `assets/util.js` is core-grade shared code that lives in `assets/`, not with the rest of the core. |
| **App SPA (Svelte)** | `app/staging-svelte/` — `main.js`, `App.svelte`, `modal.js`, `util.js` (app-only `readImage`/`downloadBlob`), `actions.js` (`styleProps`), `components/` (17 `.svelte`) | Dir name `staging-svelte` is now a misnomer — it's the shared app for all three surfaces (A33). Rename is part of A30. |
| **Marketing/info JS** (Vite-bundled per HTML entry) | `assets/home.js` (index), `assets/admin.js` (admin), `assets/changelog.js` (changelog) | All three `import { … } from './util.js'` (the shared `assets/util.js`). **These become Svelte in A69.** |
| **Marketing/info HTML** | `index.html`, `howto.html`, `roadmap.html`, `changelog.html`, `legal.html`, `admin.html` | Static, Vite MPA entries. `howto`/`roadmap`/`legal` load **no** JS. **Become Svelte in A69.** |
| **Shared chrome (build-time include)** | `partials/nav.html`, `partials/footer.html` + `scripts/build-includes.mjs` | The last partial family. **A69 replaces these with `Nav.svelte`/`Footer.svelte`, retiring `build-includes.mjs` and its drift-gate half.** |
| **CSS** | `tokens.css` (single source of truth), `site.css` (info pages), `home.css` (homepage), `admin.css` (admin) | A69 folds page CSS into scoped component styles; `tokens.css` stays the single source. |
| **Verbatim-static** (Vite doesn't bundle → `copy-static.mjs`) | `data/*.json`, `_headers`, `_redirects`, `robots.txt`, `sitemap.xml`, `assets/og-image.png` | The `publicDir`-replacement candidates. |
| **Bundled SVG** | `assets/banner.svg`, `assets/why-*.svg` (6), `assets/favicon.svg` | Referenced from HTML entries → fingerprinted by Vite. **Mixed in `assets/` with the verbatim PNG.** |
| **Edge layer** (PINNED at repo root) | `functions/` (api/, _lib/, _middleware.js) | Cloudflare Pages resolves `functions/` from the **repo root**, *not* from `dist/`. **This cannot move** — the one true hard constraint. |
| **Tooling / config** | `scripts/`, `e2e/`, `docs/`, `.github/`, `vite.config.mjs`, `eslint.config.mjs`, `jsconfig.json`, `playwright.config.mjs`, `.prettier*`, `package*.json`, `.node-version` | Stay at root (unserved). |

### Specific issues the reorg should fix

1. **`assets/` is a mixed bag** — Vite-bundled JS (`home/admin/changelog/util.js`) + Vite-bundled SVG
   (`banner`, `why-*`, `favicon`) + one **verbatim-static PNG** (`og-image.png`). The bundled-vs-static
   distinction is invisible from the directory. *(A30/A70 core task: split.)*
2. **`assets/util.js` is misplaced** — it's framework-agnostic shared logic (used by `report.js` on the
   app side and `changelog.js`/`admin.js` on the marketing side), but it sits in `assets/` apart from
   the rest of the core. It belongs with the pure-logic core.
3. **Two different files named `util.js`** — `assets/util.js` (`esc`/`platformLabel`/version) vs.
   `app/staging-svelte/util.js` (`readImage`/`downloadBlob`). Same name, different contents, different
   layers → confusing imports (`'../util.js'` vs `'../../assets/util.js'`). Rename on move.
4. **`app/staging-svelte/` is a misnomer** — it's the shared app for app/demo/staging since A33, not
   staging-only. (A30 already lists this rename.)
5. **`app/entitlements.js` (35 lines) is currently dead code** — zero importers anywhere (only doc/
   backlog mentions). It is an **intentional scaffold** for the future `CloudStore` tier (A4/A16,
   `functions/README.md`). *Recommendation: keep, but relocate with the core and keep its
   "not loaded yet" header comment so it doesn't read as live wiring.* Do **not** delete.
6. **`app/data.js` is now an 11-line `APP_FLAGS` holder** (the rest was deleted in A33). Fine to keep,
   but it's a candidate to fold into a small `flags`/config module during the move.
7. **`partials/` + `build-includes.mjs` survive only for nav/footer** — A69 dissolves them into Svelte
   chrome components. The reorg target must have a home for `Nav.svelte`/`Footer.svelte`.

### The coupled-path set (what A30 must update in lockstep)

Any source move must update **all** of these together (this is *the* cost of A30 — URLs stay 1:1
regardless, per A26):

| Coupling point | Keys off |
| --- | --- |
| `vite.config.mjs` | `rollupOptions.input` (9 HTML entry paths) + `publicDir` + `root` |
| `scripts/build-manifest.mjs` | `data/` dir path + the `EXCLUDE` set |
| `scripts/bump-version.mjs` | path **prefixes**: `app/app.html`, `app/demo.html`, `tokens.css`, `^app/.*\.(js\|svelte)$`, `^partials/`, `^assets/`, `^data/` (minus `NON_SHIPPING_DATA`); `PROD_ONLY` set (`index/home.css/site.css/howto/roadmap/legal/changelog`); `STAGING_ONLY` (`app/staging.html`) |
| `scripts/build-includes.mjs` | scans `['.', 'app']` for `*.html`; reads `partials/` — **retired by A69** |
| `scripts/copy-static.mjs` | explicit `items` list — **retired by `publicDir`** |
| `jsconfig.json` (→ `tsconfig` if A61) | `include: app/**/*.js, assets/**/*.js`; `exclude: app/staging-svelte/**` |
| `eslint.config.mjs` | `files` globs: `app/**`, `assets/**`, `functions/**`, `scripts/**`, `e2e/**` |
| `.prettierignore` | `**/*.html`, `**/*.svelte`, `data/`, `.github/` |
| `playwright.config.mjs` | builds + serves `dist/` (output-relative — **unaffected by source moves**) |
| Every relative import | `'../core.js'`, `'../../assets/util.js'`, `'./types.js'`, etc. |
| `_redirects` / `_headers` | `/app/ → /app/app.html` rewrite; CSP `*-src 'self'` assumes same-origin `/app /assets /data /api` — **URL-relative, unaffected if URLs stay 1:1** |

**No change needed** (output-/URL-relative, and URLs stay 1:1): canonicals, `og:image`, `sitemap.xml`,
`robots.txt` contents, `_redirects`/`_headers` directives. These reference *URLs*, which A26/A30
preserve. Only *source-path* couplings (the build scripts, configs, imports) change.

## Target layout (final — absorbs A69)

The design goal: one `src/` tree with three peers — the **shared core**, the **app**, and the
**site** — plus a `static/` `publicDir` for verbatim files. `functions/` and tooling stay at the repo
root. URLs are preserved 1:1 via Vite's `root` + per-entry input mapping (Vite mirrors each HTML
entry's path *relative to the Vite root* into the output, so placing entries at the right relative
paths reproduces today's URLs exactly).

```
/                              repo root — tooling + deploy-pinned edge layer (UNSERVED)
  functions/                   PINNED at root (Pages requirement) — UNCHANGED
  scripts/                     build/version tooling + node test suites
  e2e/  docs/  .github/
  vite.config.mjs  eslint.config.mjs  tsconfig.json|jsconfig.json
  playwright.config.mjs  .prettier*  package*.json  .node-version

  static/                      Vite publicDir → copied verbatim to dist/ root (retires copy-static.mjs)
    data/*.json                (build-manifest.mjs points here; still runtime-fetched + hashed)
    _headers  _redirects  robots.txt  sitemap.xml
    assets/og-image.png        (referenced by absolute https og:image URL)

  src/                         Vite root — everything that gets bundled/served
    index.html                 → /                (homepage entry)
    howto.html roadmap.html changelog.html legal.html  → /howto … (info entries)
    admin.html                 → /admin.html       (admin entry)
    app/
      app.html demo.html staging.html             → /app/app.html …  (the three SPA mounts)
      main.js  App.svelte
      components/              (the 17 app components)
      lib/                    app-only helpers: modal.js, actions.js, files.js (ex app util.js:
                              readImage/downloadBlob), flags.js (ex app/data.js APP_FLAGS)
    site/                      MARKETING + INFO — Svelte after A69 (prepared homes now)
      components/             Home.svelte, Howto.svelte, Roadmap.svelte, Changelog.svelte,
                              Legal.svelte, Admin.svelte  (A69 fills these in)
      lib/                    Nav.svelte, Footer.svelte (ex partials/), changelog/admin renderers
                              (ex assets/changelog.js + admin.js)
      assets/                 banner.svg, why-*.svg, favicon.svg  (bundled, site-scoped)
    lib/                       PURE-LOGIC CORE (A29) — shared by app + site + node tests
      adapters.js core.js store.js demostore.js curveseries.js report.js
      sampledata.js entitlements.js (scaffold) types.js
      format.js               (ex assets/util.js: esc/platformLabel/version — renamed, no collision)
    styles/
      tokens.css              single source (unchanged role); page CSS folds into scoped
                              component <style> as A69 converts each page
```

Notes on the design:

- **`src/lib/` is the core's home** — framework-agnostic, importable by `src/app` and `src/site`, and
  by `scripts/test-*.mjs` (their imports become `../src/lib/adapters.js` etc.). Keeps A29 intact: the
  node suites still cover the same files, unmoved-in-spirit.
- **`assets/util.js` → `src/lib/format.js`** resolves both the misplacement (#2) and the `util.js`
  name collision (#3). The app-only `util.js` → `src/app/lib/files.js`.
- **`src/site/` is the A69 absorption point.** Today its `components/` would hold thin Svelte mounts
  (or, transitionally, the current static HTML can live as `src/*.html` entries). A69's job becomes
  "author the `Home/Howto/.../Admin.svelte` and `Nav/Footer.svelte` in their prepared homes" — a
  **content** change inside the settled tree, not another move. `partials/` and `build-includes.mjs`
  retire when `Nav/Footer.svelte` land.
- **`publicDir: 'static'`** retires `copy-static.mjs` and drops one bespoke build step. `build-manifest`
  is repointed at `static/data/`.
- **Marketing stays static/prerendered** — these remain Vite MPA HTML entries that mount/compile
  Svelte (or are prerendered), **not** pulled behind the app SPA shell (ADR-001 constraint; SEO/first
  paint preserved). No SvelteKit (A62 deferred).
- **`functions/` does not move** — the single hard constraint; Pages reads it from the repo root.

## Does the root-flat deploy contract (A18) still earn its keep?

**No.** A18's rationale was "root = web root = deploy artifact, so don't add a `/src` split." A26
dissolved that by introducing a build output dir (`dist/`); the source layout is now decoupled from
URLs. The flat layout's residual benefit — "the committed tree is directly servable un-built" — is
**already gone** (every surface is a Svelte mount that must be built; `staging.html` was never
servable un-built post-A27). So the reorg no longer violates a live contract; it's a maintainability
cleanup whose cost is purely the lockstep path update. A18 should be **explicitly retired/superseded**
in the docs as part of A30 (it's already annotated as "realized by A26").

## Recommendation & sequencing

1. **Adopt this target layout** as the decided structure (satisfies A30's precondition).
2. **Decide A61 (TypeScript) first** — if `.js → .ts` renames are coming, fold them into the same
   move so files/extensions/imports are touched once. (A61 is a separate discussion; this plan is
   TS-agnostic — `src/lib/*.js` becomes `src/lib/*.ts` cleanly, and `jsconfig.json → tsconfig.json`.)
3. **Execute A69 + A30 as one coordinated pass** (or A69 immediately, then A30), using this layout as
   the shared contract:
   - **A69** authors the site Svelte components + shared chrome into `src/site/…`, retiring
     `partials/` + `build-includes.mjs` and folding page CSS into scoped styles.
   - **A30** moves the core into `src/lib/`, renames `app/staging-svelte/ → src/app/`, splits
     `assets/` (bundled SVG → `src/site/assets/`; `og-image.png` → `static/assets/`), introduces
     `static/` as `publicDir` (retiring `copy-static.mjs`), repoints `build-manifest`, and updates
     every coupled path + import + the `bump-version` prefix classifier in lockstep.
   - Because the layout was designed up front to host A69's outputs, **A30 is structurally final** —
     A69 does not re-shape the tree afterward.
4. **Gate:** `npm run build` emits a byte-equivalent `dist/` (same URLs), `npm test` + `npm run
   test:e2e` green, the drift gate green (manifest still committed; the include half of the gate
   retires with `build-includes`), every surface boots clean, and demo still persists nothing.

**Order:** `A61 decision` → `A69 + A30 coordinated reorg-and-convert` (this layout) → done. Doing
them together is lower-churn than A69-on-flat-then-A30-moves-it, and it makes "A30 is final" literally
true.

## Follow-ups filed

- **A30** — proceed with *this* target layout; updated to point here (the "target layout decided"
  precondition is now met). Coordinate execution with A69.
- **A69** — author site Svelte components into the prepared `src/site/` homes; retire `partials/` +
  `build-includes.mjs`. Updated to point here.
- **A76** *(new, P3)* — small cleanup that can ride along with A30: resolve the `util.js` name
  collision (`assets/util.js → src/lib/format.js`; app `util.js → src/app/lib/files.js`) and
  re-home/clearly-label the `entitlements.js` scaffold so it doesn't read as live wiring.
</content>
