# TypeScript adoption — analysis & decision (A61)

**Status:** decision accepted 2026-06-28 · **ADOPT full native TypeScript, strict, folded into the
A30 reorg** · supersedes the JSDoc-only stance of CH33 (which it builds on, not throws away).

> Deliverable for backlog **A61** ("discuss: migrate from JS to TypeScript"). This is the decision +
> phased plan; the execution lands with the A30/A69 reorg-and-convert pass. Decisions below were made
> by the owner on 2026-06-28.

## Decisions (owner)

1. **Target: full native TypeScript everywhere** — all `.js` → `.ts`, all 18 Svelte components →
   `<script lang="ts">`, including the pure-logic core. (Not the lighter "hybrid" or "expand JSDoc"
   options.)
2. **Timing: fold the conversion into the A30 reorg** — the `.js → .ts` / `lang="ts"` renames happen
   as part of the single A30+A69 reorg-and-convert pass, so files, imports, and paths are touched
   once.
3. **Strictness: `strict` from the start** — no loose-then-tighten phase.

## What TS buys beyond today's JSDoc setup

Today (CH33): the **pure-logic core** (9 `app/*.js`) already carries `// @ts-check` + JSDoc types via
`app/types.js`, and `npm run typecheck` (`tsc -p jsconfig.json`) checks it. The **18 Svelte
components are untyped** (`<script>`, excluded from the typecheck because `tsc` can't resolve
`.svelte` imports), and the glue/marketing JS (`app/staging-svelte/*.js`, `assets/*.js`) is untyped.

So the gains are **uneven**, and naming them honestly matters:

- **Biggest win — the Svelte components get real types.** 18 components with zero type coverage today
  gain typed props (`$props()`), typed `$state`/`$derived`, typed events and component refs via
  `lang="ts"`. This is the largest concrete safety gain and the part JSDoc serves worst.
- **Ergonomics across the board.** Inline TS types replace the verbose JSDoc ceremony
  (`@param {import('./types.js').Trade[]}` → `trades: Trade[]`), with better inference, autocomplete,
  and refactor-rename. `app/types.js`'s `@typedef`s become real `interface`/`type` declarations.
- **One language, one mental model** — no JS-with-JSDoc vs. TS split; new contributors (and agents)
  see a conventional TS codebase.
- **Marginal where already covered.** For the pure-logic *core*, the type-*safety* delta is small —
  it's already `@ts-check`-clean. The core's win is ergonomic (cleaner types) and consistency, not
  newfound safety. Worth being clear-eyed: the core conversion is mostly about uniformity, and its
  main *cost* is the test-runner change below.

## Migration mechanics & risks vs. the guardrails

### Build (Vite) — free

Vite/esbuild compiles `.ts` and `<script lang="ts">` natively (type **stripping**, no type
*checking*, at build time). So the shipped bundle "just works" once files are `.ts`. Type-checking is
a separate CI step (below). No shipped-byte/runtime change; no new *runtime* dependency.

### The node test suites — the one real architectural snag (A29)

`scripts/test-*.mjs` run **raw via `node`** and import the core directly (`import A from
'../app/adapters.js'`). `node` cannot execute `.ts` directly. Once the core is `.ts`, that breaks
unless we change how the suites run. Options, A28-ranked (cheapest/leanest first):

1. **Node 22 native type-stripping** (`node --experimental-strip-types`, stabilizing across 22.x) —
   runs `.ts` test files with **zero new dependency**. Preferred; we already pin Node 22
   (`.node-version`). Caveat: type-stripping doesn't transpile TS-only runtime constructs (enums,
   `namespace`, parameter properties) — trivially avoided in our code (we don't use them).
2. **`tsx`** (dev-only loader) — fallback if (1) hits a gap. Small, dev-only, no shipped bytes, no
   telemetry → passes the A28 local-compute gate.
3. ~~Compile core to `.js` for tests~~ — rejected; reintroduces a build-before-test step we don't want.

**A29 reconciliation (important).** Guardrail A29 says the pure-logic core is imported "**verbatim**,
not rewritten." A full-TS conversion changes the file *syntax host* (`.js`→`.ts`, JSDoc→inline
types). This is a **behavior-preserving, mechanical transform**, not a logic rewrite — A29's intent is
"don't reimplement the adapter/metrics/cost/tax algorithms," which still holds. The safety net is the
existing node suites (`test-adapters/version/auth/flags/tax/demostore`): they must pass **identically**
before and after. A29's wording will be amended to explicitly permit the JS→TS syntactic migration
under that gate (follow-up below).

