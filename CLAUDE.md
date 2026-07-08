# CLAUDE.md

Operational guide for working in this repo. Product overview is in
[`README.md`](README.md); the deep architecture / promotion / versioning
narrative is in [`docs/architecture.md`](docs/architecture.md); the
accounts/payments/admin backend is in
[`functions/README.md`](functions/README.md).

## What this is

**Blotterbook** is a client-side trading journal and cost dashboard for futures
traders. It parses a balance-history CSV (TradingView and other platforms)
entirely in the browser, stores it locally in IndexedDB, and renders
performance / calendar / cost / tax / stats views. **Compute stays 100% local on
every tier; the moat is refined, not absolute** — trade data leaves the browser
*only* for a `cloud`-tier user who opts a workspace into sync, and *only as
ciphertext the server cannot decrypt* (E2E, zero-knowledge). `local`-tier and
un-synced workspaces egress nothing. Cloud sync is **live on prod** (opt-in,
`cloud`-tier only; demo never syncs by construction — CH16, 2026-07-07). See
[`docs/synced-workspaces.md`](docs/synced-workspaces.md). It's a Vite-built
Svelte 5 SPA (ADR-001) that deploys to Cloudflare Pages (build → `dist/`) plus
`/functions/*` edge functions.

## Hard constraints (do not break these)

Blotterbook is a conventional modern **Svelte 5 (runes) + Tailwind v4 + shadcn-svelte** app
built with Vite (ADR-001) and shipped to Cloudflare Pages. The old "pillars" (local-compute-only
moat, dependency minimalism, `tokens.css` as the single token source) have been retired by the
decision owner — pull in dependencies that earn their weight and use the standard tooling. A few
genuine invariants remain:

- **Must be served over http(s).** The app `fetch()`es `/data/*.json`, so opening
  files from disk breaks it. Use a static server.
- **CSP `style-src 'self'` holds — no inline `style=""`.** Tailwind utilities ship as a linked
  stylesheet of classes (`class="bg-card"`), never an inline `style=""` attribute; bits-ui /
  Floating-UI position popups via `element.style` in JS (CSSOM — not gated by `style-src`). The
  invariant is unchanged: **never add a literal `style=""` attribute to markup** — use utilities or
  the `styleProps` action for dynamic styling.
- **Demo never mutates or persists** — it mounts the in-memory `DemoStore` (nothing reaches
  IndexedDB/localStorage by construction) and disables/guards every write path. `DemoStore` is never
  a `cloud` store and never syncs.
- **Egress is ciphertext-only and opt-in.** Compute never touches the network on any tier. Trade data
  leaves the browser *only* through the **opt-in, `cloud`-tier** cloud-sync path (F58–F63; live on prod
  + staging, never demo), *only* for a `cloud`-tier user who opted a workspace in, and *only as E2E
  ciphertext the server can't decrypt*.
  Don't add a network read/write to the compute path or send any plaintext trade field to `/functions`.
- **CSP `script-src` gained `'wasm-unsafe-eval'`** (owner-approved 2026-07-06) so the Argon2id **wasm**
  (`hash-wasm`, F61a) can compile — this is wasm-specific and does **not** re-enable `'unsafe-inline'`/
  `'unsafe-eval'` JS (both stay absent). Keep it that narrow.
- **The committed HTML and data manifest are generated artifacts** that must stay in sync with
  their sources — CI's drift gate fails if they drift (see Commands).
- **The pure-logic core (`src/lib/core/`) is framework-agnostic** and reused as-is by the app and
  the info site; edit persisted data only through the `Store` interface, never `indexedDB` directly.

