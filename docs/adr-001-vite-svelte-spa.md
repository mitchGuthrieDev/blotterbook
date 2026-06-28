# ADR-001 — Adopt a Vite build + Svelte SPA for the app surface

**Status:** accepted 2026-06-27 · **supersedes** the Tier B *deferral* in
[`build-step-decision.md`](build-step-decision.md) (R19) and resolves backlog **A24**.

> This is the project's first Architecture Decision Record. Format: Context → Decision →
> Consequences, followed by the phased migration plan and the backlog items it spawns. Later
> structural decisions should follow as `adr-002-…`, etc.

## Context

The pillars (see [`architecture.md`](architecture.md#design-pillars)) were written when
Blotterbook was a small, lightweight personal tool. Two things have changed:

1. **The product is going commercial** — an online futures analytics dashboard the owner intends
   to monetize (donations now; E2E-encrypted cross-device sync later).
2. **The roadmap now needs capabilities hand-rolled vanilla DOM is poorly suited to** — trade
   replay charts (R11), a spawnable module menu (R12), realtime resizable/snapping modules (R13),
   and a full virtualized Trade Blotter table (F23).

Under the old framing, "no dependencies" and "no build step" read as purity rules. For a commercial
product with this roadmap they are a velocity tax with no proportional payoff. Meanwhile the *real*
differentiator — **local compute / data never leaves the browser** — only grows in value: for a tool
handling traders' P&L and tax data, "we cannot see your trades" is a moat most competitors can't
claim.

The R19 decision (`build-step-decision.md`) deferred the shipped-output build (Tier B / A24) behind a
trigger. **That trigger has now fired:** building the replay/complex-UI features requires a
charting/layout library and a component model, which require a bundler. This ADR records the new
direction.

## Decision

### 1. Re-rank the pillars

- **HARD (affirmed, strengthened):** *Compute happens locally — no trade data ever leaves the
  browser.* This is the product moat, not a purity rule. It survives commercialization intact (the
  paid sync tier stays zero-knowledge / E2E-encrypted). **No telemetry, no analytics, no trade-data
  egress — ever — regardless of what dependencies we add.**
- **RELAXED → policy:** *No runtime dependencies* becomes **"minimal, pinned, audited
  dependencies; the supply chain is a security control."** Dependencies are now allowed where they
  earn their weight, under the discipline in §3.
- **DROPPED (as a constraint):** *No build step.* A shipped-output build is now adopted. It was
  already half-relaxed by R19 Tier A; runtime deps + a framework make it mandatory.

### 2. Tooling: Vite + Svelte

- **Vite** is the build tool and dev server (multi-page build — the marketing site stays
  static-rendered; only the `/app/` surface becomes a framework app).
- **Svelte 5** (runes API — `$state`/`$derived`/`$effect`/`$props`) is the UI framework, chosen
  for its compile-away / minimal-runtime model, which fits the "keep it lean and optimized" goal
  far better than a heavier runtime. **Decision: Svelte 5, runes-first** — new components use runes
  (not the legacy `export let` / reactive-`$:` syntax), so the codebase starts on the current,
  long-term API rather than migrating later. The complex-UI backlog items (R11/R12/R13/F23) are the
  concrete driver.
- **Staging is the proving ground.** Svelte lands on `app/staging.html` first; prod + demo stay
  vanilla until staging proves out, then migrate (consistent with the existing CH16 staging→prod
  model).

### 3. Dependency policy (replaces the zero-dep stance; see guardrail A28)

- **Earn-its-weight bar:** add a dependency only when hand-rolling it is materially worse. Keep
  writing small utilities by hand (`assets/util.js`). Heavyweight enablers (charting, layout, the
  framework itself) qualify; date/utility micro-libs do not.
- **Supply chain is a security feature** (it must be, for a privacy product handling financial
  data): pinned versions + committed lockfile, `npm audit` in CI, Subresource Integrity / strict CSP
  on shipped bundles, and a minimal dependency surface. Consider vendoring the few critical libs so a
  registry compromise can't silently reach users.
- **The local-compute pillar gates every dependency:** reject any dep (or dep feature) that phones
  home, ships telemetry, or could exfiltrate trade data.

### 4. Preserve the pure-logic core (see guardrail A29)

The framework rewrite touches the **view layer only**. The pure-logic modules —
`app/adapters.js`, `compute()`, `costModel()`, the Section-1256 tax model, `app/store.js` (`Store`),
and `assets/util.js` — are framework-agnostic, already covered by the node test suites, and are the
hard-won value. They are imported into Svelte components **verbatim**, not rewritten. The `Store`
seam (A4) was designed for exactly this kind of swap.

## Consequences

**Gains**

- A component model + reactive state that fits R11/R12/R13/F23 (declarative components, lifecycle,
  ecosystem: `lightweight-charts` for replay, grid-layout libs for snapping modules, virtualization
  for the blotter).
- Content-hashed bundles, minification, and the ability to drop `style-src 'unsafe-inline'` →
  **nonce/hash CSP (S18)** rides along with the build.
- Modern DX (HMR) for the larger UI work ahead.

**Costs / risks (and mitigations)**

- **Reverses the deploy contract (A18)** — root is no longer the web root; source ≠ shipped
  artifact; a Pages build command appears. This is the single riskiest step. *Mitigation:* there are
  **no users yet**, so it's done all-at-once across the full coupled-path map, gated by the Playwright
  e2e suite (every surface boots clean).
- **Build deps now produce shipped bytes** — a supply-chain path *into* user-facing assets that
  didn't exist before. *Mitigation:* the §3 dependency policy (pinned/audited/minimal/SRI), and the
  local-compute pillar as a hard gate.
- **"View-source = what runs" transparency is reduced** (bundled/minified output). Accepted as a
  worthwhile trade for a commercial product; the repo stays source-published.
- **SEO / instant-load for marketing pages** must not regress. *Mitigation:* the marketing site
  (`index/howto/roadmap/changelog/legal/admin`) stays static-rendered via Vite's multi-page build —
  it is **not** pulled behind the SPA shell.
- **Demo-never-persists invariant** must survive the rewrite (`DEMO_MODE` guards + disabled
  controls). Carried as an explicit acceptance check in the Svelte migration.

## Migration plan (phased)

Sequencing follows the owner's call: **Vite infra (full deploy-contract reversal) all at once
first**, then Svelte on staging, then outward.

### Phase 0 — Decisions & docs *(this change)*

ADR written; pillars re-ranked; backlog items spawned (A26–A29); R19 doc + A24/A25 annotated.

### Phase 1 — Vite build infrastructure + deploy-contract reversal *(A26)* — **IMPLEMENTED**

Code stays vanilla; this phase is pure infrastructure so the scary part is isolated from logic risk.
What actually shipped (and where it differs from the pre-Vite A18 sketch):

- **Vite multi-page build** (`vite.config.mjs`, `vite@8.1.0` pinned): all nine HTML entries — the
  marketing pages **and** `app/{app,demo,staging}.html` — bundled to **`dist/`** (the Pages output
  dir). Vite fingerprints the JS/CSS it bundles and rewrites the references in the HTML.
- **Deploy-contract reversal via `dist/`, not a literal `public/` source dir.** A18 was written
  pre-Vite and guessed at a "`public/` output-dir split"; the Vite-native equivalent is "source at
  root → build to `dist/` → Pages serves `dist/`." `functions/`, `scripts/`, `partials/`, and tooling
  stay at the repo root (unserved). **No source files were moved** — so the `build-manifest` /
  `bump-version` path assumptions and the README image refs are untouched.
- **URLs are preserved 1:1**, which is the key de-risker: because every entry keeps its path and the
  output mirrors it, the coupled-path map from A18 (absolute `/app//assets//data` refs, canonicals,
  `og:image`, `sitemap.xml`, `robots.txt`, `_redirects`) **did not need editing** — those references
  keep resolving against the identical URL structure. Only the *deploy mechanism* changed.
- **Verbatim-static files** Vite doesn't bundle (`data/*.json`, `_headers`, `_redirects`,
  `robots.txt`, `sitemap.xml`, `assets/og-image.png`) are copied into `dist/` by
  **`scripts/copy-static.mjs`**, wired into `npm run build`. `data/*.json` stays runtime-fetched +
  cache-busted by `build-manifest.mjs` (retained — a rate change is still "edit JSON, rebuild
  manifest, no app rebuild").
- **CSP `style-src 'unsafe-inline'` was *not* dropped in this phase — deferred to A27** (see note
  below). The build itself unlocks the tightening, but the vanilla `/app/` surface still carries
  inline styles that the Svelte rewrite removes naturally; doing it now would be throwaway work.
- **`dist/` is gitignored**; the CI drift gate (`build-includes` + `build-manifest` committed) still
  proves the build-time tooling didn't leave committed sources stale. Playwright now builds and
  serves `dist/` so it tests exactly what Pages serves.
- **Gate (met):** `npm test` (lint/typecheck/format/unit) green; `npm run test:e2e` green on every
  surface against the built `dist/`; `npm run build` emits a complete `dist/`; no committed-file drift.

#### Cloudflare Pages settings (manual — dashboard, not in-repo)

These must be set on the Pages project for the new build to deploy (they are the only steps not
captured by the repo changes):

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Unset `SKIP_DEPENDENCY_INSTALL`** (it was `1` under R19 so devDeps never ran at deploy; the build
  now needs them) — this reverses the A25 deploy posture. `.node-version` pins Node 22 for the build.
- `functions/` continues to be picked up from the repo root automatically.

### Phase 2 — Svelte on the staging surface *(A27)* — **CORE DASHBOARD COMPLETE**

- Add `svelte` + `@sveltejs/vite-plugin-svelte`.
- Rewrite the **staging view layer** as Svelte components; mount into `app/staging.html`.
- Import the pure-logic core **verbatim** (A29). Prod + demo stay vanilla.

What shipped so far (the foundation + first vertical slice):

- `svelte@5.56.4` + `@sveltejs/vite-plugin-svelte@7.1.2` (pinned); `svelte()` added to the Vite
  plugins (a no-op for the vanilla entries). Svelte 5 **runes** (`$state`/`$derived`/`$props`).
- `app/staging.html` is now a hand-authored **Svelte mount** (no `partials/` include markers, so
  `build-includes` leaves it alone). The S14 `?k=` token strip + `noindex`/`no-referrer` are
  preserved.
- `app/staging-svelte/` — `main.js` (`mount()` + side-effect `util.js` import for S14), `App.svelte`
  (boot: `loadRefData` → isolated `Store.init` → seed-if-empty → `compute()`), and
  `Overview`/`StatCard` components rendering the computed metrics. All logic is **imported
  verbatim** (A29); the only new logic-side change is extracting `demoCSV` into `app/sampledata.js`
  (re-exported by `data.js`) so the staging bundle doesn't drag in the vanilla view layer.
- Toolchain: `.svelte` excluded from Prettier (no plugin — A28), `app/staging-svelte/**` excluded
  from the `tsc` JS typecheck (can't resolve `.svelte` imports), scoped component CSS.
- **Verified:** `npm test` + `npm run test:e2e` green; staging boots into the Overview with real
  computed metrics and the seeded data persists across reload (isolated-DB guarantee).

All major panels are now live in Svelte on staging: Overview, performance equity curve, trading
calendar, **day-notes journal**, advanced statistics, **break-even/cost**, **filters + scope**,
**manage-data modal + per-trade editor**, and the **activity terminal**. Each reuses the pure-logic
core verbatim (A29); the cost panel reuses `costModel()` as-is by rendering the DOM inputs it reads
(the `costModel(inputs)` refactor stays deferred to Phase 4 per the owner's call). Every slice is
covered by the Playwright staging spec.

Deferred sub-features (polish, not blockers — picked up during/after Phase 4): the equity curve's
gross/net/take-home overlays + hover tooltip + keyboard a11y + note dots; per-day tags/screenshots
and per-trade screenshots in the editors; session/tag filters + saved-filter views; and the
`style-src 'unsafe-inline'` CSP drop (S18), which lands once all surfaces are de-inlined.
- **CSP tightening (S18) starts here.** Svelte's scoped component CSS + CSSOM (`setProperty`)
  eliminate the inline `style="…"` usages on the staging surface as a side effect of the rewrite.
  Dropping `style-src 'unsafe-inline'` *globally* needs every surface de-inlined (prod/demo via
  Phase 4, plus moving the marketing pages' inline `<style>` into linked CSS), so the final
  `style-src 'self'` flip lands when the last inline style is gone — S18 stays the tracking item.
- **Gate:** staging reaches feature parity with the vanilla app; e2e green; isolated-IndexedDB +
  staging key-gate behavior unchanged.

### Phase 3 — Build the complex features Svelte-native on staging

Trade replay (R11, `lightweight-charts`), module menu (R12), resizable/snapping modules (R13),
Trade Blotter (F23) — built as Svelte components behind the staging gate, promoted via CH16.

### Phase 4 — Migrate prod + demo to Svelte (SCOPE)

Goal: `app/app.html` + `app/demo.html` become Svelte mounts of the **same** app the staging surface
uses, the vanilla view layer is deleted, and the pure-logic core is preserved. Marketing pages stay
static. The hard invariant: **demo never persists.**

#### 4a. Unify into one mode-aware Svelte app

Today `app/staging-svelte/` is staging-only. Make it the **shared** app (rename to `app/svelte/`)
that adapts by `PAGE_MODE` (`document.body.dataset.mode`), mirroring how the vanilla `app/*.js` are
shared across surfaces:

- **app** — IndexedDB `Store` (`blotterbook` DB); the landing/setup → CSV-load → Start flow (not
  needed on staging, which seeds); restore last session on boot.
- **demo** — an **in-memory `DemoStore`** implementing the exact `Store` interface (A4) backed by
  Maps, so writes go nowhere persistent; trade-mutating controls additionally `disabled`/hidden. The
  Store seam was designed for exactly this swap — pick the implementation by mode at boot.
- **staging** — isolated `blotterbookStaging` DB + seed + key-gate (unchanged).

All three HTML files become hand-authored Svelte mounts (like `staging.html`), each with its
`data-mode`. `build-includes` no longer assembles the app shell.

#### 4b. Finish prod-parity features (absorbs the A27 "deferred polish") — **DONE (A32)**

> All items below shipped on `claude/phase4-prod-demo-svelte`: the `costModel(inputs)` refactor,
> curve interactivity + gross/net/take-home overlays (via the extracted pure `app/curveseries.js`,
> shared with vanilla `render.js`), session/tag/saved/day-of-week filters, journal + per-trade
> screenshots (which also fixed a `$state`-proxy→IndexedDB clone bug and closed a `saveTradeMeta`
> `validShot` gap), and the app-mode landing/CSV flow. Verified by the unit + e2e suites.


Staging was allowed to skip these as a proving ground, but prod must **not regress** below today's
vanilla app — so the deferred items become Phase-4 parity requirements, not optional polish:

| Deferred item | Phase-4 disposition |
| --- | --- |
| Equity-curve overlays (gross/net/take-home), hover tooltip, keyboard a11y, note dots | **Port — required** (prod has them today). The curve↔calendar day cross-link too. |
| Per-day tags + screenshots; per-trade screenshots | **Port — required** (vanilla journal/editor have them; screenshots go through the `Store.validShot` allow-list, S15/S18). |
| Session filter + tag filter + saved-filter views | **Port — required** (prod filter bar has them). |
| Landing / setup / CSV-load gate flow | **Build — required for prod** (staging seeds instead). |
| `costModel(inputs)` refactor | **Do here** — replace the A27 DOM-input reuse with a clean param signature in `core.js` (behavior-preserving; defaults retained), then drop the DOM controls the cost panel renders only to feed it. |
| `style-src 'unsafe-inline'` drop (S18) | **Finish here** — Svelte scoped CSS removes the app inline styles; also move the marketing pages' inline `<style>` into linked CSS, then flip `_headers` to `style-src 'self'`. |

#### 4c. Cut over + delete the vanilla view layer

Switch the Pages-served app to Svelte, then **delete** the vanilla view modules
(`render.js`, `ui.js`, `datamanager.js`, `widgets.js`, `export.js`, `main.js`, the view-only parts of
`data.js`) and the `partials/app-*.html`. **Keep** the pure-logic core (`adapters.js`,
`compute`/`costModel` in `core.js`, `store.js`, `sampledata.js`, `util.js`, `types.js`) and the
node test suites that cover it. Update `build-includes.mjs` (drop the app-shell assembly; keep
nav/footer for info pages) and `bump-version.mjs` (the app surfaces are now Svelte mounts).

#### 4d. Then the source-tree reorg (A30)

With all surfaces Svelte, do the reorg A26 unblocked: separate served source from tooling, split the
mixed `assets/` (bundled JS vs verbatim static), retire `copy-static.mjs` for Vite's native
`publicDir`, and adopt a Svelte-shaped `components/lib/` layout. All-at-once lockstep (path prefixes +
imports); URLs stay 1:1.

#### Verification gate

- **app:** landing → load a CSV → Start → dashboard renders → reload restores from IndexedDB.
- **demo:** explore freely; **assert nothing is written to IndexedDB** (an e2e check on the DB) and
  trade-mutating controls are disabled.
- **staging:** unchanged (isolated DB + key-gate).
- Full Playwright suite green; `style-src 'self'` with no console CSP violations.

#### Risks

Demo-never-persists is the top risk → mitigated by the `DemoStore` swap + disabled controls + an
explicit e2e DB assertion. The prod landing/CSV flow is net-new UI. The vanilla-view deletion is
large → do it only after the Svelte app is proven on prod. SEO is unaffected (marketing stays static).

## Spawned backlog items

- **A26** — Vite build infrastructure + deploy-contract reversal (Phase 1).
- **A27** — Adopt Svelte on the staging app surface (Phase 2).
- **A28** — *(guardrail)* dependency policy: minimal / pinned / audited; supply chain as a security
  control; local-compute pillar gates every dep.
- **A29** — *(guardrail)* preserve the pure-logic core verbatim through the framework migration.
- **A30** — source-tree reorg (`src/` + static split; retire `copy-static.mjs` for `publicDir`),
  unblocked by A26, deferred to Phase 4 (step 4d).
- **A31** — Phase 4a: unify the staging Svelte app into one mode-aware app (`app`/`demo`/`staging`);
  add the in-memory `DemoStore` so demo never persists.
- **A32** — Phase 4b: finish prod-parity on the Svelte app (curve overlays/hover/a11y/note-dots;
  journal tags+screenshots; per-trade screenshots; session/tag/saved filters; landing/CSV flow; the
  `costModel(inputs)` refactor). Absorbs the A27 deferred items.
- **A33** — Phase 4c: cut prod + demo over to Svelte and delete the vanilla view layer; update
  `build-includes`/`bump-version`; finish S18 (`style-src 'self'`).

R11/R12/R13/F23 keep their existing IDs and become Phase 3 work (now unblocked by the framework).
