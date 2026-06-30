# ADR-002 — Adopt Tailwind v4 + shadcn-svelte + bits-ui + tailwind-variants

**Status:** Accepted (2026-06-30). Implements backlog **A128**; deliberately reverses the **A104**
"keep scoped CSS, decline utility-first" recommendation and the **R22** declines of
tailwind / tailwind-variants / bits-ui.

## Context

Blotterbook started as a deliberately dependency-light tool: design tokens in a single
[`tokens.css`](../src/styles/tokens.css) (~20 CSS vars), scoped per-component `<style>` blocks
(~4,575 lines across 28 components), hand-rolled a11y for the dialogs/menus/popovers
(`modal.ts` + `menuOpen`/`pillOpen` state + `svelte:window` outside-click), and native `<select>`s.
A104 and R22 both concluded — correctly, for the time — that this small, CSP-clean, scoped-CSS
implementation didn't justify a framework dependency.

The product is now growing past "a simple tool." The roadmap (richer, interactive dashboard UI)
makes hand-rolling accessible primitives increasingly costly and inconsistent. Pre-launch is the
cheap moment to change foundations. So the decision owner approved a **full** adoption of a
utility-first + accessible-component system.

## Decision

Adopt, as build-time + client dependencies (pinned, lockfile committed, `npm audit` clean — A28):

- **Tailwind CSS v4** via `@tailwindcss/vite` (build-time; emits a linked utility stylesheet).
- **bits-ui** — headless, accessible Svelte 5 primitives (Dialog/DropdownMenu/Popover/Select…).
- **tailwind-variants** — typed component variant recipes (`tv()`).
- **tailwind-merge** + **clsx** — the `cn()` class composer.
- **shadcn-svelte** patterns/config (`components.json`) — we hand-author the primitives in `src/ui/`
  following its composition style rather than depending on its registry at runtime.

### Key constraints honoured

- **CSP `style-src 'self'` stays** (static/_headers, S18/A55). Tailwind utilities are a *linked
  stylesheet of classes* (`class="bg-accent"`), **never** an inline `style=""` attribute — so they
  are not "inline styles." bits-ui / Floating UI position popovers/menus by setting `element.style`
  in JS (CSSOM), which CSP does **not** gate — the same mechanism as the `styleProps` action. The
  S18 invariant (no literal `style=""` in markup) is unchanged and still enforced.
- **`tokens.css` is the single source of design-token values.** Tailwind's `@theme`
  ([`src/styles/tailwind.css`](../src/styles/tailwind.css)) only *maps* the existing token CSS vars
  into Tailwind's theme namespace (`--color-accent: var(--accent)` → `bg-accent`/`text-take`/
  `font-mono`…). No values are duplicated into a JS config.
- **Preflight is intentionally omitted** for now (only `@tailwindcss/utilities` + `@tailwindcss/theme`
  are imported, plus a `border-box` base) so utilities are *additive* over the not-yet-migrated
  scoped CSS during the phased migration.
- **A96 size budget** raised 200 → 400 KiB (`scripts/check-bundle-size.mjs`) for the bits-ui +
  Floating-UI JS — the explicit, documented cost of the accessible-component system.

### Where things live

- `src/ui/` — the shared design system (used by `src/app` **and** `src/site`), aliased `$ui`:
  `utils.ts` (`cn`), `button/`, `dialog/`, `dropdown-menu/`, `popover/`, `select/`.
- `src/styles/tailwind.css` — the Tailwind entry (`@theme` token mapping). Imported by
  `src/app/main.ts` and each `src/site/entries/*.ts`, so the utility sheet ships on every surface
  (the app SPA + the prerendered SSG marketing pages).
- The `$ui` alias is mirrored in `scripts/vite-ssg.mjs` so the SSG prerender resolves the primitives.

## Consequences

- Hand-rolled a11y is replaced by audited primitives: `modal.ts` deleted; the dialogs, the Panel /
  Add-module menus, the session pill, and the first selects now get focus trap / scroll lock /
  Escape / outside-click / keyboard nav / ARIA roles from bits-ui for free.
- App-tree rendering: primitives render **in place (no Portal)** because the modals/menus live inside
  `<main id="sv-app">` and the e2e specs (and a few styles) target `#sv-app …`. Fixed positioning
  still escapes panel clipping.
- Triggers that keep bespoke scoped styling (`.pill`, `.addmodbtn`) use bits-ui's `child` snippet so
  the real element stays in the parent template (Svelte scoping + `class:` directives keep working).
  A class applied via prop onto a primitive's root element does **not** receive the parent's scope
  hash — style such elements with utilities (global) or the primitive, not scoped descendant CSS.
- Migration is phased (A128 stays open until the scoped-CSS → utility conversion is complete);
  hybrid is fine — genuinely bespoke things (the EquityCurve SVG, the CalendarMonth grid) stay in
  scoped CSS where utilities would be worse.

See [`CLAUDE.md`](../CLAUDE.md) (styling / frontend conventions) for the day-to-day rules.