The app uses the standard Svelte/Vite stack: see
[`docs/adr-001-vite-svelte-spa.md`](docs/adr-001-vite-svelte-spa.md) (the Vite + Svelte SPA),
[`docs/adr-002-tailwind-shadcn.md`](docs/adr-002-tailwind-shadcn.md) (the Tailwind + shadcn-svelte
re-platform), and [`docs/architecture.md`](docs/architecture.md).
- **The `/app/` surface is a Svelte 5 SPA** (ADR-001; A26 Vite, A27 staging, A33 cutover). All three
  surfaces — `app/app.html`, `app/demo.html`, `app/staging.html` — are hand-authored, marker-free
  mount points (`<div id="app">` + `<script type="module" src="./main.ts">`, body
  `data-mode="app|demo|staging"`). The Svelte app lives in `src/app/`: the redesigned sidebar-shell
  `App.svelte` (an `AppShell` + hash router) + `screens/` (Dashboard/Calendar/Analytics/Blotter/
  CsvLibrary/TradeEditor/Reports/Account — Account ships on all surfaces, demo read-only, F53/CH16) + `parts/` (BootSplash/
  CostSetup/Onboarding/ActivityTerminal/InfoTip/StatCardRow/StatusBanner/DashTabs/DatePickerPopover/
  DetectionStatus/EditableCellPopover/FeedbackDialog/LaunchGate/ModuleCarousel/ModuleResizeHandle/ModuleSizeMenu/PaginationControls/
  ScreenshotLightbox/SegmentedControl/SymbolSelect/TagInput + the synced-workspaces
  parts WorkspaceSwitcher/CloudSyncSetup/UnlockModal/SyncStatusPill, A132/F61b/F63/A279) +
  `lib/{dashboard.svelte.ts,dashtabs.svelte.ts,account.svelte.ts,pagination.svelte.ts,actions,batch,files,flags,flavor,motion,nav,analytics,reports,econ.svelte.ts,modlayout.ts,modsize.svelte.ts}`
  plus the cloud-sync glue `{vault.svelte.ts` (in-memory key session, F61b)`,cloudstore.ts` (write-behind `StoreLike` wrapper, F63)`,cloudsync.svelte.ts` (reactive sync controller, F63)`}`.
  It reuses the **pure-logic core** in `src/lib/core/` (A29, native TS per A61): `adapters` (+ `xlsx`
  for the ATAS X .xlsx path, F52) / `intake` (CSV gates + cross-export reconciliation, A177/A219) /
  `compute`+`costModel` in `core` / `store` (now with delete tombstones + named workspaces, F58/F59) /
  `sampledata` / `demostore` / `curveseries` / `report` / `entitlements` (storage-tier resolver, wired
  to `/api/me`, F60) / `crypto` (E2E envelope-encryption core — AES-KW/GCM/HKDF/HMAC + Argon2id via
  `hash-wasm`, F61a) / `cloudsync-core` (pure push/pull/merge engine, F63; relocated here from
  `src/app/lib` for strict `tsc` coverage, A314), with `format` shared by the app *and* the info
  pages. Cross-component state is
  Svelte runes (`$state`/`$derived`), not a
  shared globals object. `App.svelte` resolves the mode-aware `Store` (real IndexedDB for app/staging
  via `Entitlements.storeFor()`, the in-memory `DemoStore` for demo, so **demo persists nothing** — by
  construction) once at the top and — **on every non-demo surface (app + staging)** — wraps it in a
  `CloudStore` (`wrapStore`, F63) for opt-in encrypted sync (inert until a `cloud`-tier user opts a
  workspace in + unlocks; demo is never wrapped, so it never syncs), then **prop-drills** the resulting store into
  `createDashboard`/`createDashTabs` and down through screens/parts — there is no `context('bb:store')`
  seam (a dead `setContext` call was removed in A224; nothing ever read it). The `CloudStore` is itself
  a `StoreLike`, so every consumer depends only on the interface, not on how the instance is threaded.
  `main.ts` mounts this ONE mode-aware `App.svelte` on
  every surface — mode is derived internally from `PAGE_MODE` (`isDemo`/`isStaging`), there is no
  per-surface root.
  *(The former vanilla view layer — render/ui/widgets/datamanager/export/main/state.js +
  `partials/app-*.html` — was deleted in A33; the CH16 cutover then retired the pre-redesign
  `App.svelte` + its entire `src/app/components/*` view layer and the `lib/modules.ts` module
  registry, renaming the redesigned `StagingApp.svelte` → `App.svelte` as the sole root.)*

## Commands

```bash
# One-time: install pinned deps (Vite + dev tooling) from the lockfile
npm ci

# Build the deploy artifact (ADR-001/A26; A30 src/+static split; A69 site→Svelte SSG). Emits dist/.
npm run build                    # build-manifest + vite build (root:src, publicDir:static; site pages prerendered) → dist/
npm run dev                      # Vite dev server (HMR) for local development
npm run preview                  # serve the built dist/ locally (production-like)

# Tests / lint (the CI suite — run before pushing)
npm test                         # = lint + typecheck + format:check + test:unit
npm run test:unit                # the 18 node suites: adapters / auth / version / flags / tax / demostore / workspaces /
                                  #   curveandreport / compute / accounts / email / econ / crypto / sync / cloudsync /
                                  #   cloudsync-store / modlayout / subscription
npm run lint                     # ESLint (flat config; .ts skipped — typechecked instead, A79)
npm run typecheck                # tsc (src/lib/**/*.ts except src/lib/components) + tsc(functions) + svelte-check (src/app + src/site + src/lib/components + src/dev) — A61
npm run test:e2e                 # Playwright render tests — BUILDS then serves dist/, boots every surface
npm run format                   # Prettier
# (the node suites still run standalone too, e.g. `node scripts/test-adapters.mjs`)

# CI-load-bearing guards (also runnable locally; see .github/workflows/ci.yml)
npm run size-budget               # scripts/check-bundle-size.mjs — /app/-surface JS budget (A96)
npm run check-deploy              # scripts/check-deploy-contract.mjs — deploy-contract + version-classification guard (needs a built dist/, A99)
npm run check-mermaid             # scripts/check-mermaid.mjs — parses every docs/ mermaid block with Mermaid's own parser

# Build sub-step (idempotent; commit its output — it writes a COMMITTED source, not dist/)
node scripts/build-manifest.mjs      # regenerate static/data/manifest.json content hashes (cache-busting)
node scripts/build-econ-events.mjs   # regenerate static/data/econ-events.json (curated econ-release calendar, R14/R14a)
# (build-includes.mjs retired by A69 — the nav/footer partials became Nav/Footer.svelte; the site
#  pages are prerendered to static HTML at build time by scripts/vite-ssg.mjs. copy-static.mjs retired by A30.)
```

> **Deploy artifact = `dist/` (gitignored), built by Vite (ADR-001/A26).** The repo root is no
> longer the web root — Cloudflare Pages runs `npm run build` and serves `dist/`. URLs are preserved
> 1:1, source files were not moved, and `functions/`/`scripts/` stay at the root (unserved; `partials/`
> retired by A69). Pages dashboard settings (build command `npm run build`, output dir `dist`, unset
> `SKIP_DEPENDENCY_INSTALL`) are recorded in [the ADR](docs/adr-001-vite-svelte-spa.md). The Svelte
> migration is complete: A27 brought Svelte to staging, and the **A33 cutover** moved all three
> surfaces (app/demo/staging) to the Svelte SPA and deleted the vanilla view layer.

CI (`.github/workflows/ci.yml`) runs two parallel jobs (CH38): a fast gate (`npm ci` → lint →
typecheck → format) alongside the heavy job (the unit/logic tests → **the Vite build** →
size-budget + deploy-contract guards → the mermaid docs gate → the Playwright render tests against
`dist/`), which then re-runs the generated-data build scripts (`build-econ-events.mjs` +
`build-manifest.mjs`, A323) and **fails if the result differs from what's committed** (the drift gate;
`dist/` is gitignored, so this proves the build-time tooling didn't leave committed sources stale).
So:

