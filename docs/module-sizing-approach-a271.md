# A271 — build-approach recommendation: Small/Medium/Large module sizing + snap grid

**Date:** 2026-07-07 · **Item:** A271 (FEATURES · P2 · large — the resizable-modules refactor;
expands/supersedes F29 phase-1) · **Blocks:** A272 · **Prior art:** [`docs/grid-eval-r20.md`](grid-eval-r20.md)

This is the **research/recommendation** deliverable A271's prompt requires ("RESEARCH the build
approach first … record a short recommendation before the refactor"). It is not the refactor. It
re-runs the R20 library-vs-custom comparison for A271's larger scope and fixes the four design
contracts the refactor will implement.

## Verdict: CUSTOM (again) — extend the keyed-each + `styleProps` substrate

Build A271 on the primitives we already own — the keyed `{#each modOrder}` + `animate:flip` +
`transition:fade` render, the `styleProps` CSSOM action (CSP-clean geometry, A55), `Store.local` +
the A186 staged-save model, and the existing `ModuleCarousel` part. **Do not** add gridstack,
muuri, or interact.js. R20's CUSTOM verdict for F29 phase-1 holds *more* strongly here, not less:
A271's resize is **snap-to-three-discrete-states**, which is *simpler* than R20's continuous 1–12
span drag, and none of these libraries' actual value proposition (a 2-D packing/collision engine, or
a DOM-owning drag layer) is needed to snap a module to one of three preset sizes.

## 1. Dependency vs custom for the S/M/L snap grid + corner drag-resize

Re-running R20's comparison for A271's bigger scope (v12+ figures; sizes are uncompressed minified):

