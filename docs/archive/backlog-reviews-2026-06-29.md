# Backlog reviews — 2026-06-29 (A82 · A67 · A64 · R18)

Written deliverables for four analysis/review backlog items. Each section is the
"done when … a written X is delivered" artifact. Where an item called for low-risk
fixes (A67), they are applied in the same change and noted inline. Spun-off
implementation items are recorded at the end and added to `backlog.json`.

All four items predate (or straddle) the A30 source reorg, the A61 JS→TS
conversion, and the A69 site→Svelte SSG move; their original prompts referenced
some now-retired paths (`app/render.js`, `partials/`, `tsc --checkJs`). The
reviews below are written against the **current** tree.

---

## A82 — Do all the root-directory files need to live at the root?

**Verdict: keep the root as-is.** Almost every root file is pinned there by a
tool's config-discovery or by the host, and the few that *could* move buy
negligible tidiness for real risk. Root clutter is intrinsic to a JS toolchain;
this repo's root is already lean (no stray scripts — `functions/`, `scripts/`,
`docs/`, `e2e/` are all directories).

### Inventory

| Root file | Why it's there | Movable? | Recommendation |
|---|---|---|---|
| `.gitignore` | git reads it from the repo root | No | Keep |
| `.node-version` | Cloudflare Pages **and** `actions/setup-node` read it from the repo root (pins Node 22) | No | Keep |
| `package.json`, `package-lock.json` | npm root; Cloudflare runs `npm ci` here | No | Keep |
| `vite.config.mjs` | Vite auto-discovers config at project root (the `root:'src'` option moves the *web* root, not the config) | Only via `--config` everywhere | Keep |
| `eslint.config.mjs` | ESLint flat config is resolved upward from cwd | Only via `--config` everywhere | Keep |
| `playwright.config.mjs` | Playwright auto-discovers config in cwd | Only via `--config` | Keep |
| `svelte.config.js` | read by both `vite-plugin-svelte` and `svelte-check`; expected at project root | No (in practice) | Keep |
| `.prettierrc.json` | Prettier resolves config upward from each file | Could fold into `package.json` `"prettier"` field | Keep (separate file is clearer; folding saves one line, costs discoverability) |
| `.prettierignore` | Prettier reads `.prettierignore` from cwd | No (must be root or named via `--ignore-path`) | Keep |
| `tsconfig.json` | default project; editors + `svelte-check` look for a root `tsconfig.json` | No (root one); see below | Keep |
| `tsconfig.svelte.json`, `tsconfig.functions.json` | referenced explicitly by `-p`/`--tsconfig` in the `typecheck` script | Technically yes (paths are explicit) | Keep — see "tsconfig" note |
| `vite-ssg.mjs` | a plain local module `import`ed by `vite.config.mjs` | **Yes** — nothing discovers it; it's just a relative import | Optional move into `scripts/` (deploy contract already pins `scripts/` at root) |
| `CLAUDE.md`, `README.md`, `LICENSE` | conventional repo-root docs | Yes, but conventionally root | Keep |

### The only genuinely movable candidate

`vite-ssg.mjs` is the one root file that no tool *discovers* — it's imported by
path from `vite.config.mjs`. It could live in `scripts/` (or a `build/` dir) with
a one-line import change. Benefit: one fewer root file. Cost: a path edit + the
deploy-contract note in CLAUDE.md/architecture.md would need a mention.
**Marginal — leave it unless a `build/` dir is created for other reasons.**

### tsconfig (3 files)

The three `tsconfig*.json` are three distinct TS "projects" (strict core via
`tsc`, Workers functions via `tsc`, the Svelte SPA + site via `svelte-check`),
deliberately split because plain `tsc` can't resolve `.svelte` imports. A
solution-style root `tsconfig.json` with `"references"` could *present* as one
entry point, but it adds indirection without removing files and risks editor /
`svelte-check` discovery quirks. **Keep the three; the split is load-bearing, not
clutter.**

### Incidental finding (not a move — a staleness cleanup)

`tsconfig.json`'s header comment and its `allowJs:true` were retained "for the
[A69] transition" while `src/site/**/*.js` still existed. A69 is complete — there
is no hand-written `.js` under `src/` anymore — so `allowJs`/`checkJs` are now
dead options and the comment is stale. Low-risk cleanup, folded into the
spun-off A82 follow-up rather than applied here (touching tsconfig risks the
typecheck gate and is out of scope for a "discussion" item).