- **After editing any `static/data/*.json` →** run `build-manifest.mjs` and commit the
  regenerated `static/data/manifest.json`.
- *(A69 retired the build-includes half of the drift gate: the nav/footer are now `Nav.svelte` /
  `Footer.svelte`, and the site pages are prerendered to static HTML at build time — there is no
  longer any committed HTML generated from partials.)*

## Conventions

- **Never hand-edit `data/versions.json`.** Versioning is automated from commit
  type + changed paths on push to `main` (CH12). See
  [docs/architecture.md](docs/architecture.md#versioning--releases-ch12). Don't
  set `prod` to the staging number.
- **PR titles are conventional commits** and drive the version bump: `feat:` →
  minor, `fix:`/`chore:`/`refactor:` → patch, `feat!:` / `BREAKING CHANGE:` →
  major.
- **App surfaces & their sources (A33; CH16 redesign cutover).** All three — `app/app.html`,
  `app/demo.html`, `app/staging.html` — are hand-authored, marker-free **Svelte mount points** that
  load `src/app/main.ts` and differ only by `<body data-mode="app|demo|staging">`. `main.ts` mounts
  ONE mode-aware root — the redesigned sidebar-shell `App.svelte` (`AppShell` + hash router over
  `src/app/screens/*` + `src/app/parts/*`) — on every surface; mode is derived internally from
  `PAGE_MODE`. Edit the Svelte components in `src/app/` (`App.svelte` + `screens/` + `parts/`), not
  the HTML shells. (The old `partials/app-*.html` single-source shells were deleted in A33; the CH16
  cutover retired the pre-redesign `App.svelte` + its `src/app/components/*` view layer.)
- **Demo must never mutate or persist.** Demo mounts the Svelte app with `data-mode="demo"` → the
  in-memory `DemoStore`, so **nothing reaches IndexedDB or localStorage by construction**. On top of
  that, every data-writing control is `disabled` when `PAGE_MODE === 'demo'` and each write path is
  guarded (`if (isDemo) return;`). When adding a write, confirm both. (e2e asserts no Blotterbook
  IndexedDB is created on demo.)
- **Styling = Tailwind v4 utilities + canonical shadcn-svelte primitives (ADR-002).** The single
  Tailwind entry [`src/styles/tailwind.css`](src/styles/tailwind.css) is also the **single source of
  design-token values** (`tokens.css` is deleted). It defines the canonical shadcn-svelte semantic
  set in `:root` from Blotterbook's palette — `background`/`foreground`/`card`/`popover`/`primary`/
  `secondary`/`muted`/`accent`/`destructive`/`border`/`input`/`ring` + `chart-1..5` — and maps it via
  `@theme inline`. Components use the **semantic utilities**: `bg-background`/`bg-card`/`bg-secondary`,
  `text-foreground`/`text-muted-foreground`, `bg-primary`/`text-primary-foreground`, `border-border`,
  `hover:bg-accent`. **The UI chrome is a greyscale ramp (UI redesign initiative):** `primary` is
  near-white (the "action" treatment), `ring` is mid-grey — there is no brand blue in the chrome;
  shadcn's **`accent`** is the subtle item-hover surface. **Color survives only in the data layer:**
  `destructive` stays red (error / P&L loss) and the trading-domain **`chart-1..5`** are unchanged —
  chart-1 series-blue, chart-2 P&L-up (green), chart-3 take-home (purple), chart-4 warning (amber),
  chart-5 P&L-down (red) — so `text-chart-2` = positive P&L and `text-destructive`/`text-chart-5` =
  negative. Corners are angular (`--radius` 4px). **Type is mono-forward:** self-hosted Geist Mono
  (`@font-face`, variable woff2 in `src/assets/fonts/`, CSP font-src 'self') is the primary UI
  typeface — both `--font-sans` and `--font-mono` resolve to it. `tw-animate-css` supplies animations.
- **UI primitives = canonical shadcn-svelte at `$lib/components/ui/` (ADR-002).** `button`, `badge`,
  `card`, `checkbox`, `input`, `textarea`, `label`, `switch`, `table`, `tabs`, `tooltip`, `breadcrumb`,
  `separator`, `skeleton`, `dialog`, `sheet`, `alert-dialog`, `dropdown-menu`, `popover`, `select` —
  composed over **bits-ui v2** with `data-slot` attrs and `cn` from `$lib/utils`. Use these for dialogs/menus/popovers/selects instead of hand-rolling a11y; you
  **own the source**, so customize them in place. They render canonically (Dialog/menus/popover/select
  **portal to body**). Add/maintain them with the **shadcn-svelte CLI** — `components.json` is wired,
  so `npx shadcn-svelte add <name>` works where the registry is reachable; in egress-blocked
  environments (e.g. the remote sandbox) vendor the component source by hand instead. **Icons = [`@lucide/svelte`](https://lucide.dev)** (the
  shadcn-standard set; named imports `import { Calendar } from '@lucide/svelte'`, rendered as
  components with a `class` for sizing/color, e.g. `<Calendar class="size-4" />`). A class applied via prop onto a primitive's ROOT element
  doesn't get the parent's Svelte scope hash, so style such elements with utilities (or the primitive),
  not scoped descendant CSS; for a trigger that must keep scoped styling, use bits-ui's `child` snippet
  so the real element stays in your template. Consult the Svelte MCP server + the shadcn-svelte/bits-ui
  docs when touching these. After UI work, grep `src/` for a new `style="` (CSP) and keep the e2e
  specs + `_headers` green. **No Tailwind preflight** ships (tailwind.css imports only theme +
  utilities, not preflight — to avoid resetting the hand-styled app/site), so native form controls
  keep their UA chrome: a raw `<button>` shows a light UA background unless a `bg-*` utility overrides
  it (and a bare `<a>` gets UA blue + underline). The dev/redesign surfaces neutralize both with
  `[data-mode='dev'] button`/`a` resets in tailwind.css; elsewhere, give bare buttons/links explicit
  styling.
- **Marketing/info site = Svelte SSG (A69).** `index/help/*×5/roadmap/changelog/legal/account/admin.html` are
  hand-authored, marker-free **templates** (head meta + `<div id="app"><!--ssg-outlet--></div>`
  + a client-entry `<script>`). At build time [`vite-ssg.mjs`](scripts/vite-ssg.mjs) server-renders each page
  component (`src/site/components/*.svelte`) into the outlet (static HTML for SEO + first paint), and
  the client entry hydrates it. Edit the **components** (`src/site/components/` + shared
  `src/site/lib/{Nav,Footer,SiteShell}.svelte`), not the HTML shells. NOT behind the app SPA shell
  (ADR-001); no SvelteKit (A62). Keep CSP `style-src 'self'` — no inline `style=""`; use a CSSOM
  action for dynamic styles (A55). admin stays Cloudflare Access–gated + noindex.
- **Edit data through the `Store` interface only** (`src/lib/core/store.ts`) — never touch
  `indexedDB` directly. A future `CloudStore` implements the same interface.
- **The user-facing changelog is hand-curated** in `data/changelog.json` (not raw
  commits). Add an entry when `prod` bumps.

## Svelte MCP server

The official Svelte remote MCP server is wired up in
[`.claude/settings.json`](.claude/settings.json) (`https://mcp.svelte.dev/mcp`). Use its tools when
writing or changing any Svelte code:

- **`list-sections`** — call FIRST to discover the available Svelte 5 docs sections.
- **`get-documentation`** — after `list-sections`, fetch every section relevant to the task before
  writing code.
- **`svelte-autofixer`** — run on ALL Svelte code before presenting it; keep calling until it
  returns no issues/suggestions.
- **`playground-link`** — only when the user explicitly asks, and NEVER for code already written to
  files in this repo.

## UI mockup workflow

Designing/mocking new screens happens **in code**, not a separate design tool. When asked to build or
mock up a screen, **walk through these steps in order and say which step you're on** — don't jump
straight to final code. How the `/dev` sandbox relates to the real app — what's already global (tokens)
vs. preview-only (shell/screens), and the cutover + staging plan — is in
[`docs/ui-redesign.md`](docs/ui-redesign.md).

1. **Token audit.** Tokens live in [`src/styles/tailwind.css`](src/styles/tailwind.css) (Tailwind v4,
   CSS-based — there is no `tailwind.config.js`). **Greyscale UI** (semantic set is a neutral ramp;
   `primary` near-white, `ring` mid-grey), **angular** corners (`--radius` 4px + `sm/md/lg/xl`), and
   **mono-forward** type (self-hosted Geist Mono; `--font-sans`/`--font-mono` both resolve to it);
   spacing + type scale are Tailwind defaults. **Color lives only in the data layer:** `chart-2` =
   positive P&L (green), `chart-5`/`destructive` = negative (red), `chart-4` = warning (amber),
   `chart-1` series-blue. Use those tokens; never hardcode a raw palette color (`text-green-500`).
   Single dark theme only (no light mode).
2. **App shell.** All mockups sit inside the reusable sidebar frame
   [`src/lib/components/shell/AppShell.svelte`](src/lib/components/shell/AppShell.svelte) — a persistent
   left [`SidebarNav`](src/lib/components/shell/SidebarNav.svelte) (collapsible on desktop, slide-over
   drawer on mobile) + a content column (slim topbar with the sidebar toggle + page `title` + `actions`
   snippet, then scrollable `children`). Props: `brand`/`brandHref` (defaults `Blotterbook` → `/`),
   data-driven `sections` (`NavSection[]`), `active`, `onnavigate`. Tailwind layout utilities only.
3. **Component reference.** The live styleguide is **`/dev/components.html`** (source
   [`src/dev/Styleguide.svelte`](src/dev/Styleguide.svelte)) — every token + installed shadcn-svelte
   primitive with all variants/sizes. **Keep it updated:** when you `npx shadcn-svelte@latest add
   <name>`, add a section for it here. Dev-only — built + deployed but `noindex` + robots-blocked.
4. **Screen-by-screen.** The redesign is the live app now (CH16 cutover — the old `/dev/app.html`
   RedesignApp preview harness was retired), so build/iterate screens directly in
   [`src/app/screens/`](src/app/screens/) (+ cross-screen pieces in [`src/app/parts/`](src/app/parts/)),
   wired by [`src/app/App.svelte`](src/app/App.svelte). To see a screen in isolation with sample data,
   use `/app/demo.html` (the in-memory `DemoStore`, seeded). Per screen: (a) rough the layout with
   Tailwind utilities; (b) reach for installed shadcn-svelte components first — check
   `$lib/components/ui/`, suggest `npx shadcn-svelte@latest add <component>` for anything missing; (c)
   drop to raw bits-ui / custom only when shadcn-svelte doesn't cover the pattern, and match the
   existing visual language; (d) iterate via variant/size props + Tailwind `class` overrides, not by
   rewriting components.
5. **Animation deferral.** For early mockups default to Svelte's built-in transitions (`fade`/`fly`/
   `slide` from `svelte/transition`). Flag (and ask if intentional) before pulling in any heavier
   motion tooling while layouts are still settling.