| Option | CSP (`style-src 'self'`) | Bundle | DOM ownership / Svelte fit | a11y | Verdict |
|---|---|---|---|---|---|
| **gridstack v12+** (~83 KiB) | CLEAN (CSSOM + CSS vars — R20 §1, still valid; pin ≥ v12) | ~83 KiB min / ~22 KiB gz | Owns the DOM: absolutely-positions `.grid-stack-item`, moves nodes on drag/compaction, `renderCB` wants to *create* wrappers — fights our keyed `{#each}` + `animate:flip`; two owners of layout truth (`node.x/y/w/h` ⇄ `modOrder`) | Keyboard move/resize: **none** (issue #830) — we'd build the a11y layer *on top of* 83 KiB | **No** — its 2-D packing engine is dead weight for 3 discrete snap states |
| **muuri** (~28 KiB + web-animations dep) | RISK: transform-driven layout, DOM-owning like gridstack; maintenance slowed; no Svelte 5 wrapper | ~28 KiB + polyfill weight | Same DOM-ownership conflict as gridstack, without gridstack's CSSOM-clean guarantee | Minimal; no built-in keyboard resize | **No** |
| **interact.js** (~50 KiB) | CLEAN (emits pointer gestures; you apply transforms — doesn't inject `<style>`) | ~50 KiB min | Does *not* own the grid/DOM — it's a pure drag/resize/gesture layer with snapping/restriction. Best-fitting of the three | Still no keyboard path; we own the grid + Svelte integration + a11y regardless | **No** — 50 KiB to replace ~60 lines of Pointer Events + rAF we already know how to write (R20 §5); snapping to 3 fixed targets is `nearest-of-[2,6,12]`, not a physics problem |
| **CUSTOM** (extend current substrate) | CLEAN by construction (`styleProps` CSSOM; class-based min-heights — no literal `style=`) | **~+4–8 KiB** app code | Keyed `{#each}` + `animate:flip` untouched; one axis added (`grid-column: span N` via `styleProps`); CSS-grid auto-flow is the reflow | DropdownMenu size radio (keyboard) + `role="slider"` handle with `aria-valuetext` — ours to spec, few lines | **YES** |

**Bundle headroom.** R20's size argument was already weakened post-A223 (budget raised 640 → **840
KiB** deliberately; R20's own note flags this). A271 custom adds ~4–8 KiB of app code — a rounding
error against the ceiling. Any of the three libraries would re-open a budget conversation
(gridstack ≈ 10% of the whole budget) for a P2 layout feature whose scope needs none of their engine.
The DOM-ownership and drag-semantics reasoning — the *load-bearing* half of R20 — is unaffected by
the budget raise and still disqualifies the libraries.

**Fit with the existing substrate is the deciding factor.** A271 wants richer per-module content per
size and animated re-snap — both are *native* to our keyed-each + `animate:flip` + snippet render,
and *actively fought* by any library that positions children itself. Custom keeps a single owner of
layout truth (the persisted `{key,size}[]`) and reuses `ModuleCarousel` verbatim for the grouped
state. If a *future* phase ever wants free 2-D drag-anywhere + collision/compaction (not A271),
R20's standing CSP verdict lets us re-open gridstack then; A271 is not that phase.

## 2. The S/M/L contract each module implements

Each module's body becomes size-aware: `{#if size === 'sm'} … {:else if size === 'md'} … {:else} …`.
`compute()`/`costModel()` are untouched — size selects *content density/layout*, never data.

- **Small** — glanceable. One headline number + trend/sparkline; no tables, no axes. These are the
  "carousel modules" the prompt cites (main-dash KPI cards, analytics glance cards). Six Small in a
  row trigger the grouped carousel (§4).
- **Medium** — the current default density of the paired half-width modules: Trading Calendar,
  Break-even & Cost, Advanced Statistics, Activity Terminal (today's `PAIRED_MODULE_KEYS`,
  `lg:col-span-1`). Compact tables/mini-charts, two-up on desktop.
- **Large** — full-width and tall, fills the content column: the **Calendar-screen calendar** and
  the **main-dashboard performance graph** (equity curve). Full axes, crosshair, day cells that
  reflow/scale to the available height. This is the state A272 ("calendar fills the viewport")
  depends on — "fill the screen" becomes the calendar's Large state, not a one-off hack.

Each `MODULES` entry declares which sizes it supports and its default (most modules support all
three; a couple may pin to their natural size). The size dimension is orthogonal to the existing
hide/reorder/add controls.

## 3. Persistence migration — 1-D key order → versioned `{key,size}[]`

Today `modKeyFor(tabId)` in `dashtabs.svelte.ts` persists a **`string[]`** (order only) to
`Store.local`; `dashModules`, `draftLayouts`, `saveModules(order)`, and `saveTabLayout()` all carry
that shape, and `onmoduleschange(order)` / `App.svelte`'s `lastModKey` echo-guard key on
`order.join(',')`.

Migrate to a **versioned object payload**:

```ts
type ModSize = 'sm' | 'md' | 'lg';
type ModEntry = { key: string; size: ModSize };
type ModLayout = { v: 2; mods: ModEntry[] };   // persisted under modKeyFor(tabId)
```

- **Read-time migration (one-shot, lossless).** A stored value that is an **array of strings**
  (v1) → `{ v: 2, mods: order.map(k => ({ key: k, size: defaultSizeFor(k) })) }`. `defaultSizeFor`
  preserves today's *visual* layout so no existing dashboard shifts on upgrade: full-width modules
  (not in `PAIRED_MODULE_KEYS`) → `lg`; paired modules → `md`. A `{ v: 2, … }` object passes
  through. `validKeys` becomes `validLayout` (drops unknown keys *and* clamps unsupported sizes to
  a module's default).
- **Threading.** `dashModules`/`draftLayouts` become `ModEntry[]`; `saveModules` takes the richer
  array; the echo-guard keys on the serialized payload (`JSON.stringify`) instead of `join(',')`.
  `onmoduleschange` carries `ModEntry[]`. The `'main'` legacy `MOD_KEY` and the staging-namespaced
  keys are unchanged (still per-surface namespaced).
- **Workspace templates** snapshot the same payload → migrate through the identical read-time path.
- The staged-save model (A186 dirty asterisk, `draftLayouts`, `saveTabLayout`) is unchanged in
  shape — only the element type widens.

## 4. Snap / grid + resize-handle mechanics (design level)

- **Grid.** Replace `grid-cols-1 lg:grid-cols-2` with a **12-track** CSS grid on lg
  (`lg:grid-cols-12`), superset of today's 2-track model. Span presets: **Small = span 2** (six per
  row), **Medium = span 6** (two per row = today's half-width), **Large = span 12** (full). Applied
  per module with `use:styleProps={{ 'grid-column': 'span ' + spanFor(size) }}` — CSSOM, no literal
  `style=`. Large's extra height is a **class-based** min-height keyed on size (e.g. a
  `lg:min-h-[70vh]` utility), never an inline style — keeps CSP clean and lets the calendar/curve
  fill the viewport. Keyed `(key)` + `animate:flip` + `transition:fade` all stay.
- **Snap to state.** A **corner drag-resize handle** (staging-gated) using Pointer Events +
  `setPointerCapture`; on move, **rAF-throttled** conversion of the pointer offset against the
  container's measured track width → the **nearest of the three presets** (`sm/md/lg`), live-preview
  the span via `styleProps`; on release, commit the snapped enum through the `commitModules`
  equivalent → stages behind the DashTabs dirty asterisk; Save persists (A186). Because targets are
  three discrete sizes, "snap" is `nearest-of([2,6,12])` on the measured px width — no packing math.
  Consider extracting the pointer/rAF/aria plumbing into a reusable `trackResize` action (the R20
  phase-2 note) so Analytics/Calendar reuse it.
- **Carousel grouped state.** When a full row of **six Small** modules sits horizontally, collapse
  the row into the existing `ModuleCarousel` part (one-at-a-time swipe/arrows/dots) instead of
  rendering six ⅙-width cards — reuse `parts/ModuleCarousel.svelte` verbatim; it already owns the
  swipe/keyboard/dot a11y.
- **Mobile degrade.** Below `sm` (the existing `isNarrow` `MediaQuery`, A200) render the single-
  column stack — size is ignored, all modules span full width, resize handles are **not rendered**.
- **Keyboard / a11y fallback.** The handle is focusable, `role="slider"`,
  `aria-valuemin/max/now` over the three states (or a labeled `separator`), with
  `aria-valuetext="Small|Medium|Large"`; ArrowLeft/Right steps between adjacent sizes (same staged
  commit). The discoverable no-pointer path is a **Size: Small / Medium / Large** radio group added
  to the existing per-module `DropdownMenu` (sibling of Move up/down/Hide) — no gesture required.
- **Demo non-mutating.** Resize stages in-memory only (`DemoStore.local` never persists, by
  construction) and every write path stays `isDemo`-guarded — confirm no new write path needs a
  `disabled` control, matching the existing module controls.
- **Staging-gate.** Ship behind `isStaging` (the resize handle + size persistence) until promoted,
  exactly as F29 phase-1 planned; the S/M/L *content contract* itself can render on all surfaces
  since it's layout-only.

## Out of scope (later, separate items)

Free 2-D drag placement, per-module free height resize, drag-between-cells, cross-row compaction —
the point where the gridstack decision legitimately re-opens (R20's proposed phase-2 item). A271 is
three snap states + the carousel group, nothing more.
