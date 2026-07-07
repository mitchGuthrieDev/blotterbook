# Repo audit — 2026-07-07 (R1, post cloud-sync GA)

*Scope: the full current codebase after this session's cloud-sync work — A254 (server erase-on-purge),
A265 (ledger compaction), A279 (sync-UX rework), and the CH16 prod GA of cloud sync. Four dimensions
audited in parallel (architecture/duplication, Svelte 5 / TS quality + UI wiring, security/moat,
correctness/tests/build), each finding adversarially verified against source before filing. Read-only.
Baseline green: `npm test` (all 14 node suites) + `npm run build` exit 0, no manifest drift, bundle
764.1 / 840.0 KiB.*

## Verified clean

- **The moat holds.** No plaintext trade/journal/meta/filter/layout/workspace-**name** field is ever
  serialized to `/functions`. Every one of the ~20 client network calls is same-origin `/api/*` or
  `/data/*`; the sync egress path encrypts + blinds (`cloudsync-core.ts:toWire`) before `transport.push`.
  The workspace **UUID**, not its name, is the sync key. A254 delete + A265 compaction are owner-only
  and touch only blinded ids + opaque blobs.
- **CSP + XSS.** `style-src 'self'` holds — no literal `style=""` in served markup (all grep hits are
  comments). `script-src` has no `unsafe-inline`/`unsafe-eval` (only `wasm-unsafe-eval`). The only
  `{@html}` sinks render a static hardcoded SVG const (`Home.svelte`), never user/CSV data; the
  backup-restore boundary is sanitized (`store.ts:importAll`).
- **Auth.** Every `/api/sync/*` route is session + Origin + ownership gated, fail-closed, cloud-tier
  enforced server-side on writes; constant-time compares; auth never depends on the fail-open rate
  limiter (S22). Complements `docs/audit-a277-server-enforcement.md`.
- **Core math + coverage.** `compute`/`costModel`/`curveseries`/`report`/`adapters` degenerate cases
  are pinned by concrete-value fixtures. A254/A265 are explicitly tested. Runes-only + `any`-free hold;
  `npm run typecheck` + `npm run lint` exit 0.

## Findings (12 filed as A281–A292; the doc-drift below fixed inline)

### P2

- **A281 — client/server `MAX_PUSH_RECORDS` drift breaks sync above 12 changed records.**
  `src/app/lib/cloudsync-core.ts:70` chunks pushes at `15`; the server lowered its cap to `12`
  (`functions/_lib/sync.ts:131`, A253) and 413s any batch >12 (`push.ts:72`). `transport.push` throws
  on `!res.ok` with no re-chunk → `runSync` lands in `status:'error'`. The first full push after a
  13+-trade CSV import fails. Now that sync is live on prod (CH16) this is a live availability bug.
  *Fix:* set the client constant to 12 to match the server cap.
- **A282 — Reports "CSV" export ignores the configured range/scope.** `src/app/App.svelte:579` runs
  `dash.allTrades.map(...)` while the preview + PDF/Markdown/Email/Copy all read `vm` (range-scoped via
  `reports.ts:86`). A user with Range=Custom gets the whole dataset in CSV, diverging silently from
  every sibling export. *Fix:* expose the scoped `trades` on `ReportVM` and serialize those.
- **A283 — the A208 per-trade fee rule is re-implemented in the SPA root, un-shared with `costModel`.**
  `src/app/App.svelte:491` (`rowBase`) duplicates `core.ts:910` (`hasActual ? t.commission : roundTurn`).
  They agree today, but the Blotter fee column will silently drift from the cost totals it reconciles
  against if the core rule changes. *Fix:* extract `feeForTrade(t, rate, qty)` in `core.ts`, call it
  from both.
- **A284 — the A279 sync direction actions have zero test coverage.**
  `pullFromCloud`/`pushToCloud`/`pauseCloudSync` + `runSync`'s `direction`/`forceFullPush` branching are
  untested. A regression (pull-only advancing the pushed-watermark; pause resetting the cursor) would
  ship silently. *Fix:* add an integration test over the existing mock D1/R2 harness asserting pull-only
  leaves the watermark, push-only re-uploads from -1 without discarding remote (LWW), pause keeps the
  cursor.

### P3

- **A285 — `buildReport` over-flags "estimated commission".** `report.ts:31` uses `!r.known` where the
  canonical rule is `estimatedCommRoots` = `!known && actual < count` (`core.ts:972`): a root whose
  trades all carry real CSV commissions never used the fallback rate and must not be flagged. *Fix:*
  use `estimatedCommRoots(c)`; add a fixture asserting `estNote === ''` for an all-actual unknown root.
- **A286 — Calendar daily "Target/day" is session-only.** `Calendar.svelte:80` (`let target = $state(200)`)
  drives the hit-target checkmark but is never persisted or shared, so it resets to $200 on reload and
  the Dashboard calendar has no marker. *Fix:* persist via the `store.local` seam + thread through App
  like `econMode`.
- **A287 — Dashboard module drag-handle icon is a dead affordance.** `Dashboard.svelte:610` renders a
  `GripVertical` grip but the module wrapper has no drag handlers (reorder is menu-only). *Fix:* wire
  pointer/HTML5 drag (as `DashTabs` does) or drop the grip icon.
- **A288 — cost-summary rows assembled three times.** `App.svelte:275`, `App.svelte:449`,
  `reports.ts:134` each hand-list Gross/Commissions/Subscriptions/1256-tax off a `CostModel`. *Fix:* one
  `costRowsFrom(c)` builder in `core/report.ts`.
- **A289 — advanced-stats mapping duplicated across three surfaces.** `analytics.ts:134`,
  `reports.ts:148`, `App.svelte:322` copy the same `Metrics`→label+formatter pairs. *Fix:* a shared
  `advStatRows(m)` menu.
- **A290 — Analytics underwater callout mixes a locally-walked `maxDD` with the compute prop.**
  `Analytics.svelte:262` re-derives `dd.maxd`; the callout (`:635`) shows `ddMoney(dd.maxd)` next to the
  `maxDDpct` prop. *Fix:* show the `maxDD` prop for the dollar figure; keep the local walk only for the
  shading indices.
- **A291 — dead export `expiryLabel`.** `core.ts:636` is exported + unit-tested but has zero product
  readers (only `expiryCode` is used). *Fix:* drop the export + its test, or surface the label.
- **A292 — `reconcileImport` authority map collapses duplicate `time|symbol|side` keys.**
  `intake.ts:176` builds `authPnl` as a `Map` keyed by `tkey` (no pnl/ordinal); two same-second
  identical-side same-symbol closed records keep only the last pnl, so an incoming fills-derived trade
  matching the first is dropped as phantom. Narrow (needs same-second identical scalps in a closed
  export overlapping a fills import). *Fix:* key the authority pnl by a multiset/array (or include the
  A114 dup ordinal).

### Fixed inline this pass (doc drift, not filed)

- **CLAUDE.md CH16 sweep leftovers.** The CH16 doc pass missed `CLAUDE.md:458` ("on staging only — wraps
  it in a `CloudStore`" — factually wrong post-A256) and two stale "Account is staging-gated, F53" labels
  (`:64`, `:359`; the Account screen is on prod). Corrected in this pass.
