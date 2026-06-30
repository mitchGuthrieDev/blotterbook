# Repo audit — 2026-06-30 (R1, third full pass)

Recurring full-repo audit (backlog **R1**), read-only, run **immediately after the canonical
shadcn-svelte re-platform** (ADR-002; PR #80) — the first R1 pass to cover the new surface:
Tailwind v4 + bits-ui v2 + vendored shadcn-svelte primitives at `src/lib/components/ui/`, the
`$lib` restructure, and `src/styles/tailwind.css` as the single token source (`tokens.css`
deleted). Five dimensions were audited in parallel — **architecture & duplication**, **Svelte 5 /
TS code quality**, **security posture**, **build / CI / tooling / correctness**, and a dedicated
**UI clipping & readability** pass (the user reported visible glitches after the re-platform).
Findings were adversarially verified against source before filing.

Two genuine **UI regressions** from the re-platform were found *and fixed in this pass* (they
match the user's "clipping / readability" report and a related interaction bug); the read-only
architectural findings are filed as **A113–A115**. **R1 stays open** (recurring).

## Headline

The repo remains in **strong shape**. Four of the five dimensions came back essentially clean:

- **Architecture & duplication — clean.** The pure-logic core (`src/lib/core/*`) is single-sourced
  and reused verbatim (A29) — no re-implementations of `compute`/`costModel`/`adapters`/formatters.
  The `Store` seam (`context('bb:store')`) is the only persistence path (A4): real `indexedDB`/
  `localStorage` calls live solely in `store.ts`. `DemoStore` conforms to the full `StoreLike`
  interface (annotated, so tsc enforces parity). The new shadcn primitives are consistent
  (`data-slot` + `cn` from `$lib/utils`), and **zero** `$ui`/`src/ui` references remain — the alias
  migration is clean. The one real finding is duplicated color *literals* in site-component styles
  (A113).
- **Security — clean (the moat holds).** No trade-data egress: every client `fetch` is same-origin
  reference data (`/data/*.json`) or `/api/*` config/geo; the only POST bodies carry admin
  `{mode,label}`/`{flags}`, never trade/journal data. CSP is unchanged and tight (`style-src 'self'`,
  `script-src 'self'`, no `unsafe-inline`); bits-ui/Floating-UI position via the CSSOM (`element.style`),
  which `style-src` does not gate — no inline `style=""` was introduced. `{@html}` is confined to
  static developer-authored SVG constants; screenshot imports are `SHOT_RE` data-URL allow-listed;
  the export iframe is `sandbox`ed with no `allow-scripts` and `esc()`-wrapped. Functions verify the
  Access JWT (RS256/JWKS), the Stripe signature (raw body, replay window), and the admin token (HMAC,
  constant-time, fail-closed). `npm audit`: **0 vulnerabilities**.
- **Svelte 5 / TS quality — clean.** Runes-only throughout (no `export let` / `$:` /
  `createEventDispatcher` / store writables in any `.svelte`); `src/` is `any`-free except the
  deliberate, documented type-erasure in the A108 module registry (`src/app/lib/modules.ts`). The
  new vendored primitives are runes-clean and use bits-ui types correctly. `tsc` + `svelte-check` +
  ESLint all report 0 errors/0 warnings.
- **Build / CI / correctness — clean.** `bump-version.mjs` classifies the new prod-shipping paths
  (`src/lib/components/ui/**`, `src/lib/utils.ts`, `src/styles/tailwind.css`) correctly, with the A99
  deploy-contract guard as the backstop for any unclassified `src/` path (verified: all 105 tracked
  files classified). The drift gate excludes backlog/versions/changelog from cache-busting. The
  size budget is **399.1 KiB / 480 KiB** (81 KiB headroom). The prior pass's **A98** coverage gap
  (curveseries/report/costModel-qty/isoWeek) is **resolved** — `scripts/test-curveandreport.mjs`
  (31 assertions) now covers it and is wired into `test:unit`.

The dimension that surfaced real, user-visible problems was the **UI clipping & readability** pass.

## UI regressions — found AND fixed this pass

These were verified by Playwright (screenshots + programmatic measurement) and fixed directly,
since they reproduce the user's report. Each carries an e2e regression.

| Sev | Regression | Fix | Test |
| --- | --- | --- | --- |
| **P1** | **Site unresponsive after dismissing a dialog by clicking away.** The stat-card / export / manage dialogs were mounted controlled-always-open (`<Dialog.Root open …>` + a parent `{#if}` unmount), so bits-ui never ran its open→false teardown — the body scroll-lock's `pointer-events:none` could be left stuck (frozen until refresh). | `bind:open` on all three so bits-ui owns the transition; a local `$effect` tells App to unmount once closed. | **L11** (overlay click-away keeps the page interactive, for all three dialogs) |
| **P1** | **Traded calendar cells unreadable.** `CalendarMonth.svelte` set the cell base to the SOLID token (`background: var(--chart-2)`) while the P&L text used the same `var(--chart-2)` → 1:1 contrast (invisible); the day number / meta in muted-foreground sat at ~1.2:1. A re-platform regression (the original tinted the base behind saturated text). | Restore the tint, derived from the token via `color-mix(… transparent)` so it tracks the single token source (and drops two hardcoded rgba literals). | **L13** (a traded cell's P&L color differs from its background) |
| **P2** | **Manage (960px) / Export (880px) dialogs clamped to 512px**, clipping toolbar buttons, the trade table's Delete column, and the report preview. The canonical `dialog-content` base ends with `sm:max-w-lg`; a consumer `max-w-[960px]` does not dedupe against the `sm:`-variant in tailwind-merge, so the breakpoint rule won at ≥640px. | Pass `sm:max-w-[…]` (same variant → merges) on all three dialogs. | **L12** (wide dialogs measure ≥800/760px on a 1440 viewport) |
| P3 | **Dead `border-warn` utility** on the drawdown caveat (`StatCardModal.svelte`) — `warn` is not a shadcn-palette token, so the intended amber accent fell back to a gray border. | `border-warn` → `border-chart-4`. | (covered by existing modal specs) |

## Prioritized findings (filed — read-only)

| Sev | Finding | Filed |
| --- | --- | --- |
| **P2** | Brand color **literals** are re-typed in site-component `<style>`/SVG instead of `var(--token)` — `#3fb950`/`#262d38`/`#6aa0ff`/`rgba(13,16,20,.98)` etc. in `Howto.svelte`, `Home.svelte`, `Nav.svelte`, `Changelog.svelte`, `SiteShell.svelte` (+ the `getComputedStyle('--background') \|\| '#0d1014'` fallback in `ExportReport.svelte`). Single-source drift risk if the palette changes. (The CalendarMonth instances were converted to `color-mix` in this pass.) | **A113** |
| P3 | **Doc-rot sweep:** 6 stale `tokens.css` comments (`SiteShell.svelte:8`, `Home.svelte:5,564`, `report.ts:101`, `ExportReport.svelte:5`) describe a deleted file as the live source; the `$ui` comment in `WorkspaceBar.svelte:6`; the type-restating `@param`/`@returns` on `pairFills` (`adapters.ts:247-248`); and `CLAUDE.md`'s stale "6 node suites" list (now 7 — `test-curveandreport.mjs` was added). | **A114** |
| P3 | **Dev-tooling deps use caret ranges** (`eslint`, `prettier`, `typescript`, `typescript-eslint`, `globals`, `@eslint/js` in `package.json`) — contradicts the "all deps pinned" wording. Mitigated: all are dev-only, every runtime/client dep is exactly pinned + lockfiled, `npm audit` clean. Pin them, or reconcile the doc (ADR-002 retired the dependency-minimalism *pillar*). | **A115** |

`App.svelte` size (1076 lines) / prop-drilling fold into the existing **A80** (deeper runes
adoption), as in the prior pass — not re-filed. The new `cn()` / UI-primitive lack of a *node* unit
test is acceptable (thin canonical wrappers, covered by svelte-check + e2e) — noted, not filed.

## Claims rejected on verification

- **"White-on-destructive button text fails WCAG."** `text-white` on `bg-destructive` (#f04a4a) is
  3.63:1 — below the 4.5:1 *body* threshold but above the 3:1 large/bold threshold, and it is only
  used on bold button labels and ≥12px glyphs (the canonical shadcn `destructive` variant, with
  `destructive-foreground` defined as `#fff`). Intended canonical default; not filed.
- **"Mobile viewport overflow (thousands of elements)."** The page itself does not scroll
  horizontally at 390px (`scrollWidth == clientWidth`); the calendar and blotter are intentional
  internal scroll regions (A51/A123). Not clipping.
- **"`text-muted-foreground` / `text-chart-*` are low-contrast."** Measured 5.3–10:1 on bg/card/
  secondary — all pass AA. The red `text-chart-5`/`destructive` dips to 4.46:1 on `bg-secondary`,
  but only on bold/numeric usages that clear the 3:1 large bar. Not filed.
- **"A `.css` under `src/lib` would silently ship unbumped."** True of `isProdShipping` in isolation,
  but the A99 deploy-contract guard fails CI on any unclassified `src/` path first; no such file
  exists. Not actionable.
- **"A98 coverage gap is still open."** Resolved — `test-curveandreport.mjs` covers it; A98 is
  archived done.

## Method

Five parallel read-only agents (one per dimension; the UI agent additionally built `dist/` and drove
headless Playwright with programmatic clip/contrast detection) → consolidate/dedupe → verify claims
against source → fix the reproducing UI regressions inline (with e2e) → file the remaining read-only
findings as new backlog items. **R1 stays open** — it is a recurring driver; each pass ships its
output as new items (this is the third pass; A98–A102 from the second pass are now archived done).