### Recommendation

Keep the root layout. Optionally (low priority): relocate `vite-ssg.mjs` into
`scripts/` and drop the now-dead `allowJs`/stale comment from `tsconfig.json`.
Neither is worth a dedicated push; bundled as one optional chore (A95).

---

## A67 — Review the CI configuration

Reviewed `.github/workflows/ci.yml` and `version-bump.yml` against the current
Vite + Svelte + native-TS reality. **Overall the pipeline is correct and fails
closed.** Findings below; the low-risk fixes are **applied in this change**.

### Applied fixes (low-risk)

1. **Stale step label — typecheck.** `ci.yml` named the step *"Typecheck (JSDoc
   via tsc --checkJs)"*. Since A61/A79 the core is native TS and `typecheck` is
   `tsc` (core) + `tsc` (functions) + `svelte-check` (app + site) — no JSDoc,
   no `--checkJs`. Relabeled to reflect what runs.
2. **Stale step label — unit tests.** The unit step listed *"adapters / auth /
   version / flags / tax"* but `test:unit` runs **six** suites (adds
   `test-demostore.mjs`). Added `demostore`.
3. **Single-source the Node version.** Both workflows hardcoded `node-version:
   22` while `.node-version` already pins 22. Switched both to
   `node-version-file: .node-version` so the pin lives in exactly one place
   (matches what Cloudflare Pages reads).
4. **Action-version drift.** `ci.yml` used `actions/checkout@v5` /
   `actions/setup-node@v5`; `version-bump.yml` still used `@v4`. Aligned
   `version-bump.yml` to `@v5`.
5. **Least-privilege token for CI.** `ci.yml` had no `permissions:` block (so it
   inherited the repo default). Added `permissions: contents: read` — CI only
   needs to read the checkout. (`version-bump.yml` correctly keeps
   `contents: write` because it pushes the bump commit.)

### Verified correct (no change)

- **Fails closed / full gate.** lint → typecheck → format → unit → build → e2e →
  manifest-drift, each a separate step; any non-zero exit fails the job. The
  drift gate (`git status --porcelain` after `build-manifest.mjs`) catches both
  modified and untracked generated outputs.
- **`version-bump` does not self-retrigger.** Double-guarded: the release commit
  message carries `[skip ci]` *and* the job has
  `if: !startsWith(head_commit.message, 'chore(release):')`. Concurrency group
  `version-bump-main` with `cancel-in-progress:false` serializes close merges
  (CH14) so no bump is dropped; the push-rejected retry loop recomputes against
  fresh `main`.
- **`version-bump` needs no `npm ci`.** `bump-version.mjs` imports only Node
  builtins (`fs`, `child_process`, `url`) — confirmed. Skipping install there is
  correct, not an omission.
- **Permissions/secrets.** Neither workflow consumes secrets; deploy is
  Cloudflare Pages' own GitHub integration, not a workflow step, so there's no
  deploy secret to leak here.

### Recommendations (deferred — not auto-applied; spun off as A96)

