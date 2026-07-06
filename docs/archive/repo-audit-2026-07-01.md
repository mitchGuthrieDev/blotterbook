# Repo audit — 2026-07-01 (R1, fourth full pass)

Recurring full-repo audit (backlog **R1**), read-only, run after today's docs/tooling work landed
(the `prettier-plugin-svelte` adoption #90 and the architecture-diagrams + Mermaid CI gate #91). Four
dimensions were audited in parallel — **architecture & duplication**, **Svelte 5 / TS quality**,
**security posture**, and **build / CI / correctness** — each finding adversarially verified against
source before filing. **No code was changed** (R1 is read-only; findings ship as new backlog items).

**No P1. No P2 security or correctness findings.** The repo remains in **strong shape**. The only
genuine findings are small helper duplications (drift risk) and two low-risk hygiene items, filed as
**A129–A131**. **R1 stays open** (recurring).

## Baseline (measured this run)

- `npm run typecheck` — **0 errors / 0 warnings** (tsc core + tsc functions + svelte-check).
- `npm run lint` — clean. `npm run format:check` — clean.
- `npm audit` — **0 vulnerabilities**.
- `npm run build` — succeeds; **size budget 516.8 KiB / 600.0 KiB** (83.2 KiB headroom).
- Constraint greps: **0** `export let`, **0** `$:`, **0** `createEventDispatcher`, **0** `svelte/store`
  writables, **0** real inline `style=` attrs, **0** real `: any`/`as any`, **0** `indexedDB`/
  `localStorage` outside `store.ts`. `{@html}` confined to static developer-authored SVG constants
  (`Home.svelte` `FEATURES`).

## Headline — three of four dimensions came back clean

- **Security — clean (the moat holds).** No trade-data egress: every `fetch` is same-origin
  reference data (`/data/*.json`) or `/api/*` config/geo; the only POST bodies carry admin
  `{mode,label}`/`{flags}`, never trade/journal/CSV data. CSP is tight (`style-src 'self'`,
  `script-src 'self'`, no `unsafe-inline`; `object-src 'none'`, `frame-ancestors 'none'`). No
  `innerHTML`/`eval`/`new Function`; `{@html}` only on static SVG. Backup restore + screenshot import
  are sanitized at the trust boundary (`importAll` → `rootSym`/`cleanTag`/`validDate`/`SHOT_RE`).
  Functions verify the Access JWT (RS256/JWKS), the Stripe signature (raw body, replay window), and
  the admin token (HMAC, constant-time, fail-closed staging gate).
- **Svelte 5 / TS quality — clean.** Runes-only throughout; `src/` is `any`-free (the handful of
  `Record<string, unknown>` are documented JSON/IndexedDB boundaries). No hand-written `.js` in
  `src/`; the one `.svelte.ts` (`dashboard.svelte.ts`) correctly owns the dashboard runes. `$effect`
  is used only for genuine subscriptions/imperative sync, never where `$derived` would do.
- **Correctness / build / CI — clean.** `compute`/`costModel`/`dailySeries`/`pairFills` verified: DB0
  guards on pf/wl/Sharpe/Sortino/recovery, tax only on positive net, subscription span accrual
  (A117), FIFO same-second stability + realized apportionment (A115), UTC hold time (A120). The
  deploy-contract guard classifies all tracked shipping paths; the manifest/bundle/mermaid/generated-
  outputs drift gates are all wired; `bump-version.mjs` prod/staging classification covers
  `src/lib/components/ui/**`, `src/lib/utils.ts`, `src/styles/*.css`, `src/site/**`.

The dimension that surfaced real (if minor) findings was **architecture & duplication**.

## Prioritized findings (filed — read-only)

| Sev | Finding | Filed |
| --- | --- | --- |
| **P2** | **Small helpers duplicated across app glue → drift risk.** `pad2` is redefined locally in `App.svelte:281` (core already exports it at `core.ts:7`, but `App.svelte:11` doesn't import it); `iso` in `reports.ts:31` re-implements `fmtDate` (`core.ts:8`); `tone` (`n>=0?'pos':'neg'`) is copy-pasted in `App.svelte:156`, `analytics.ts:27`, `reports.ts:30`; the month-names array `MON` is duplicated in `App.svelte:44` and `reports.ts:29`. Same class as the `money()`/`usd()` drift fixed in the prior pass. Fix: export `tone` + `MONTH_NAMES` from `core.ts`, import `pad2`/`fmtDate`/`tone`/`MONTH_NAMES` at all sites, drop the locals. | **A129** |
| P3 | **Live-entered journal tags aren't canonicalized like the restore path.** `Calendar.addTag` (`Calendar.svelte:61`) trims + dedupes case-sensitively but does **not** lowercase or strip markup, and the live save path (`store.saveJournal`, `store.ts:166`) only `.filter(Boolean)`s — whereas backup restore runs `cleanTag` (lowercase + strip `[<>&"']` + dedupe, `store.ts:277`). So an uppercase live tag (`Scalp`) won't match the lowercased tag filter/chips or restored tags. Low security risk (Svelte auto-escapes on render), but a real canonical-form inconsistency. Bonus: the `store.ts:275` comment cites `annCapture` as the live editor that "lowercases + dedupes" — **no such function exists** (stale). Fix: canonicalize tags on the live save path and correct the comment. | **A130** |
| P3 | **Unused export `minMax`** (`core.ts:12`) — exported but imported nowhere in `src/` or the test suites (dead code). Remove, or annotate as an intentional public-API/future seam. | **A131** |

## Claims rejected on verification

- **"`dowBuckets` is an unused export."** False — it's used inside `compute` at `core.ts:222`
  (`const dow = dowBuckets(tr)`). Not filed.
- **"`Changelog.svelte:98` `{#each r.highlights as h}` is missing a key."** Keyless `{#each}` over a
  render-once list of plain strings is idiomatic Svelte 5; keying by value `(h)` would actually
  *break* on duplicate highlight strings. Not a defect. Not filed.
- **"Extract `Dashboard.svelte`'s 40-line `interface Props` to `types.ts`."** Screen-local `Props`
  interfaces are the established house pattern (the prior pass explicitly accepted inline component
  `Props`); these types are cross-component contracts declared at module scope. Not filed.
- **"`addTag` missing a constant-time compare / security P3.2."** The security agent's own follow-up
  concluded the primary token path uses native `crypto.subtle.verify` (constant-time) and the raw-key
  fallback uses `timingSafeEqual`; no action. Not filed.

## Observations (not filed)

- **A109 "Create architecture diagrams for /docs" is now satisfied** by PR #91 (`docs/architecture-
  diagrams/` + the Mermaid CI gate) — recommend archiving it done. **A110** (data-flow / data-
  management overview) is partially addressed by the new `storage-and-mode-separation` and
  `compute-costmodel-render` diagrams.
- **Bundle trend:** the `/app/` JS budget was raised **480 → 600 KiB** since the last pass and the
  surface now measures **516.8 KiB** (was 399.1). Growth is expected from the shadcn/bits-ui
  re-platform + more screens, but the headroom is now ~83 KiB — worth watching, not filing.
- **Coverage gaps** (`sessionOf`, `reportHtmlDoc`, the pure formatters) remain unit-untested but are
  exercised by e2e/manual export flows — acceptable, consistent with the prior pass's stance.

## Method

Four parallel read-only agents (one per dimension) → consolidate/dedupe → **adversarially verify each
claim against source** (dropping the four above) → measure the baseline directly → file the surviving
findings as new backlog items. **R1 stays open** — it is a recurring driver; each pass ships its
output as new items (this is the fourth pass; A113–A128 from prior passes are archived done).
