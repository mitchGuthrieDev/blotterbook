# ADR-002 — Re-platform onto canonical shadcn-svelte (Tailwind v4 + bits-ui)

**Status:** Accepted (2026-06-30). Implements backlog **A128**; supersedes the original phased-hybrid
adoption and deliberately reverses the earlier **A104** "keep scoped CSS, decline utility-first"
recommendation and the **R22** declines of tailwind / tailwind-variants / bits-ui.

## Context

Blotterbook started as a deliberately dependency-light tool: design tokens in a single `tokens.css`
(~20 CSS vars), scoped per-component `<style>` blocks (~4,575 lines across 28 components),
hand-rolled a11y for the dialogs/menus/popovers (`modal.ts` + `menuOpen`/`pillOpen` state +
`svelte:window` outside-click), and native `<select>`s. A104 and R22 both concluded — correctly, for
the time — that this small, scoped-CSS implementation didn't justify a framework dependency.

The product has grown past "a simple tool." The roadmap (richer, interactive dashboard UI) makes
hand-rolling accessible primitives increasingly costly and inconsistent, and the decision owner has
**retired the old pillars** — the local-compute-only / no-trade-data-egress moat, the
"minimal/pinned/audited dependencies" posture, and the "`tokens.css` is the single source" rule.
Blotterbook is now a conventional modern **Svelte 5 (runes) + Tailwind v4 + shadcn-svelte** app, so
the right move is to adopt the canonical stack outright rather than maintain a bespoke half-measure.
Pre-launch is the cheap moment to change foundations.

## Decision

Adopt the **canonical shadcn-svelte stack**, fully — not a phased hybrid. As build-time + client
dependencies (pinned, lockfile committed):

- **Tailwind CSS v4** via `@tailwindcss/vite` (build-time; emits a linked utility stylesheet).
- **bits-ui v2** — headless, accessible Svelte 5 primitives (Dialog/DropdownMenu/Popover/Select…).
- **tailwind-merge** + **clsx** — the `cn()` class composer.
- **tw-animate-css** — component animations (enter/exit, fades, etc.).
- **shadcn-svelte** — the canonical components, vendored into the repo and maintained through the
  **shadcn-svelte CLI** (`components.json` is wired; `npx shadcn-svelte add <name>` works). We own
  the source and customize it in place.

### Token model (the single source is `tailwind.css`)

`tokens.css` is **deleted**. The single source of design-token values is now
[`src/styles/tailwind.css`](../src/styles/tailwind.css), which defines the **canonical shadcn-svelte
semantic set** in `:root` from Blotterbook's palette and maps it into Tailwind's theme namespace via
`@theme inline`:

- `background` / `foreground` / `card` / `popover` / `primary` / `secondary` / `muted` / `accent` /
  `destructive` / `border` / `input` / `ring` — the standard shadcn semantic roles. Components use the
  semantic utilities (`bg-background`, `bg-card`, `bg-secondary`, `text-foreground`,
  `text-muted-foreground`, `bg-primary`/`text-primary-foreground`, `border-border`, `hover:bg-accent`).

- **The accent/primary collision.** shadcn's `accent` is the *subtle item-hover surface*, not a brand
  color. So Blotterbook's brand blue maps to shadcn's **`primary`** (with `ring` for focus), and
  `accent` keeps its shadcn meaning (hover surface for menu items, etc.). Don't reach for `accent` to
  mean "the blue."

  > **Superseded (greyscale UI redesign, CH16-era):** `primary` is no longer the brand blue — it's a
  > near-white neutral (`--primary: #fafafa` in `src/styles/tailwind.css`), part of the greyscale UI
  > chrome (`ring` is mid-grey too; there is no brand blue in the chrome). Blue survives only in the
  > data layer as `chart-1` (`--chart-1: #6aa0ff`). The accent/primary distinction above is otherwise
  > still accurate — `accent` is still the hover surface, not a color role.

- **Trading-domain hues live in `chart-1..5`.** Several Blotterbook colors have no shadcn semantic
  equivalent, so they ride the chart palette: **chart-1** brand-blue, **chart-2** P&L-up (green),
  **chart-3** take-home (purple), **chart-4** warning (amber), **chart-5** P&L-down (red). Hence
  `text-chart-2` = positive P&L and `text-destructive` = negative/red.

### Where things live

- `src/lib/components/ui/` — the canonical shadcn-svelte primitives (`button`, `dialog`,
  `dropdown-menu`, `popover`, `select`), composed over bits-ui v2 with `data-slot` attrs and `cn` from
  `$lib/utils`. Used by `src/app` **and** `src/site`.
- `src/lib/utils.ts` — the `cn()` composer (`$lib/utils`).
- `src/lib/core/` — the framework-agnostic pure-logic core (adapters/core/store/types/format/report/
  sampledata/demostore/curveseries/entitlements/…).
- `src/styles/tailwind.css` — the Tailwind entry **and** the token source (see above). Imported by
  `src/app/main.ts` and each `src/site/entries/*.ts`, so the utility sheet ships on every surface (the
  app SPA + the prerendered SSG marketing pages). It's also resolved in `scripts/vite-ssg.mjs` so the
  SSG prerender picks up the utilities.
- The `$lib` alias points at `src/lib`. The old in-house `src/ui` primitives and the `$ui` alias are
  **gone**.

### TypeScript split

The core `tsc` (tsconfig.json) checks `src/lib/**/*.ts` **except** `src/lib/components` — the
component `.ts` barrels import `.svelte`, which plain `tsc` can't resolve. `svelte-check`
(tsconfig.svelte.json) covers `src/app` + `src/site` + `src/lib/components`. App-only glue stays at
`src/app/lib/` (actions/files/flags/nav). `tsconfig.functions.json` covers `functions/`.

### CSP still holds

**CSP `style-src 'self'` is unchanged** (`static/_headers`, S18/A55). Tailwind utilities are a *linked
stylesheet of classes* (`class="bg-card"`), **never** an inline `style=""` attribute — so they are
not "inline styles." bits-ui / Floating UI position popovers/menus by setting `element.style` in JS
(CSSOM), which CSP does **not** gate — the same mechanism as the `styleProps` action. The S18
invariant (no literal `style=""` in markup) is unchanged and still enforced.

## Consequences

- Hand-rolled a11y is **replaced** by canonical primitives: `modal.ts` is gone; dialogs, the Panel /
  Add-module menus, the session pill, and the selects get focus trap / scroll lock / Escape /
  outside-click / keyboard nav / ARIA roles from bits-ui.
- Primitives render **canonically — Dialog/menus/popover/select portal to body** (the standard
  shadcn-svelte behavior), not the earlier "in place, no Portal" workaround.
- A class applied via prop onto a primitive's ROOT element does **not** receive the parent's scope
  hash — style such elements with utilities (global) or the primitive itself, not scoped descendant
  CSS. For a trigger that must keep bespoke scoped styling, use bits-ui's `child` snippet so the real
  element stays in the parent template (Svelte scoping + `class:` directives keep working).
- The **A96 size budget** was raised 480 → 600 KiB at the CH16 cutover — the documented cost of the
  bits-ui + Floating-UI accessible-component system — and has since been raised further as later
  feature work landed (`scripts/check-bundle-size.mjs`; 840 KiB as of A223 — see that file's header
  comments for the full raise history).
- New components are added with `npx shadcn-svelte add <name>`; because we own the vendored source,
  bespoke customization happens in place.

See [`CLAUDE.md`](../CLAUDE.md) (styling / frontend conventions) for the day-to-day rules.