- **Redundant build.** `ci.yml` runs `npm run build` (its own step) and then
  `npm run test:e2e`, whose Playwright `webServer.command` is
  `npm run build && python3 -m http.server …` — so `dist/` is built **twice**.
  Options: drop the standalone build step (e2e proves the build), or point the
  e2e `webServer` at the already-built `dist/` (serve, don't rebuild). Keeping a
  standalone build step does give a *cleaner* failure signal, so this is a
  cost/clarity tradeoff, not a clear win — hence deferred, not applied.
- **Playwright browser caching.** `npx playwright install --with-deps chromium`
  re-downloads Chromium every run. NB: this is **correct for GitHub-hosted
  runners** (Chromium is *not* preinstalled there — the "use the preinstalled
  Chromium" note in the original prompt refers to *this* agent/remote-exec
  environment, not CI). A `actions/cache` keyed on the pinned `@playwright/test`
  version (`1.56.1`) would cut the download; optional perf only.
- **CI concurrency group.** Adding `concurrency: { group: ci-${{ github.ref }},
  cancel-in-progress: true }` to `ci.yml` would cancel superseded PR runs and
  save minutes. Optional.

---

## A64 — Which Vite features to utilize

Survey of Vite capabilities not yet used, now that the build exists
(ADR-001/A26). Scored against the constraints: **A28** (minimal/pinned/audited
deps), the **local-compute / zero-egress** pillar, and the multi-page reality
(9 HTML entries + the SSG plugin).

| Capability | Benefit | Cost | Fit | Recommendation |
|---|---|---|---|---|
| **Code-splitting / dynamic `import()`** | Smaller initial `/app/` bundle; the heavy roadmap modules (R11/R12/R13/F23) load on demand | Low (Rollup splits automatically at `import()`) | Strong, but only once those modules exist | **Adopt when the roadmap modules land**, not before — today the app is modest and a single bundle is fine. Record the pattern now. |
| **Asset & image handling** | Hashed/fingerprinted assets, `?url`/`?raw`/`?inline` imports | None (built-in) | Already used for `src/assets/*` | Keep; reach for `?url`/`?raw` opportunistically. `static/assets/og-image.png` stays verbatim (absolute `og:image` URL) by design. |
| **`import.meta.env` / `define`** | First-class build constants; could replace some ad-hoc `data-mode` / mode sniffing | Low | OK | Adopt opportunistically (`import.meta.env.DEV/PROD`); not a priority — `data-mode` per-surface is deliberate and works. |
| **Dependency pre-bundling** | Faster cold dev start | None — automatic | N/A | No action; it already happens. |
| **Bundle analysis + size budgets** | Catch bundle-size regressions; enforce the "stays lean" intent | One **dev-only** devDep (`rollup-plugin-visualizer`) or a tiny home-grown byte-budget check | Good — dev-only, A28-clean | **Adopt a lightweight size budget** (even a script asserting `dist/` entry JS < N kB in CI). Analyzer optional. |
| **Legacy / `build.target` tuning** | Deterministic output target | None (config only) | Good | **Set an explicit `build.target`** (e.g. `es2022`, matching tsconfig) for predictability. **Skip `@vitejs/plugin-legacy`** — it pulls polyfills/deps (against A28) for a modern-browser audience. |
| **CSP/SRI-friendly output (ties S18/A55)** | Subresource-integrity hashes on emitted `<script>`/`<link>`; keep `style-src 'self'` | An SRI plugin/dep + build wiring | Conditional | Vite already emits hashed external module scripts (no inline JS), and A55 already routes dynamic styles through a CSSOM action (no inline `style=`). **SRI belongs under the existing S18 CSP item**, not a new one — fold there. |

### Recommendation

1. **Now (small):** set an explicit `build.target`; add a dev-only bundle
   size-budget check (CI-friendly). → A96.
2. **When roadmap modules land:** introduce `import()` code-splitting for
   R11/R12/R13/F23.
3. **Fold into existing work:** SRI under **S18** (CSP); `import.meta.env`
   adopted opportunistically. **Do not** adopt `plugin-legacy` (A28 + audience).

---

## R18 — (staging) Distribute "Definitions & Caveats" into the relevant panels

Design review of removing the standalone **Definitions & Caveats** module
(`src/app/components/Definitions.svelte`) and distributing its contents into the
panels that own each number — mirroring how Break-even & Cost Budget
(`CostPanel.svelte`) carries its own collapsible *"Assumptions & caveats"*
`<details>` (F6/F10).

**Recommendation: HYBRID, staging-first.** Split the content along a
context-vs-discoverability axis:

- **Per-metric definitions → the panel/modal that owns the number** (context
  wins: a caveat is most useful next to the figure it qualifies).
- **Cross-cutting *parsing* caveats that belong to no single number** (what a
  "trade" is, US-date/Eastern-time assumptions, scope) → keep in **one** slim,
  readable place (discoverability wins: users must be able to read these
  *before* trusting any grouping). Either a trimmed standalone panel or a
  top-level Help/About affordance.

### Per-item relocation mapping

Glossary (`<dl>`):

| # | Definition item | Relocate to | Why |
|---|---|---|---|
| 1 | **Trade = one closed position** | Manage data / import flow (+ Overview empty-state) | Foundational parsing fact; not tied to one metric — keep discoverable. |
| 2 | **Win / Loss / Scratch** | F14 stat-card modal `win` (Win Rate drill-down) | Defines the headline Win Rate card. |
| 3 | **Net PnL & take-home** | F14 modal `net` + CostPanel "Assumptions" (tax half) | Defines the Net PnL card; the tax/take-home half already belongs with cost. |
| 4 | **Performance graph** | EquityCurve panel (its panel menu/help) | Describes that exact chart. |
| 5 | **Broker & costs** | CostPanel "Assumptions" | Pure cost-model context (partly there already). |
| 6 | **Scope toggle** | The scope toggle / FilterBar (WorkspaceBar) | Describes that control directly. |
| 7 | **Avg Winner / Loser & Payoff Ratio** | AdvancedStats "Assumptions" + F14 modal `wl` | These rows live in Advanced Statistics. |
| 8 | **Profit Concentration** | AdvancedStats "Assumptions" | Row lives there. |
| 9 | **Sortino vs Sharpe** | AdvancedStats "Assumptions" | Rows live there. |
| 10 | **Largest Win / Loss Streak ($)** | AdvancedStats "Assumptions" | Rows live there. |
| 11 | **Best / Worst Weekday** | AdvancedStats "Assumptions" | Rows live there. |

Warnings (`<dl class="warn">`):

| # | Warning item | Relocate to | Why |
|---|---|---|---|
| 12 | **Max Drawdown is REALIZED only** | F14 stat-card modal `dd` (drawdown drill-down) | The drawdown modal already renders the peak→trough curve — perfect home. |
| 13 | **Weekday & streak samples are thin** | AdvancedStats "Assumptions" | Qualifies those rows. |
| 14 | **Commissions modeled, not exported** | CostPanel "Assumptions" | Already cost-model territory. |
| 15 | **Calendar-day grouping** | CalendarMonth panel + AdvancedStats (the Sharpe-daily clause) | Two homes: the calendar grouping note on the calendar; the "Sharpe uses daily PnL" clause with the Sortino/Sharpe rows. |
| 16 | **US dates & Eastern time assumed** | Manage data / import flow (keep discoverable) | Foundational parsing caveat; gates every date/week/month/session grouping. |

### Keep-vs-distribute call

- **Distribute** #2–#15 into their owning panels. Concretely: add an
  *"Assumptions & caveats"* `<details>` to **AdvancedStats** (verbatim mirror of
  the CostPanel pattern) to hold #7–#11, #13, and the Sharpe clause of #15;
  extend the four existing **F14 stat-card modals** (`net`/`win`/`wl`/`dd`) with
  #2, #3, #12; route the cost notes (#3-tax, #5, #14) into **CostPanel**
  Assumptions; put #4 on EquityCurve, #6 on the scope toggle, the grouping note
  of #15 on CalendarMonth.
- **Keep in one place** the cross-cutting parsing caveats #1, #6-context, #16 —
  trim `Definitions.svelte` down to these, or relocate them to a Help/About
  menu. These are the items where "one place to read everything before you trust
  the numbers" beats proximity.

**Tradeoff weighed:** full distribution maximizes context but scatters the
foundational parsing caveats (#1/#16) that a new user most needs *up front* and
that gate the trustworthiness of every downstream number — so those stay
centralized. This is the same logic F6/F10 used for cost: caveats live with
their model, but the *model-wide* ones sit at the panel head.

### Spun-off implementation (staging-first, if approved) → A97

1. AdvancedStats: add the `<details>` "Assumptions & caveats" (mirror CostPanel).
2. Stat-card modals: fold #2/#3/#12 into `net`/`win`/`wl`/`dd`.
3. CostPanel: absorb #3-tax/#5/#14 (reconcile with what's already there).
4. EquityCurve / CalendarMonth / scope toggle: their one-liners (#4/#15/#6).
5. Trim `Definitions.svelte` to the cross-cutting parsing caveats (#1/#16) — or
   move them behind a Help affordance. Prove on **staging** before promotion.

---

## Spun-off items added to `backlog.json`

- **A95** (CHORE/REFACTOR, P3, small) — optional root tidy from A82: relocate
  `vite-ssg.mjs` into `scripts/` and drop the now-dead `allowJs`/stale A69
  comment in `tsconfig.json`.
- **A96** (CHORE/REFACTOR, P3, small) — A64/A67 build & CI hygiene: explicit
  `build.target`; dev-only bundle size budget; de-dup the CI double-build and add
  Playwright browser caching + a CI concurrency group.
- **A97** (REVIEW/AUDIT, P3, medium, staging) — implement the R18 hybrid:
  distribute the per-metric definitions into AdvancedStats/F14 modals/CostPanel
  and trim the standalone panel to the cross-cutting parsing caveats.
