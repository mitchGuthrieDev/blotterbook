# Build-step decision (R19)

**Status:** decided 2026-06-27 — **adopt Tier A (dev-only tooling) now; defer Tier B (shipped-output build).**

This records the outcome of backlog item **R19** ("adopt a build step?"). It sits under the
[design pillars](architecture.md#design-pillars): the no-build pillar is *soft*, but **no *runtime*
dependencies stays HARD** — the shipped app loads zero third-party/runtime code. The only question
R19 settled is build-*time*/dev tooling.

## The key distinction: two separable tiers

A "build step" is really two things with very different costs, and they can be adopted
independently:

- **Tier A — dev-only tooling that never touches shipped bytes.** Tests (incl. browser/render),
  lint, format, typecheck. Runs locally and in CI. The committed files stay exactly what deploys;
  repo root stays the web root. **Does not touch the deploy contract** ([A18](../data/backlog.json) /
  [CH28](../data/backlog_archive.json)).
- **Tier B — a build that emits the shipped output.** Bundler, minify, hashed filenames, nonce/hash
  CSP. **Reverses the deploy contract** (output dir, source ≠ committed artifact, root no longer =
  web root), ripples through the entire A18/CH28 coupled-path map, adds a Cloudflare Pages build
  command + a new failure surface, and creates a supply-chain path *into shipped assets*.

Tier A delivers ~80% of the value (above all, the **render-test coverage gap**) for ~10% of the
cost. Tier B's unique wins over A are narrow — CSS minify (marginal here), retiring the already-tiny
`build-manifest.mjs`, and nonce-CSP — while its cost is the largest architectural change in the repo.

## Decision

**Adopt Tier A. Defer Tier B behind a concrete trigger.** Shipped output stays dependency-free
either way.

### Tier A — adopted (this change)

- `package.json` (`"private": true`) + `package-lock.json`, **devDependencies only**, pinned:
  `eslint` + `@eslint/js` + `globals` (flat config), `prettier`, `@playwright/test` (pinned to the
  pre-installed browser revision). `node_modules/` is gitignored.
- **Playwright render/E2E tests** (`e2e/`): every surface (app / demo / staging) + the info pages
  boot with **zero console/page errors**, plus interaction + persistence smoke (stat-card modals,
  calendar day-notes → persisted, modal scroll-lock, curve keyboard a11y). This closes the repo's
  long-standing render-test gap — these were the throwaway harnesses written during A20/R1, now
  committed.
- **ESLint** (flat config, browser/Node/Workers globals) — catches real bugs without fighting the
  terse house style; `npm run lint` is clean.
- **Prettier** config + scripts are present and the code has been reformatted repo-wide (**CH32**,
  done) — landed as its own `style:` commit so it didn't bury the tooling change. `.prettierignore`
  excludes only the deliberately-unformatted surfaces (`**/*.html`, `data/`, `**/*.md`, `.github/`).
- **CI** runs `npm ci` → lint → unit/logic tests → Playwright → the build-drift gate. The gate
  doubles as proof the tooling never wrote into the committed/shipped tree.

### Tier B — deferred (A24)

Tracked as **A24**, gated on a concrete trigger — whichever comes first:

1. Dropping `style-src 'unsafe-inline'` (S18) becomes a priority (nonce/hash CSP is Tier B's only
   unique, worth-it payoff; note `script-src` is already `'self'` with no inline allowance, so the
   residual risk is CSS-injection only), **or**
2. module count / CSS size becomes a *measured* performance problem (native ESM + HTTP/2 + edge
   caching make this unlikely soon).

If adopted, the **only** Pages-compatible shape is the `public/` output-dir split from A18, migrated
all-at-once across the coupled-path map.

## Guardrails / safeguards

- **Dev tooling stays dev-only (A25).** devDependencies must never alter shipped bytes. CI's
  drift gate fails if the committed tree changes after install/test. Shipped output stays zero-dep.
- **Supply chain.** Minimal pinned dep set + committed lockfile; dependencies run only on dev/CI
  machines and cannot reach shipped assets (the gate enforces it). Tier B would change this — build
  deps would execute *into* shipped output — which is part of why it's deferred.
- **Cloudflare Pages.** Adding `package.json` can make Pages attempt a dependency install at deploy.
  The served bytes don't change (Pages serves the committed tree; `node_modules/` isn't a served
  path), but set **`SKIP_DEPENDENCY_INSTALL=1`** on the Pages project so devDeps never execute
  during a deploy. Keep the "no build command needed" posture.

## Why this is "modern enough"

The industry default of a bundler exists mainly to manage large dependency trees, frameworks, and
many modules — drivers this app deliberately lacks (zero deps, ~12 hand-written modules, tiny CSS).
The genuinely universal best practices the app was *missing* — automated render/visual tests, lint,
format — are all Tier A and need no shipped-output build. Intentionally-vanilla native-ESM static
sites are a legitimate current pattern. Tier A brings the app to best-practice parity; Tier B is an
optional hardening/optimization step for later.

## Spun-off backlog items

- **A24** — adopt Tier B (shipped-output build) — *deferred*, gated on the S18 trigger above.
- **A25** — guardrail: dev tooling stays dev-only; never alters shipped bytes.
- **CH32** — apply Prettier formatting repo-wide (deliberate, separate diff).