6. **Consistency pass.** Periodically check new screens against the tokens + the styleguide for drift:
   hardcoded colors, one-off spacing, or a custom component that should have been shadcn-svelte.

## Frontend conventions (Svelte 5 / TS / JSDoc)

This is a Svelte 5 SPA in TypeScript built with Vite — **not SvelteKit** (A62). The repo already
conforms to the rules below; keep it that way.

- **Svelte 5 runes only.** Props are `$props()` (never `export let`); reactive state is `$state()`
  (never a bare `let`); derived values are `$derived()` (never `$:`); side effects are `$effect()`
  (never `$:` blocks). Don't introduce `createEventDispatcher` — use callback props. Cross-component
  state here is Svelte **runes**, not a globals object or `svelte/store` writables: `App.svelte`
  instantiates the `.svelte.ts` rune-module factories (`dashboard.svelte.ts`/`dashtabs.svelte.ts`/
  `pagination.svelte.ts`) and **prop-drills** the resulting state + the `Store` down to screens/parts
  — there is no `context()` seam for app state.
- **File extensions.** Components with a template → `.svelte` (all carry `<script lang="ts">`, A61);
  shared reactive-state-with-runes modules → `.svelte.ts`; pure logic / utilities / API calls /
  types → `.ts`. No hand-written `.js` in `src/` (the pure-logic core is native TS — A61).
