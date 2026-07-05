# R20 — gridstack.js vs custom for the resizable tiling dashboard grid

**Date:** 2026-07-05 · **Item:** R20 (REVIEW / AUDIT, gates F29) · **Surveyed:** gridstack v12.6.0 (2026-04-08), svelte-grid, svelte-grid-extended, custom-on-existing-primitives

## Verdict: CUSTOM

Build F29 phase 1 as a minimal custom grid on the primitives we already own (`styleProps` CSSOM
action + `modOrder`/`modKeyFor` + Store.local + the A186 staged-save model). Gridstack **passes**
the CSP gate (v12 is CSSOM/CSS-variable based — see below), so this is *not* a disqualification on
the make-or-break test; it loses on bundle size (~83 KiB minified vs ~22 KiB headroom), DOM
ownership (fights Svelte's keyed `{#each}` + `animate:flip`), and keyboard a11y (none built in).
Phase 1 needs none of gridstack's 2-D packing engine. Revisit gridstack only if a later phase
demands true 2-D drag-anywhere + collision/compaction — the CSP finding below stays valid for that
future decision.

## 1. CSP verdict (`style-src 'self'`): gridstack v12+ is CSP-CLEAN

Verified against the v12.6.0 source (`src/gridstack.ts`, `src/utils.ts`) and the published dist:

- **Geometry is applied via the CSSOM**, which `style-src` does not gate. `_writePosAttr` assigns
  `el.style.top = \`calc(${n.y} * var(--gs-cell-height))\``, `el.style.width = \`calc(${n.w} *
  var(--gs-column-width))\``, etc.; the container gets
  `this.el.style.setProperty('--gs-column-width', …)` / `--gs-cell-height` / `--gs-item-margin-*`.
  Drag/resize helpers (`Utils.addElStyles`, `removePositioningStyles`) also use `el.style[prop] =`
  / `style.removeProperty` — all CSSOM.
- **No injected `<style>` element.** v12.0.0 "removed dynamic stylesheet and migrated to CSS vars"
  (CHANGES.md); the old `Utils.createStylesheet`/nonce machinery is gone — `grep` of the v12.6.0
  dist finds zero `createElement('style')`, zero `setAttribute("style"`, zero `nonce`.
- The static `dist/gridstack.min.css` (~3.8 KiB) would be imported through Vite into our linked
  stylesheet → served from `'self'`. Compatible.
- **Caveat:** this is true only for **v11+ (fully v12+)**. v10 and earlier injected a dynamic
  stylesheet for cellHeight/columns (hence the old `nonce`/`styleInHead` options) and would violate
  our CSP. Any future adoption must pin ≥ v12.

## 2. Dependency discipline / size budget

- Current app JS total: **617.6 KiB of a 640 KiB budget → ~22.4 KiB headroom** (A96 counts
  *uncompressed minified* bytes of every reachable chunk).
- gridstack 12.6.0: `dist/gridstack-all.js` (core + engine + built-in drag/resize) = **84,793 B ≈
  82.8 KiB minified** (~22.4 KiB gzip). The ESM sources Vite would bundle (gridstack + engine +
  utils + dd-*) total ~280 KiB pre-minify — same ballpark after minification. There is no
  drag-less tree-shake that helps: the engine + dd layer *is* the value proposition.
- → gridstack alone is **~3.7× the remaining headroom**; adoption forces a deliberate budget raise
  of ~640 → ~720 KiB (+13%) for a P3 feature whose phase-1 scope doesn't need the engine.
- Otherwise clean: MIT, **zero runtime dependencies**, actively maintained (12.6.0 released
  2026-04); dist contains **no `fetch`/XHR/`sendBeacon`/websocket** — no telemetry, no egress.
  Pinnable + auditable.

## 3. Svelte-ecosystem alternatives: none viable

- **svelte-grid** (vaheqelyan): last publish **2023-08**, Svelte 3-era. Abandoned.
- **svelte-grid-extended**: last publish **2024-06**, peer dep `svelte: ^4.0.0` — no Svelte 5/runes
  support, effectively unmaintained. (It also positions via inline `style` attribute templating in
  places, which would need re-verification we'll never do — moot.)
- Gridstack ships official Angular/React/Vue wrappers but **no Svelte wrapper**; we'd write and own
  the integration glue ourselves either way.

## 4. Integration with the current substrate

Gridstack **owns the DOM**: it absolutely positions `.grid-stack-item` children, moves nodes on
drag/compaction, and (v11+ `renderCB`) prefers to *create* the widget wrapper divs itself. Our
dashboard is a Svelte keyed `{#each modOrder as key (key)}` with `animate:flip` + `transition:fade`
(Dashboard.svelte ~line 1152), reorder/hide/re-add driven by `commitModules()` → the `modules` prop
echo → the A186 staged-save (dirty asterisk per DashTab, `saveTabLayout()` persists via
`modKeyFor(tabId)` Store.local keys, workspace templates snapshot the same payload). Wiring
gridstack in means: two owners of layout truth (gridstack node x/y/w/h ⇄ `modOrder`), dropping
`animate:flip` (gridstack animates its own moves), `makeWidget`/`removeWidget` bookkeeping inside
`$effect` on every add/hide/tab-switch, and serializing gridstack `change` events back into the
staged model. All doable — none of it free, and the failure mode (Svelte re-render vs gridstack
DOM move racing) is exactly the class of bug that's hardest to e2e.

The custom path is the substrate we have plus one axis: a 12-track CSS grid container, per-module
`grid-column: span N` applied via `styleProps` (CSSOM, CSP-clean), native CSS-grid auto-flow as the
"reflow", keyed each + flip untouched.

## 5. Mobile + a11y

- **gridstack:** touch works (dd-touch); responsive `columnOpts.breakpoints` can force 1-column on
  narrow. **Keyboard move/resize: none** — long-standing open request (issue #830 "Accessibility
  Review Required": can't operate without a mouse); minimal ARIA. We'd build the keyboard layer
  ourselves *on top of* an 83 KiB dependency.
- **custom:** the existing DropdownMenu move-up/down is already keyboard-operable; the resize
  handle is ours to spec — `role="separator"` + `aria-valuenow` + arrow-key span stepping costs a
  few lines. Mobile degrade = force span 12 below `sm` (the `MediaQuery` instance is already in
  Dashboard.svelte, A200).

## F29 phase-1 scope (concrete build plan)

Target: `src/app/screens/Dashboard.svelte` + `src/app/App.svelte`. Staging-gated (`isStaging`)
until promoted. Est. +3–5 KiB JS.

1. **Layout payload v2.** Extend the persisted shape under `modKeyFor(tabId)` from `string[]` to
   `{ key: string; span: number }[]` (span 1–12, default 12). One-shot migration at read (array of
   strings → `{key, span:12}`); `validKeys` becomes `validLayout`. Workspace templates and
   `DEFAULT_MODULE_KEYS` snapshots migrate identically. `onmoduleschange(order)` becomes
   `onlayoutchange(layout)` (or carries the richer array) — the App echo/`lastModKey` re-seed guard
   keys on the serialized payload.
2. **Grid render.** Wrap the module `{#each}` in `grid grid-cols-12 gap-*`; each module wrapper
   gets `use:styleProps={{ 'grid-column': 'span ' + span }}` (CSSOM — no inline `style=""`). Keep
   `(key)` keying, `animate:flip`, `transition:fade`. Below `sm` (existing `isNarrow` MediaQuery):
   render without spans → current single-column stack, handles not rendered.
3. **Resize handle.** A slim right-edge handle per module (staging only): Pointer Events +
   `setPointerCapture`; on move, rAF-throttled conversion of `dx` → nearest track count using the
   container's measured track width; live-preview the span via `styleProps`; on release, commit the
   snapped span through `commitModules`-equivalent → stages behind the DashTabs dirty asterisk;
   Save persists (A186). `compute()`/`costModel()` untouched — layout only.
4. **Keyboard + a11y.** Handle is focusable, `role="separator"`, `aria-orientation="vertical"`,
   `aria-valuemin/max/now` (1/12/span); ArrowLeft/Right steps one track (same staged commit). Add
   width presets (Full / ⅔ / ½ / ⅓) to the existing module DropdownMenu as the discoverable
   no-pointer path.
5. **Guards + tests.** Demo: resize stages in-memory only (DemoStore.local map — already
   non-persisting by construction); confirm no new write path needs a `disabled`. e2e: drag-resize
   snaps + persists on staging, layout-v1 key migrates, mobile stays single-column, no literal
   `style="` appears in `src/` (existing grep gate). Size budget stays under 640 KiB.

Out of scope (later phases, separate items): height resize, 2-D drag placement, drag-between-cells,
cross-row compaction — the point where the gridstack decision gets re-opened.

## Proposed backlog items

- **id TBD** — *F29 phase 2: dashboard grid height resize + 2-D placement (re-open gridstack)* —
  FEATURES · P4 · large. After phase 1 ships and proves per-tab `{key,span}[]` layouts, evaluate
  adding height resize and free 2-D drag placement. This is the point where a packing/collision
  engine earns its weight: re-open the gridstack decision using R20's standing CSP verdict
  (v12+ is CSSOM-clean; pin ≥ v12) against the then-current size budget, vs porting just
  `gridstack-engine.ts` (~53 KiB unminified, MIT, DOM-free) as a vendored pure-logic module.
- **id TBD** — *Extract a reusable `trackResize` action from the F29 phase-1 handle* —
  REFACTOR · P4 · small. Once the Dashboard resize handle works, extract the pointer+keyboard
  track-snapping logic into a `src/app/lib/` action (sibling of `styleProps`) so Analytics (A214
  interactivity work) and future screens can make their modules width-resizable without copying
  the rAF/pointer-capture/aria plumbing. Keep it CSP-clean and dependency-free.
