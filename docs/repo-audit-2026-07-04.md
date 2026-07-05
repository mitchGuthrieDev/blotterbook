# Repo audit — 2026-07-04 (R1 pass 7)

*Scope: the full tree as of `feat/broker-override` — i.e. main plus the six stacked branches shipped
today (intake hardening A177/A178, per-file provenance F37 + real commissions A208, effective-dated
rates F30 + Discount Trading F35, the TradingView order-history adapter A106, analytics
interactivity A197 + capability awareness A176, per-file broker override A211). Per the owner's
instruction, extra attention on today's additions; the pre-existing tree had passes on 07-01/07-02.
Read-only; every finding filed as a backlog item (A212–A218).*

## Verified clean

- **Runes/TS discipline** — no `export let` / `$:` / `createEventDispatcher` / `svelte/store`
  writables anywhere in `src/`; no `: any`/`as any`; `npm run typecheck` (tsc ×2 + svelte-check)
  clean. The one tricky typed spot today (`setField` keyed copy in the enrichment merge) landed as
  a proper correlated-generic helper, not a cast.
- **CSP / sinks** — no inline `style=""` in any of today's markup (chips, coverage notes, the
  capability matrix, the broker select); the only `{@html}` remains Home.svelte's local constant
  SVG art (static strings, not data). CSV export keeps the A154 formula-prefix escaping.
- **Store seam (A4)** — every new persistence surface (files/filetext stores, broker override,
  enrichment merge) went through `StoreLike` with DemoStore parity; no component touches
  `indexedDB`. All new multi-request IndexedDB transactions follow the B6 rule (requests issued
  synchronously inside `onsuccess`, no mid-tx `await`).
- **Trust boundaries** — `importAll` sanitizes every new field (fileIds 8-hex, commission finite
  ≥ 0, file records via the intake text gate + markup-stripped names, broker override key-charset);
  `rateFor` falls back safely on unknown broker keys. No egress anywhere in the new code — the
  moat holds (the only new fetch-shaped thing today is the still-unwired `/api/geo`, A201).
- **Reconciliation invariants** — costModel ↔ curveseries stayed in lockstep through three
  layered pricing rules (A208 actuals → F30 dated → A211 per-file broker), each with an endpoint-
  reconciliation fixture. bySym totals reconcile with mixed actual/modeled trades.
- **Cross-validation** — the new TradingView order-history adapter is verified against a real
  export AND against the same account's balance history (21/23 to the cent; misses are the
  export's own reach-back truncation, documented in the Howto).

## Findings

### P2

- **A212 — e2e gap: the new per-file actions and analytics interactivity have no end-to-end
  coverage.** `e2e/staging-redesign.spec.mjs` verifies import + persistence, but nothing exercises
  the F37 include/exclude toggle (the active dataset narrowing), rename persistence, the A211
  broker-override select, re-import, or the A197 click-to-filter/chips flow. The demo
  no-dead-controls sweep only proves clicks mutate *something*. One staging spec covering
  toggle→metrics-shrink→re-enable, and one covering symbol-row filter→chip→clear, closes the gap.
- **A213 — /app bundle headroom is down to ~20 KiB.** `npm run size-budget`: 580.1 / 600.0 KiB
  (was 559.4 on 07-02) — today's features cost ~21 KiB and the next feature of similar size trips
  the gate. Candidates before raising the ceiling: App.svelte keeps growing as the wiring hub
  (~1000 lines; some view-model builders could move to lazy chunks), and the utils chunk
  (bits-ui/tailwind-merge) remains the standing A136 target.

### P3

- **A214 — `DOW_NAME` in Analytics.svelte:88 duplicates core `DOW_LABEL`** (core.ts:342, identical
  array) — an A29 single-source violation introduced by the A197 chips.
- **A215 — dead code from the F37 build:** `FILE_BUDGET_BYTES` (dashboard.svelte.ts:35) and the
  exported `dash.filesBytes()` have no consumer — CsvLibrary computes its own `usedKb` against its
  own `FILE_BUDGET_KB`. Two constants encode the same 50 MB decision; one should own it.
- **A216 — trademeta orphans on both delete paths.** `Store.deleteFile` (per-file cascade) and
  `dash.deleteTrades` (Blotter bulk delete) remove trade rows but never their `trademeta` records —
  orphaned notes/tags/screenshots (base64, potentially large) accumulate in IndexedDB forever.
  `updateTrade` migrates meta correctly; the delete paths just skip cleanup.
- **A217 — `perFileActions` is constant-true dead config.** Post-F37 no caller passes `false`; the
  'Active dataset' header branch and the per-row gating live on only via the always-true prop.
  Per-row `legacy` gating is the real mechanism now — remove the prop + dead branches.
- **A218 — CLAUDE.md drift from today's features.** The adapter recipe's trade shape lacks
  `commission`/`fileIds`; store.ts is described as "(trades, journal, meta, trademeta)" (now six
  object stores); the core file list lacks `intake.ts`; the data-flow section predates
  F37/A208/F30 (docs/data-flow.md is current — CLAUDE.md should point there and stop restating).

## Disposition

Owner directed this pass to fix-all: findings are filed as A212–A218 and remediated immediately on
`feat/broker-override` (each closure recorded in the archive per donePolicy). R1 stays open.
