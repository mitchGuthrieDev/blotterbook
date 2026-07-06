# A204 — UI/animation library evaluation: anime.js, Kokonut UI, bklit UI (+ peers)

**Date:** 2026-07-05 · **Backlog item:** A204 · **Status:** discussion/evaluation (no code change)

Context: the app already has a working motion layer (A146) — Svelte `fade`/`fly`/`slide`
transitions + `animate:flip` (Dashboard modules, DashTabs drag-reorder), `tw-animate-css`
driving the shadcn primitives' enter/exit, and a reduced-motion switch
(`src/app/lib/motion.ts` `dur()` + the `@media` rule in `src/styles/tailwind.css`).
Constraints: `/app/` JS budget **617.6 / 640 KiB uncompressed (~22 KiB headroom,
`scripts/check-bundle-size.mjs`)**; CSP `style-src 'self'` (no `style=""` attributes;
CSSOM/`styleProps` is fine); Svelte 5 runes, not React.

## Verdicts

| Library | Verdict | Why (one line) |
| --- | --- | --- |
| anime.js v4 | **Skip (for now)** | Capable engine, CSP-fine, but overlaps Svelte transitions almost entirely and would eat most of the 22 KiB headroom for no identified screen. |
| Kokonut UI | **Selectively borrow patterns** | React/Next + Framer Motion copy-paste collection — no Svelte story; use it as a visual-idea catalog, re-implement in shadcn-svelte. |
| bklit UI | **Skip** | Obscure React-only shadcn *chart* collection (shadcn registry + Motion); nothing installable here, and our charts are custom SVG in the pure core. |

## anime.js v4

- **What it is:** standalone JS animation engine (timelines, staggers, springs, SVG
  morph/draw, scroll-driven animation). v4 is ESM-first, modular named imports
  (`import { animate } from 'animejs'`), `sideEffects: false` → tree-shakeable.
- **Svelte fit:** framework-agnostic; would run in `$effect`/actions alongside — not
  through — Svelte's transition system. Two competing motion systems on one keyed list
  (e.g. anything using `animate:flip`) is a real coordination hazard.
- **License:** MIT.
- **Size vs 22 KiB headroom:** full engine advertises ~10 KiB gzipped, but our budget
  counts **uncompressed** minified bytes — the full build is several times that, and even
  a tree-shaken `animate` + utils slice plausibly lands 15–30 KiB uncompressed, i.e. most
  or all of the remaining headroom.
- **CSP:** OK — it writes `element.style` properties via CSSOM (same mechanism bits-ui/
  Floating-UI already use); no `style=""` attributes in markup.
- **Beyond A146:** timelines/staggers/springs and SVG stroke-draw effects that Svelte's
  `transition:`/`flip` can't express. We currently have zero screens that need them; a
  stagger is achievable today with per-item `delay` on Svelte transitions.

## Kokonut UI

- **What it is:** open-source copy-paste collection (~100 components: animated cards,
  buttons, heroes, pricing, dashboards) built on **React/Next.js + Tailwind + shadcn/ui +
  Motion (Framer Motion)**, distributed via the shadcn CLI registry. MIT. Pro tier exists.
- **Svelte fit:** none — components are JSX with Framer Motion props; there is no Svelte
  registry. Adopting means hand-porting each piece to Svelte 5 + bits-ui anyway.
- **Size / CSP:** moot as a dependency (nothing to install). A hand-port costs only what
  we write; the CSP risk is a careless port copying JSX `style={{…}}` into a Svelte
  `style=""` attribute — any dynamic styling must go through the `styleProps` action.
- **Beyond A146:** design *ideas* (card hover treatments, micro-interactions, empty-state
  flourishes), not machinery. Its Tailwind class recipes translate to shadcn-svelte
  primitives almost 1:1 when the motion part is redone as a Svelte transition.

## bklit UI

- **What it is (verified):** `bklit/bklit-ui` — a small, little-known open-source
  **chart component collection** (bar/line/area/ring/radar + legends) extending
  shadcn/ui, React + Motion, distributed as a shadcn registry (copy-paste). MIT.
- **Svelte fit:** none (React-only). Also wrong layer for us: Blotterbook's charts are
  hand-rolled SVG driven by the pure core (`curveseries.ts`, `niceTicks`/`axMoney`), and
  chart *series* animation is decorative in a trading journal.
- **Size / CSP / beyond A146:** nothing installable; at most its easing/stagger choices
  (~1.2 s staggered `cubic-bezier(0.85,0,0.15,1)` bar entrances) are a reference if we
  ever animate chart mount.

## Peers worth a line

- **Motion (motion.dev, ex-Motion One / Framer Motion):** the real candidate if we ever
  need more than Svelte transitions. `motion/mini` (`animate`) is ~2.3–2.6 KiB gzipped,
  WAAPI-based (CSP-fine), MIT, framework-agnostic — fits the 22 KiB headroom easily,
  unlike anime.js. The hybrid build (~17 KiB gz) and the React `motion` component are out.
- **svelte-motion / motion-svelte:** community Framer-Motion ports; thin maintenance,
  uneven Svelte 5 runes support — skip.
- **GSAP:** 100 % free since the 2025 Webflow acquisition (incl. former club plugins),
  but under a **custom "Standard License", not OSI/MIT** (anti-Webflow-competitor
  clause — harmless to us but nonstandard), and the core alone would blow the budget. Skip.
- **@formkit/auto-animate:** MIT, ~3 KiB, works as a Svelte action — but it solves list
  add/remove/reorder, which `animate:flip` + transitions already cover here. Skip.

## If we want more motion, the path is…

Stay on the A146 stack — Svelte transitions/`flip` (durations through `dur()`) +
`tw-animate-css` on the shadcn primitives — and mine Kokonut-style collections for
*looks*, not code. If a concrete screen ever needs imperative sequencing (timeline,
spring, scroll-linked), add **`motion/mini`** behind a tiny wrapper that respects
`REDUCED_MOTION`: ~3 KiB gz, WAAPI/CSSOM (CSP-clean), MIT — not anime.js, and not a
React component collection. No such screen exists today, so nothing is adopted now.

## Proposed backlog items

- None. (If a future feature needs timeline/scroll-driven motion, file an item then to
  adopt `motion/mini` + a `REDUCED_MOTION`-aware wrapper in `src/app/lib/motion.ts`.)