- **TypeScript.** `src/` is `any`-free — keep it that way: prefer proper types or `unknown`, and put
  shared interfaces in [`src/lib/core/types.ts`](src/lib/core/types.ts), not inline. Type
  fetched/persisted JSON at the boundary rather than reaching for `any` (e.g. the `Stored*`
  persistence shapes in `types.ts`, or page-local interfaces like the backlog/status shapes in
  `src/site/components/Admin.svelte`).
- **JSDoc.** Don't restate types in JSDoc (`@param {type}`/`@returns {type}`) — tsc owns that.
  JSDoc is for prose on non-obvious behavior, `@deprecated`, and `@example`; skip it entirely when
  the name + types are self-evident.

> **Caveat vs. the generic "Svelte 5 SPA" template:** this repo is a **multi-page** Vite build, so a
> few one-size-fits-all conventions don't apply literally. The Vite config is the multi-page
> [`vite.config.mjs`](vite.config.mjs) (15 HTML entries + the [`vite-ssg.mjs`](scripts/vite-ssg.mjs) plugin),
> **not** a 4-line `vite.config.ts`. SPA routing lives in [`static/_redirects`](static/_redirects)
> (Vite's `publicDir` is `static/`, **there is no `public/`**) and rewrites `/app/` → `/app/app.html`
> — a `/* /index.html 200` catch-all would break the marketing pages and the demo/staging surfaces.
> The source layout is `src/{lib,app,site}` (see **Repo layout** below), not `src/{components,pages,
> state}`.

## Repo layout

> **Vite builds `src/` → `dist/` (ADR-001/A26; source-tree reorg A30); Pages serves `dist/`.** The
> Vite **root is `src/`** (everything bundled/served) and **`static/` is the `publicDir`** (copied
> verbatim to the `dist/` root — this retired `scripts/copy-static.mjs`). `functions/`, `scripts/`,
> and tooling stay at the **repo root**, unserved (`partials/` retired by A69). **URLs are preserved 1:1**: each HTML
> entry's path *relative to `src/`* maps to its URL (`src/index.html` → `/`, `src/app/app.html` →
> `/app/app.html`), and `static/` mirrors to the root (`static/data` → `/data`, `static/_headers` →
> `/_headers`, `static/assets/og-image.png` → `/assets/og-image.png`). Source paths are **decoupled**
> from URLs (guardrail **A18 retired** — superseded by A26 + A30). Renaming/moving a browser-served
> file still changes its URL and must be kept in lockstep across `static/_redirects`,
> `static/_headers`, `static/robots.txt`, `static/sitemap.xml` + page canonicals, the absolute
> `/app//assets//data/` refs, `vite.config` (`root`/`publicDir`/`outDir`/`rollupOptions.input` +
> the `ssg()` page list), and the `build-manifest`/`bump-version` path assumptions. See
> [the deploy contract](docs/architecture.md#repository-layout--the-deploy-contract).

```
/                       repo root — tooling + the deploy-pinned edge layer (UNSERVED)
/src/                   Vite root — everything bundled/served (A30)
  index.html            homepage: hero + features + use cases + platforms + pricing + FAQ  → /
  help/*.html           the Help hub (A273; ex howto.html — /howto.html 301s to /help/import.html):
                        index (landing) + getting-started + import (per-platform guides, #imp-* anchors)
                        + cloud-sync + support
  roadmap.html          shipped vs. planned checklist
  changelog.html        "Blotterlog" — versioned release notes (reads /data/changelog.json)
  legal.html            disclaimers, terms, privacy summary
  account.html          standalone Account Dashboard — login/signup or identity/plan/sync/security (A293; noindex)
  admin.html            internal admin controls (Cloudflare Access–gated)  → /admin.html
  lib/                  $lib alias → src/lib
    core/               PURE-LOGIC CORE (A29) — framework-agnostic, native TS (A61), node-tested
      core.ts           metrics (compute), formatting, cost model, ref-data loading, event bus, shared
                        pure helpers (sessionOf/isoWeek/niceTicks/axMoney/fmtDur/ratio/num)
      report.ts         pure performance-report builder (on-screen + markdown + email — A34)
      sampledata.ts     demo CSV sample data  ·  curveseries.ts  pure daily gross/net/take series
      demostore.ts      in-memory Store implementation for demo (never persists)
      adapters.ts       platform CSV adapters + format auto-detection + fills matcher
      xlsx.ts           dependency-free .xlsx reader for the ATAS X statistics export (F52)
      intake.ts         CSV intake gates — file/MIME/size + binary/row-cap checks (A177) + cross-export
                        reconciliation (reconcileImport — A219)
      store.ts          IndexedDB persistence (trades, journal, meta, trademeta, files, filetext,
                        tombstones — F37 provenance + F58 delete-log) + named workspaces (per-workspace
                        DB `blotterbook:<uuid>`; Default keeps the legacy `blotterbook` name — F59) +
                        Store.local seam (registry + active-workspace + sync cursors)
      entitlements.ts   storage-tier resolver — WIRED to /api/me (Tier local|cloud; storeFor()) — F60
      crypto.ts         E2E envelope-encryption core (F61a): IK gen, AES-KW wrap/unwrap per unlock
                        method, HKDF-from-PRF, Argon2id passphrase KDF (hash-wasm, dyn-imported),
                        AES-GCM encrypt/decrypt, blindId/blindKeyFromDekBytes — pure, node-tested
      cloudsync-core.ts pure push/pull/merge engine for cloud sync (F63) — framework-agnostic +
                        node-tested (test-cloudsync.mjs), relocated here from src/app/lib for strict
                        tsc coverage (A314)
      format.ts         shared esc/platformLabel + version-badge IIFE (ex assets/util.js — A76)
      types.ts          shared TS interfaces (Trade/Fill/CostModel/Metrics/StoreLike/… — A61)
    components/ui/      canonical shadcn-svelte primitives (ADR-002): button, badge, card, checkbox,
                        input, textarea, label, switch, table, tabs, tooltip, breadcrumb, separator,
                        skeleton, dialog, sheet, alert-dialog, dropdown-menu, popover, select (bits-ui v2).
                        CLI works where the registry is reachable; in egress-blocked
                        environments vendor new ones by hand (canonical source)
    components/shell/   reusable sidebar app frame (UI redesign): AppShell.svelte (rail + content
                        column) + SidebarNav.svelte (data-driven nav rail) — every UI mockup sits inside
    utils.ts            cn() class composer (clsx + tailwind-merge) — `$lib/utils`
  app/                  the journal app — a Svelte 5 SPA (ADR-001; vanilla layer removed A33, redesign cutover CH16)
    app.html            Svelte mount, data-mode="app" (served at /app/ via _redirects rewrite)
    demo.html           Svelte mount, data-mode="demo" (in-memory DemoStore — never persists)
    staging.html        Svelte mount, data-mode="staging" (key-gated, isolated IndexedDB)
    main.ts             entry: imports tailwind.css + side-effect format + mount(App)  ·  ONE mode-aware App.svelte on every surface
    App.svelte          the redesigned sidebar-shell root (AppShell + hash router) — mode-aware via PAGE_MODE (CH16)
    screens/            the app screens (<script lang="ts">): Dashboard/Calendar/Analytics/Blotter/CsvLibrary/
                        TradeEditor/Reports/Account (Account ships on all surfaces, demo read-only, F53/CH16)
    parts/              cross-screen pieces: BootSplash/CostSetup/Onboarding/ActivityTerminal/InfoTip/StatCardRow/
                        StatusBanner/DashTabs/DatePickerPopover/DetectionStatus/EditableCellPopover/
                        FeedbackDialog/LaunchGate/ModuleCarousel/ModuleResizeHandle/ModuleSizeMenu/PaginationControls/ScreenshotLightbox/
                        SegmentedControl/SymbolSelect/TagInput + synced-workspaces UI (opt-in, cloud-tier):
                        WorkspaceSwitcher (A132), CloudSyncSetup + UnlockModal (F61b), SyncStatusPill (A279)
    lib/                app-only glue (TS): dashboard.svelte.ts (dashboard state factory + workspace
                        switch/reload), dashtabs.svelte.ts (tabbed dashboards + per-tab module-layout
                        persistence, A135), account.svelte.ts (F53 auth/session state + PRF passkey enroll),
                        pagination.svelte.ts, actions.ts (styleProps), batch.ts
                        (multi-file import queue, F47), files.ts (readImage/downloadBlob — ex util.js, A76),
                        flags.ts (APP_FLAGS), flavor.ts, motion.ts, nav.ts, analytics.ts + reports.ts
                        (Analytics / Reports view-model builders), econ.svelte.ts (econ-calendar module
                        state, reads static/data/econ-events.json, R14/R14a), modlayout.ts (versioned
                        {key,size}[] per-screen module-layout state via makeLayoutKit — 12-track grid,
                        A271; incl. the sm-first KPI-card modules + per-key supported sizes),
                        modsize.svelte.ts (A319 shared DOM-side size controller behind the
                        ModuleSizeMenu/ModuleResizeHandle parts — size menu + corner drag-resize)
                        + cloud-sync glue (opt-in, cloud-tier): vault.svelte.ts
                        (in-memory key session, F61b), cloudstore.ts (write-behind StoreLike wrapper,
                        F63), cloudsync.svelte.ts (reactive sync controller, F63) — over the pure
                        cloudsync-core.ts engine, now in src/lib/core/ (A314)
  site/                 MARKETING + INFO — Svelte SSG (A69; prerendered at build by scripts/vite-ssg.mjs, hydrated in place)
    components/         Home / Help{Home,GettingStarted,Import,CloudSync,Support} / Roadmap / Changelog / Legal /
                        AccountDash / Admin .svelte (the page components)
    lib/                shared chrome: Nav.svelte, Footer.svelte, SiteShell.svelte (base/typography styles + globals)
                        + HelpShell.svelte/HelpNav.svelte (the A273 Help hub sidebar frame — CSS-only mobile disclosure)
    entries/            per-page client entries (hydrate the prerendered component) — *.ts
  dev/                  DEV-ONLY surface (UI mockup workflow) — built + deployed but noindex + robots-blocked
    components.html  +  main.ts  +  Styleguide.svelte   the live component + token reference → /dev/components.html
    nav.ts              shared sidebar nav config (lucide icons) — re-exports src/app/lib/nav for the styleguide
                        (the /dev/app.html redesign preview harness + dev/screens/ were retired post-CH16 —
                        the real app IS the redesign; design new screens directly in src/app/screens/)
  assets/               bundled chrome: favicon.svg, banner.svg, why-*.svg (Vite fingerprints these)
    fonts/              self-hosted Geist Mono variable woff2 (mono-forward UI; @font-face in tailwind.css)
  styles/               tailwind.css — the single Tailwind entry AND the single source of design-token
                        values: shadcn-svelte semantic vars in :root + @theme inline mapping + chart-1..5 (ADR-002)
/static/                Vite publicDir → copied verbatim to dist/ root (A30; retired copy-static.mjs)
  _headers              Cloudflare Pages security headers (CSP + hardening)  → /_headers
  _redirects  robots.txt  sitemap.xml
  assets/og-image.png   referenced by an absolute https og:image URL  → /assets/og-image.png
  data/                 reference data, fetched at runtime (each carries schemaVersion)  → /data/*
    brokers.json        broker commission tiers
    exchange-fees.json  CME exchange/clearing/NFA fees + micro set
    feeds.json          per-broker market-data feed options
    state-tax.json      Section 1256 model + per-state top rates
    econ-events.json    curated US-gov economic-release calendar for the Calendar module (R14/R14a;
                        GENERATED — build-econ-events.mjs)
    manifest.json       content hashes for cache-busting (GENERATED — build-manifest.mjs)
    versions.json       two-track prod/staging versions (GENERATED by CI — don't hand-edit)
    backlog.json        engineering backlog (rendered read-only in admin.html)
    backlog_archive.json  done-item archive (doneNote record)
    changelog.json      curated, version-keyed release notes (hand-maintained)
/functions/             Cloudflare Pages Functions — TypeScript (A78) — PINNED at repo root — see functions/README.md
  _middleware.ts        key-gates /app/staging.html
  _lib/                 accounts.ts (D1 users/credentials/sessions/challenges/donations/recovery_tokens +
                        session cookie), auth.ts (admin token + Stripe sig verify), sync.ts (F62 sync
                        helpers — R2 bucket, ownership, LWW upsert), email.ts (Resend sender, F55),
                        subscribers.ts (F44 changelog-subscriber store), http.ts, types.ts
  api/{geo,status,config,admin-key}.ts  geo · status · feature flags · admin token
  api/admin/*.ts        A276 admin user table + manual entitlement overrides (users list w/ cursor
                        pagination · grant/revoke comped cloud) — Access+token-authed, audit-trailed
  api/{me,checkout,webhook}.ts   storage tier — cloud via hasCloudEntitlement (override OR active/grace
                        subscription, A276/F60) · Stripe donations + subscription-lifecycle webhook
                        (checkout + customer.subscription.*, F54/F60)
  api/subscription/create.ts  A278 in-app Payment Element bootstrap — incomplete subscription +
                        PI client secret (webhook stays the only tier writer)
  api/account/*.ts      passkey register/login/logout + email-verify + recovery + reclaim (A316) + account-delete +
                        passkey-delete endpoints (F53/F55)
  api/sync/*.ts         F62 encrypted-blob transport (workspaces · wrapped-ik · push · pull · delete) over R2 + D1
  api/{subscribe,confirm,unsubscribe,notify-changelog}.ts  F44 changelog (Blotterlog) email
                        subscriptions — double opt-in signup/confirm/unsubscribe + the send-trigger
                        broadcast endpoint
  schema.sql             D1 schema — accounts tables + subscriptions/webhook_events (F60) +
                        entitlement_overrides (A276 manual comps, audit-trailed) +
                        sync_records/sync_wrapped_ik/sync_workspace_keys/sync_workspaces (F62) +
                        subscribers/changelog_sends (F44); apply via wrangler
/scripts/
  build-manifest.mjs    regenerates static/data/manifest.json content hashes
  build-econ-events.mjs regenerates static/data/econ-events.json — the curated economic-release calendar (R14/R14a)
  bump-version.mjs      two-track version bump from a merge commit (run by CI; classifies src/ + static/ paths)
  vite-ssg.mjs          A69 SSG plugin — server-renders the site components into their templates at build time (A95: moved here from the repo root)
  check-bundle-size.mjs dev-only /app/-surface JS size budget (840 KiB ceiling as of A223) — fails the build if the app bundle crosses it (A96); `npm run size-budget`
  check-deploy-contract.mjs  A99 deploy-contract + version-classification guard (CI-load-bearing) — every
                        static/_redirects/sitemap.xml/canonical/robots.txt target resolves in dist/, and
                        every tracked src/+static/ path is classified by bump-version.mjs; `npm run check-deploy`
  check-mermaid.mjs     docs-only mermaid drift gate (CI-load-bearing) — parses every ```mermaid fenced block
                        under docs/ with Mermaid's own parser (reuses the e2e job's Playwright chromium);
                        `npm run check-mermaid`
  test-*.mjs            the 18-suite CI test suite (adapters / auth / version / flags / tax / demostore /
                        workspaces / curveandreport / compute / accounts / email / econ / crypto / sync /
                        cloudsync / cloudsync-store / modlayout / subscription)
