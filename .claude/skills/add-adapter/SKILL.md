---
name: add-adapter
description: Add a new platform CSV adapter to Blotterbook's intake pipeline (backlog item A209 and its kind) — the sniff/toTrades/minScore object in src/lib/core/adapters.ts, its scripts/test-adapters.mjs fixture, and the docs tail (Howto import guide + homepage platform list). Use when asked to "add a platform adapter", "support <platform>'s export", "do an A209 adapter", or when a new real CSV export needs to be onboarded.
---

# Add a platform CSV adapter

CH39 in `static/data/backlog.json` records this skill's authoring; the driving item (A209 or
whichever platform request is live) is the canonical spec for WHICH platform to add — **read that
item's `prompt` first**. This skill is the operating procedure, per `docs/skills-shortlist-a196.md`
§1.

## What never changes

Every adapter normalizes to the same trade shape — `{ time, date, pnl, symbol, root, side[, qty,
entryTime, exitTime, holdMs, commission] }` — so `compute()`/`costModel()` in `src/lib/core/core.ts`
never need to change for a new platform (see CLAUDE.md "Adding things").

## Procedure

1. **Get a REAL export.** Never guess column headers from docs/screenshots — obtain (or ask the
   owner for) an actual exported CSV from the platform. If you can't, note the blocker; don't ship an
   adapter built purely from documentation (that's what `beta: true` is for — see step 6).
2. **Add the `Adapter` object** in `src/lib/core/adapters.ts` (the `Adapter` interface is in
   `src/lib/core/types.ts`), registered in the `ADAPTERS` array (~line 1100):
   - `id` / `label` — stable id (lowercase, no spaces), human label.
   - `kind: 'closed' | 'fills'` — `'closed'` if each row is already a finished position with realized
     PnL (TradingView-style); `'fills'` if rows are individual buy/sell executions that need
     `pairFills()` to build round trips (fills exports also populate `Fill.commission` when the
     export carries a real commission column — A208).
   - `minScore` — the exact score `sniff()` returns for a full-signature match (A178: `detect()`
     rejects a partial/weaker match instead of auto-claiming the file).
   - `sniff(text, rows)` — score the header row. Use `hasAny(lc(rows[0]), [...])`, where `hasAny`
     matches on **word boundaries** via `cellHas` (A174) — never a raw substring test, or e.g. `"p/l"`
     would false-match inside an unrelated column name. Return 0 for anything that isn't this
     platform.
   - `toTrades(text, rows)` — parse to the normalized trade shape. Reuse the existing helpers
     (`normTime`, `num`, `rootSym`, `pairFills` for fills-kind adapters) rather than re-deriving them.
   - `beta: true` if built without a verified real export (see step 6); `upgradeHint` if a sibling
     export of the same platform unlocks fields this one lacks (e.g. hold time).
3. **Run the full detection loop — no misfires.** `sniff` must (a) clear its own `minScore` on this
   platform's fixture, and (b) score 0 (or below every other adapter's score) on **every other**
   platform's fixture, so `detect()` never claims the wrong adapter. Concretely: after adding the
   fixture (step 4), the existing loop `for (const id of Object.keys(C)) ok('detect ' + id, (A.detect(C[id])
   || {}).id === id, ...)` in `scripts/test-adapters.mjs` must pass for every platform, including the
   new one — this is the no-misfire assertion; don't skip re-running it.
4. **Add a fixture** to the `C` object at the top of `scripts/test-adapters.mjs` — a representative CSV
   string keyed by the adapter's `id`. This one addition auto-feeds the shared detection loop (step 3)
   and the shape loop (`shape(t)` — every parsed trade has `time`/`date`/`pnl`/`symbol`/`root`/`side`).
   For a `'fills'` adapter, also add explicit assertions on the paired trades' `pnl` and `holdMs`
   (grep existing fills adapters in the file for the pattern). Copy belt-and-braces patterns already
   in the file where they apply: same-column delimiter refusal (semicolon/tab EU-locale files,
   A168), a `Status`-gated-execution check if the platform has a pending/working row state to skip.
5. **Docs tail** (skip only if explicitly told this is an internal/beta-only add):
   - `src/site/components/Howto.svelte` — a nav link (`#imp-<id>`), a guide section under it, and a
     row in the export-types table.
   - `src/site/components/Home.svelte` — the platforms list / detection-status showcase.
   - A changelog entry (`data/changelog.json`) once the adapter ships verified (not on the beta add).
6. **Beta → verified is a SEPARATE, later pass** (A103) — don't do it here. An adapter ships
   `beta: true` when it's built from documented formats + synthetic fixtures only; a human verifies it
   against a real export (and the platform's own reported PnL as ground truth) before flipping to
   `beta: false`. Judging column semantics on an ambiguous export also stays manual — don't guess.
7. **Verify:** `node scripts/test-adapters.mjs` (or `npm run test:unit`, which includes it) all green,
   `npm run typecheck` clean (adapters.ts is native TS, A61).

**Done when:** the adapter object + fixture exist, the full detection loop shows zero misfires across
every platform (old and new), typecheck/unit tests are green, and the docs tail is updated (or its
absence is explicitly noted as deferred).
