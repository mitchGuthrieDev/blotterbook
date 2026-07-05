# Mobile architecture assessment (A199)

**Date:** 2026-07-05 · **Backlog item:** A199 — "(Discussion) Audit our mobile approach — is it best-practice or does it need re-architecting?" · **Scope:** written analysis only, no code changes.

## Recommendation: keep-and-refine

The current approach — one responsive-adaptive Svelte SPA, Tailwind breakpoints for layout, plus
targeted `MediaQuery`-conditional renders where CSS alone isn't enough (A200) — is the right
architecture for this product, and it is already trending in the right direction. Do **not**
re-architect (no per-surface mobile layout, no mobile-first component rewrite). The reasons:

1. **The workload is desktop-first by nature.** The core loop (import a broker CSV, configure cost
   models, edit trades) happens at a desk; mobile is a *review/glance* surface. A distinct mobile
   layout would be a second UI to maintain for the secondary use case.
2. **The foundation is sound.** `AppShell` uses `h-dvh` (not `100vh`), a proper `md:` drawer/rail
   split, and the A183 `overflow-x-hidden` main + "wide content scrolls inside its own wrapper"
   contract — enforced by the e2e 360px no-horizontal-scroll sweep. Nothing is structurally broken.
3. **The incremental fixes are compounding into a pattern, not a pile of hacks.** A182 (calendar
   fit), A183 (page-scroll lock), A184 (select overflow), and especially A200 (the `ModuleCarousel`
   conditional render — cards exist once in the DOM, not CSS-hidden twice) are exactly the
   "adaptive rendering inside one responsive app" pattern current best practice recommends.

What *is* missing is deliberateness in three areas: tables below `sm`, touch-target sizing, and
touch-vs-pointer affordances. Those are refinements, not a re-architecture.

## Screen-by-screen findings

| Surface | Verdict | Notes |
| --- | --- | --- |
| AppShell / SidebarNav | **Fine** | Static rail `md:+`, slide-over drawer + backdrop below; closes on navigate; `h-dvh`. Gaps: drawer is hand-rolled (no Esc-close/focus-trap, unlike the Sheet primitive); no edge-swipe to open — acceptable. |
| Dashboard stats | **Fine** (post-A200) | Carousel below `sm` with swipe + arrows + keys + `touch-pan-y`; grid `sm:2/lg:3/xl:6` above. Dot indicators are `size-2` (8px) — decorative-grade targets, but arrows/swipe cover the interaction. |
| Dashboard P&L curve | **Papering-over (minor)** | `touch-none` SVG + `onpointermove` hover cursor: on touch the crosshair only tracks while a finger is down and blocks scroll over the chart; helper copy says "Hover or arrow-key". Works, but the interaction model is pointer/keyboard-first. |
| Dashboard modules / cost table | **Fine** | Reorder is button-based (touch-safe); cost table sits in `overflow-x-auto` and is narrow. `prompt()` for layout names is clunky on mobile but functional. |
| DashTabs | **Papering-over (acceptable)** | Drag-reorder is HTML5 drag events — **does not fire on touch**; the menu's Move left/right is the documented fallback, so nothing is unreachable. Menu/close triggers are `size-6` (24px) — at the WCAG 2.2 floor, below the 44px comfort zone. Tabs `flex-wrap` fine at 360px. |
| Calendar (month) | **Fine** (post-A182) | `minmax(0,1fr)` columns, week column hidden below `sm`, square truncating day cells ≈44px at 360px — good tap targets. Target-stepper buttons are `size-5` (20px) — **below** the 24px WCAG 2.2 minimum. |
| Calendar (year heatmap) | **Fine (deliberate scroll)** | `min-w-[680px]` inside `overflow-x-auto` — an honest horizontal-scroll choice for a timeline; no visible scroll affordance, though. |
| Blotter | **Papering-over** | Up to 13 columns in the Table primitive's `overflow-x-auto` container — at 360px this is a squeezed sideways-scrolling table. Mitigations exist (column-group toggles, row-tap → full-width detail Sheet) but the default phone experience is scroll-hunting for the P&L column. No card/list alternative, no sticky identity column. |
| TradeEditor | **Papering-over (low priority)** | 14 columns with inline text inputs — the worst table on touch, but it is an occasional bulk-edit surface, not a daily one. Horizontal scroll is a defensible floor here. |
| Analytics | **Fine (minor)** | Charts are `viewBox` SVGs that scale cleanly; KPI grid collapses to a 6-card single-column stack below `sm` (a candidate for the A200 carousel); bucket drill-down's fixed-width rows fit 360px. |
| CsvLibrary / Reports | **Fine** | Fewer-column tables in the scroll container; Sheets are `w-full sm:max-w-md`; Reports grids stack cleanly. |
| Onboarding / CostSetup | **Fine** (post-A184) | Feed select verified inside the viewport by e2e. |