/e2e/                   Playwright render/E2E specs (dev-only — R19 Tier A)
/dist/                  Vite build output (GITIGNORED) — the artifact Cloudflare Pages serves (A26)
vite.config.mjs         Vite multi-page build config (root:src, publicDir:static, 15 HTML entries → dist/)
.node-version           pins Node 22 for the Cloudflare Pages build
package.json            deps manifest — Vite + Tailwind v4 + shadcn-svelte/bits-ui + @lucide/svelte + dev tooling (pinned, lockfiled)
components.json         shadcn-svelte CLI config (`npx shadcn-svelte add <name>`)  ·  ADR-002
eslint.config.mjs       ESLint flat config  ·  .prettierrc.json  Prettier  ·  tsconfig.json (tsc: src/lib/**/*.ts except src/lib/components) + tsconfig.svelte.json (svelte-check: src/app + src/site + src/lib/components + src/dev) + tsconfig.functions.json  ·  playwright.config.mjs  e2e
svelte.config.js        vitePreprocess — enables <script lang="ts"> in components (A61)
LICENSE                 proprietary — all rights reserved
```

## Data flow

```
loadRefData()   manifest.json → brokers/exchange-fees/feeds/state-tax (cache-busted by hash)
CSV text
  → intake gates       checkCsvFile/checkCsvText — type/size/binary/row caps (A177); an .xlsx
                       (ATAS X) file routes through xlsx.ts's atasXlsxToCsv() first (F52)
  → Adapters.detect()  sniff header → platform (per-adapter minScore gate — A178)
  → Adapters.parse()   platform adapter → normalized trades (fills go through pairFills())
  → reconcileImport()  cross-export authority/derived-peer resolution drops phantom fills-derived
                       round trips when a same-family closed export corroborates a window (A219)
  → Store.addTrades / getAllTrades   delta-merge + persist (IndexedDB); duplicates MERGE
                       provenance + ENRICH missing fields; the file record + raw text persist
                       alongside (F37), trades carry fileIds
  → applyFilters()  active filter set (per-file include/exclude applies at load) → working list
  → compute()       trades → metrics (PnL, win rate, drawdown, curve, expectancy, …)
  → costModel()     metrics + setup inputs → commissions, subscriptions, tax, take-home
                    (a trade's REAL CSV commission wins — A208; else the modeled rate, dated
                    per trade — F30, at the trade's per-file broker override — A211)
  → Svelte app      → reactive components render cards / curve / calendar / advanced / break-even
```

The full prose walkthrough (intake → adapters → Store/IndexedDB object stores → ref data →
recompute → modes → the no-egress guarantee) is [docs/data-flow.md](docs/data-flow.md).

The compute pipeline (`adapters`/`compute`/`costModel`) is the **pure-logic core**, reused
verbatim (A29). The Svelte app drives it: reactive state lives in runes (`$state`/`$derived`)
inside the components, and `App.svelte` resolves the active `Store` (real IndexedDB for app/staging via
`Entitlements.storeFor()`, in-memory `DemoStore` for demo) once and — **on every non-demo surface** — wraps it in
a `CloudStore` (F63; inert until a cloud-tier user opts in + unlocks) before **prop-drilling** it into the rune-module factories and down to
screens/parts (no `context()` seam), and `PAGE_MODE` (with `isDemo`/`isStaging` locals derived from
it) adapts per surface. `mount()` happens first (`main.ts`); then boot: `loadRefData()` →
`Store.init()` → setup/session restore inside `loadData()`
(app seeds nothing → empty state shows first-run onboarding; demo seeds in-memory; staging seeds its
DB first).

**The sync branch (F58–F63; live on prod + staging, opt-in `cloud`-tier — never demo).** On every
non-demo surface, `CloudStore` wraps the local `Store`:
**reads** stay local (compute never touches the network); each **write** delegates to IndexedDB then
enqueues a debounced encrypted **push** (`crypto` encrypt → `/api/sync/push`); on connect/unlock/focus a
**pull** decrypts remote records and re-merges them through the *existing* `importAll` trust boundary
(trade content-hash union, journal/meta LWW, deletes via F58 tombstones). Keys (account IK + per-workspace
DEKs) live in memory only, unwrapped once per session by `vault.svelte.ts`. Only ciphertext + blinded ids
cross the wire — the server can't decrypt. `local`-tier + un-synced workspaces + demo never sync.

The `core.ts` event bus survives the cutover (emitters re-wired in A151 — the CH16 cutover had
dropped them all): `loadRefData` emits `refdata:loaded`, and the shared actions fire `app:ready`
(first, at boot start — A195), `data:loaded`, `data:imported`, `note:saved`, `trade:deleted`,
`backup:created`, `data:erased`, `filter:saved`, `filter:applied`, and `tab:created` over an
`EventTarget` for any listener (the Dashboard's ActivityTerminal subscribes); `loadEconEvents`
emits `econ:loaded`. The bus keeps a
50-entry replay buffer (`busLog()`, A188) so late subscribers backfill the boot events; it is
otherwise a no-op with no subscriber.

## Adding things

- **A platform adapter:** one object in `src/lib/core/adapters.ts` (`sniff` + `toTrades` +
  `minScore`, A178) plus a fixture in `scripts/test-adapters.mjs`. Every adapter normalizes to the
  same trade shape `{ time, date, pnl, symbol, root, side[, qty, entryTime,
  exitTime, holdMs, commission] }` so `compute()`/`costModel()` never change (fills exports
  populate `Fill.commission` when the export carries real costs — A208; `fileIds` provenance is
  stamped at import, not by adapters).
- **A rate change:** edit the relevant `data/*.json`, then run
  `build-manifest.mjs`. No app code changes.
- **A new feature:** add/extend a Svelte screen/part in `src/app/`; it ships to all three
  surfaces at once (no promotion step since the A33 cutover). Gate per surface in the component
  (`PAGE_MODE`/`isDemo`/`isStaging`) and keep demo non-mutating. See the checklist in
  [docs/architecture.md](docs/architecture.md#building-a-feature-all-surfaces-share-one-spa).

## Deployment

Cloudflare Pages: `npm run build` emits `dist/` (Vite) and Pages serves it; `/functions/*` are
edge functions automatically. Build command `npm run build`, output dir `dist` (ADR-001/A26).