### Svelte type-checking — one new dev tool

`tsc` can't see inside `.svelte`. Standard fix: **`svelte-check`** (dev-only) for component
type-checking, wired into `npm run typecheck` alongside `tsc --noEmit` for the non-Svelte `.ts`.
`typescript` is already a devDependency. `svelte-check` is dev-only, no shipped bytes → A28-clean.

### Config

`jsconfig.json` → **`tsconfig.json`** with `strict: true`, `noEmit: true`, `moduleResolution:
"bundler"` (already set), Svelte types referenced. `checkJs`/`allowJs` drop out once everything is
`.ts` (allow a transition window if the move is staged). The `exclude: app/staging-svelte/**` hack
goes away — components are checked by `svelte-check` instead.

### Cloudflare Functions

`functions/*.js` can become `.ts` too (Pages/Wrangler compile TS natively); typing them wants
`@cloudflare/workers-types` (dev-only, types-only). **Separable** from the app reorg — `functions/`
stays pinned at the repo root and is **not** part of A30's move — so it's its own phase, not a blocker.

### A28 dependency summary

New dev-only additions: `svelte-check` (+ its TS deps), optionally `tsx` (fallback) and
`@cloudflare/workers-types` (for functions). All dev-only, none shipped to users, none phone home →
all pass the A28 earn-its-weight bar and the hard local-compute gate. No runtime dependency is added.

## Phased plan

Sequenced to honor "fold the renames into A30," while de-risking the toolchain first:

### Phase 0 — this decision *(done)*

### Phase 1 — TS toolchain scaffold *(do BEFORE the A30 move; small, no renames)*

Prove the toolchain on the *current* tree so the big A30 pass is "just" moves+renames against a known
setup:

- Add `tsconfig.json` (`strict`), keep `allowJs` **on** for the transition so the still-`.js` tree
  keeps checking.
- Add `svelte-check`; wire `npm run typecheck` = `tsc --noEmit` **+** `svelte-check`. CI runs both.
- Decide + prove the `.ts` test-execution path (try Node native strip-types first; `tsx` fallback) by
  converting **one** small suite (e.g. `test-version`) and its target to `.ts` as a spike, then revert
  or keep as the pattern.
- *Optional early win:* convert `app/types.js` typedefs to real `.ts` types so both worlds can import
  them.

### Phase 2 — the conversion, folded into the A30 + A69 reorg-and-convert pass

In the **same** all-at-once move that A30 performs (and A69's Svelte-ification), per
`docs/structure-reorg-plan.md`:

- Rename every `.js → .ts` as files move into `src/{lib,app,site}`; flip all 18 components (and the
  new A69 marketing components) to `<script lang="ts">`.
- Convert JSDoc → inline TS types; turn `types.js` typedefs into exported `interface`/`type`.
- Update the test suites to `.ts` and switch their runner to the Phase-1 path.
- Drop `allowJs`; finalize `tsconfig.json` strict with no `.js` remaining (except configs if left
  `.mjs`).
- **Gate (the A29 safety net):** the node suites pass **identically**; `svelte-check` + `tsc` clean
  under `strict`; `npm run build` emits an equivalent `dist/`; full e2e green on every surface; demo
  still persists nothing.

### Phase 3 — Cloudflare Functions to TS *(independent follow-up)*

Convert `functions/**` to `.ts` with `@cloudflare/workers-types`. Not part of A30 (functions don't
move); schedule whenever convenient.

## Why this ordering is safe

The conversion's correctness rests entirely on the **node test suites passing identically** — they
are framework-agnostic and runtime-independent, so they validate that the JS→TS transform changed no
behavior. That is exactly the A29 guarantee, mechanized. Folding into A30 means the (large) combined
diff is gated once by both the node suites and the Playwright e2e, rather than churning imports twice.

## Follow-ups filed

- **A30** — prompt updated: the reorg pass now *also* performs the full-TS conversion (strict) per
  this doc, not just the file moves.
- **A77** *(new, P2)* — Phase 1: stand up the TS toolchain scaffold (`tsconfig` strict, `svelte-check`,
  the `.ts` test-runner decision) on the current tree, before the A30 move.
- **A29** *(guardrail amended)* — clarified to permit the behavior-preserving JS→TS syntactic
  migration, gated by the node suites passing identically (no logic rewrite).
- **A78** *(new, P3)* — Phase 3: convert `functions/**` to TypeScript (`@cloudflare/workers-types`);
  independent of the A30 move.
</content>