## Best-practice comparison (data-dense dashboards on mobile)

- **Responsive-adaptive vs distinct mobile layout:** industry consensus for dashboards is one
  codebase with breakpoint-conditional *rendering* (not just CSS) for the densest modules — exactly
  the A200 pattern. Separate mobile apps/layouts are reserved for products with a primary mobile
  workflow. **We match.**
- **Tables:** best practice is progressive disclosure — a prioritized card/list view (primary
  fields + tap for detail) below the breakpoint, with horizontal scroll only as a fallback and then
  with a sticky first column + scroll affordance. **We are at the fallback tier without the
  fallback niceties.** The Blotter already has the detail Sheet, so the card view is cheap.
- **Touch targets:** WCAG 2.2 AA minimum 24×24px; Apple/Material recommend 44pt/48dp. Most controls
  are `size-8` (32px, fine); a tail of `size-5`/`size-6` (20/24px) and the 8px carousel dots sit at
  or below the floor. **Partial miss.**
- **Touch-vs-pointer:** tooltips (A205) are hover/focus-only, so sighted touch users get no labels
  on icon-only buttons (aria-labels serve AT only); there are no `pointer: coarse` / `hover: none`
  queries anywhere — viewport width is the only mobile signal. Standard, but a coarse-pointer pass
  is the current recommendation. **Gap.**
- **Gestures:** carousel swipe only; no drawer edge-swipe, no chart pinch/scrub. For a
  review-surface app this is proportionate — don't add gesture tooling while layouts settle.
- **Container queries:** Tailwind v4 supports `@container` natively; dashboard modules live in a
  user-reorderable grid where *module width*, not viewport width, is the truth. Worth adopting
  opportunistically for module internals, not as a wholesale migration.

## Prioritized follow-ups

1. **Blotter card/list view below `sm`** — the single biggest mobile win; reuse the A200
   conditional-render pattern and the existing detail Sheet.
2. **Coarse-pointer touch-target pass** — raise every interactive control to ≥24px (calendar
   stepper `size-5`, carousel dots, DashTabs `size-6` cluster), ideally 40px+ on coarse pointers.
3. **Icon-button labeling on touch** — tooltips never fire on tap; audit icon-only buttons for a
   visible-label or long-press alternative on `hover: none` devices.
4. **Table-scroll niceties where scroll stays** (TradeEditor, year heatmap): sticky identity
   column and an edge-fade/affordance so users know the surface pans.
5. **Analytics KPI carousel** — reuse `ModuleCarousel` for the 6-card stack below `sm`.
6. **e2e touch-emulation smoke** — the 360px sweep checks layout, not interaction; add a
   `hasTouch` project exercising carousel swipe, drawer, and a Blotter row tap.
7. **Exploratory: container queries for dashboard modules** — decouple module internals from
   viewport breakpoints; prototype on one module before adopting.

## Proposed backlog items

- **Blotter renders as a card list below `sm`** — LAYOUT (web vs mobile) · P2 · small.
  Below Tailwind's `sm` breakpoint, render the Blotter as a prioritized card list (date/time,
  symbol+side, qty, net P&L, note dot; tap → the existing detail Sheet) instead of the 13-column
  horizontal-scroll table, using the A200 `MediaQuery` conditional-render pattern so rows exist
  once in the DOM. Keep search/side-filter working; grouping and column toggles may be desktop-only.
- **Coarse-pointer touch-target pass** — LAYOUT (web vs mobile) · P2 · small.
  Sweep `src/app/` + the shell for interactive controls under 24px (calendar target stepper
  `size-5`, ModuleCarousel dots `size-2`, DashTabs `size-6` menu/close) and raise their hit areas —
  padding/pseudo-element hit-slop, not visual size, where the design is tight. Done when every
  control meets WCAG 2.2 target-size AA and the e2e sweep stays green.
- **Touch alternative for hover-only tooltips on icon buttons** — LAYOUT (web vs mobile) · P3 · small.
  A205 tooltips never show on tap, so sighted touch users get unlabeled icon buttons. Audit
  `IconTip` usages; where the icon isn't self-evident, add a visible label on `hover: none` devices
  (or accept and document the icon as universally understood). No new dependencies.
- **Table-scroll affordances where horizontal scroll remains** — LAYOUT (web vs mobile) · P3 · small.
  For tables that stay horizontal-scroll on phones (TradeEditor, the year heatmap), add a sticky
  first column and an edge-fade or shadow cue that the surface pans. Must keep CSP `style-src
  'self'` (utilities only) and the 360px no-horizontal-scroll e2e green.
- **e2e: touch-emulation interaction smoke** — TESTING · P3 · small.
  Add a Playwright project (or per-test `hasTouch` context) at 360px that exercises the mobile
  drawer open/close, a ModuleCarousel swipe, and a Blotter row tap → Sheet on the demo surface.
  The current mobile sweep asserts layout only; this covers the interaction layer.
