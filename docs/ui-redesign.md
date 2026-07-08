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
  utility classes — no scoped page CSS, and the app root `App.svelte` carries no `<style>` block at
  all; the old pre-cutover root that did was deleted in CH16.)
- **Layout / structure** — the sidebar `AppShell` + `SidebarNav` and the per-screen screens
  (originally mocked in `src/dev/screens/*`) — has now **shipped to the real app** via the CH16
  cutover: the live `/app/`, demo, and staging all mount the redesigned sidebar-shell `App.svelte`
  (`AppShell` + hash router over `src/app/screens/*`). `/dev` remains the token + component
  styleguide reference (`/dev/components.html`); screen design happens directly in
  `src/app/screens/`.

> **In one line:** both the new *look* and the new *layout* are now shipped globally — the cutover
> is complete; `/dev` remains a design sandbox.

## Surfaces today

| Surface | URL | What it is | Data | Redesign state |
| --- | --- | --- | --- | --- |
| Marketing site | `/`, `/howto`, … | Svelte SSG pages | — | tokens only |
| Live app | `/app/` | redesigned `App.svelte` (sidebar shell + screens) | real IndexedDB | **new sidebar shell** (redesign shipped) |
| Demo | `/app/demo.html` | same redesigned app, in-memory `DemoStore` | sample, never persists | **new sidebar shell** (redesign shipped) |
| Staging | `/app/staging.html` | same redesigned app, isolated DB, key-gated | real, isolated | **new sidebar shell** (redesign shipped) |
| Styleguide | `/dev/components.html` | live token + component reference | — | the redesign reference |

## The `/dev` sandbox

`src/dev/` is a **throwaway design sandbox** — built + deployed but `noindex` + robots-blocked, never
linked from the product, driven by **hardcoded mock data**, with **no real data engine and no
persistence**. It exists so the new app can be designed in code without risking the live one:

- `/dev/components.html` — the styleguide (every token + installed shadcn-svelte primitive). *(The
  `/dev/app.html` redesign harness + `RedesignApp.svelte` were retired post-CH16 — the real app IS
  the redesign; new screens are designed directly in `src/app/screens/`.)*

## Cutover: how `/dev` became the app (done)

The mockups did **not** auto-become the product; an explicit cutover (CH16) wired the redesign to
reality and shipped it to every surface:

1. **Wired screens to the real engine.** Each screen's hardcoded data was replaced with the live
   `Store` + `compute()`/`costModel()` pure-logic core (the same pipeline the app already used).
2. **Swapped the app shell.** The redesigned root (`StagingApp.svelte`) was **renamed to `App.svelte`**
   and became THE app root — an `AppShell` + hash router over `src/app/screens/*`, with per-surface
   behavior derived internally from `PAGE_MODE` (`isDemo`/`isStaging`). The pre-cutover vanilla
   `App.svelte` and its entire `src/app/components/*` view layer were **deleted**.
3. **Rolled out to all surfaces.** `main.ts` now mounts the one mode-aware `App.svelte` on app, demo,
   and staging alike — there is no longer a staging-only dynamic-import branch.

## Staging's role (still needed)

`/dev` is a design tool with fake data; **staging is the real app with the real engine and real
(isolated, key-gated) persistence**. That makes staging the natural **landing strip for the cutover**:
ship the redesigned-*and*-wired app to staging first, exercise it with real CSV imports and real data,
then promote to prod + demo via the usual staging→prod promotion (see `promote-staging`). The two are
complementary — `/dev` settles the design, staging proves the real behavior before prod.

## Status

- **Phase 1 (foundation):** ✅ greyscale tokens, mono type, 4px radius (global); sidebar `AppShell` +
  `SidebarNav`; styleguide.
- **Phase 2 (screens, in `/dev`):** ✅ **complete** — Dashboard · Calendar · Analytics · Blotter ·
  CSV Library · Trade Editor · Reports (all seven mocked in the harness).
- **Cutover (Phase 3):** ✅ **complete** — the CH16 cutover shipped the redesigned sidebar-shell app
  to **all three surfaces** (app/demo/staging). The redesigned root `StagingApp.svelte` was renamed
  to `App.svelte` and is now THE app root everywhere; `main.ts` mounts it mode-aware via `PAGE_MODE`.
  The legacy vanilla `App.svelte` + its `src/app/components/*` view layer were deleted.
