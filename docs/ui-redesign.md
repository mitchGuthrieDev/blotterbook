# UI redesign initiative

A from-scratch overhaul of the app's shell, tokens, and screen layouts, designed **in code** (not a
separate design tool) using the [UI mockup workflow](../CLAUDE.md#ui-mockup-workflow). This doc
explains how the work-in-progress in `/dev` relates to the real product, and how it eventually ships.

## The key distinction: style is global, structure is preview-only

Two different kinds of change happen during the redesign, and they reach the real app very
differently:

- **Design tokens / style** — the greyscale palette, Geist Mono, 4px radius, and the no-preflight
  button/anchor resets — live in **[`src/styles/tailwind.css`](../src/styles/tailwind.css)**, a
  **single global stylesheet every surface imports**. So these are **already live everywhere**: the
  real `/app/`, demo, staging, and the marketing site all already render greyscale + mono. There is no
  per-page stylesheet; there is one shared one. (The redesign screens themselves use only Tailwind
  utility classes — no scoped page CSS. The only scoped `<style>` left is in the *old* live
  `App.svelte`, which the redesign replaces with utilities.)
- **Layout / structure** — the sidebar `AppShell` + `SidebarNav` and the per-screen mockups
  (`src/dev/screens/*`) — lives **only in `src/dev/`** and is **preview-only**. It has **not** touched
  the real app. The live `/app/` still mounts the old `App.svelte` (topbar + stacked panels).

> **In one line:** the new *look* is already shipped globally; the new *layout* is still a `/dev`
> preview until a deliberate cutover.

## Surfaces today

| Surface | URL | What it is | Data | Redesign state |
| --- | --- | --- | --- | --- |
| Marketing site | `/`, `/howto`, … | Svelte SSG pages | — | tokens only |
| Live app | `/app/` | real `App.svelte` (topbar + panels) | real IndexedDB | tokens only — **old layout** |
| Demo | `/app/demo.html` | real app, in-memory `DemoStore` | sample, never persists | tokens only |
| Staging | `/app/staging.html` | real app, isolated DB, key-gated | real, isolated | tokens only |
| **Redesign preview** | `/dev/app.html` | **new sidebar shell + screen mockups** | **hardcoded mock data** | the redesign itself |
| Styleguide | `/dev/components.html` | live token + component reference | — | the redesign reference |

## The `/dev` sandbox

`src/dev/` is a **throwaway design sandbox** — built + deployed but `noindex` + robots-blocked, never
linked from the product, driven by **hardcoded mock data**, with **no real data engine and no
persistence**. It exists so the new app can be designed in code without risking the live one:

- `/dev/components.html` — the styleguide (every token + installed shadcn-svelte primitive).
- `/dev/app.html` — the redesign harness ([`RedesignApp.svelte`](../src/dev/RedesignApp.svelte)): the
  sidebar shell + a hash router over the seven planned surfaces. Screens register in its `SCREENS`
  map; unbuilt ones fall back to a placeholder.

## Cutover: how `/dev` becomes the app

The mockups do **not** auto-become the product. When the design is approved, an explicit cutover
wires it to reality:

1. **Wire screens to the real engine.** Replace each screen's hardcoded data with the live `Store` +
   `compute()`/`costModel()` pure-logic core (the same pipeline the current app uses).
2. **Swap the app shell.** Point `App.svelte` at the new `AppShell` + the hash router, with the
   screens as the real views (gated per surface as needed: `PAGE_MODE`/`isDemo`/`STAGING_PAGE`).
3. **Roll out via staging first** (below), then promote to prod + demo.

## Staging's role (still needed)

`/dev` is a design tool with fake data; **staging is the real app with the real engine and real
(isolated, key-gated) persistence**. That makes staging the natural **landing strip for the cutover**:
ship the redesigned-*and*-wired app to staging first, exercise it with real CSV imports and real data,
then promote to prod + demo via the usual staging→prod promotion (see `promote-staging`). The two are
complementary — `/dev` settles the design, staging proves the real behavior before prod.

## Status

- **Phase 1 (foundation):** ✅ greyscale tokens, mono type, 4px radius (global); sidebar `AppShell` +
  `SidebarNav`; styleguide.
- **Phase 2 (screens, in `/dev`):** ✅ Dashboard · Calendar · Analytics · Blotter · CSV Library ·
  Trade Editor — ⬜ Reports.
- **Cutover:** not started (the live `/app/` is untouched beyond the global tokens).
