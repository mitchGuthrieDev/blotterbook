# Repo audit — 2026-07-08 (R1 pass 3 — post-A271/A272/A315 delta + docs accuracy)

*Third pass of the 2026-07-07/08 R1 sequence, run after the pass-2 fixes (A297–A314) and the A271/A272/A315 feature work
landed. Four parallel read-only dimension agents (architecture/duplication, Svelte 5/TS quality + UI
behavior wiring, security/moat, correctness/tests/build/CI) plus two documentation-accuracy verifiers,
each adversarially verifying every finding against source before reporting; key P2s re-verified by hand
in synthesis (the drag-resize bug was independently found by two agents). Weighted toward the delta
since commit 8972210 (the Analytics module-sizing rework, `modlayout.ts` `makeLayoutKit`, Calendar
viewport fill, the A315 changelog-email rework) with a broad sweep behind it. Findings filed as
A317–A325; R1 stays open (recurring).*

## Headline

Baseline **green** before the pass: `npm test` (all 17 node suites + lint + typecheck + format),
`npm run build`, `size-budget` (785.1 / 840.0 KiB), `check-deploy` (14/14), no manifest drift. The moat
is **intact** — no new egress, CSP `style-src 'self'` holds, the only `{@html}` sinks are static
hand-authored SVG constants, functions auth is sound, deps pinned, no committed secrets. **No P1.**
The real findings are two P2 behavior bugs in the delta — the corner drag-resize span math (right-column
modules can never reach Large) and a changelog broadcast that is ledgered + reported green even when
every email fails — plus the A271 rework having copy-pasted the whole DOM-side size controller into
Analytics, and a batch of doc drift.

## P2 — behavior / delivery (filed A317–A319)

- **A317 — Corner drag-resize can never enlarge a right-column module, and an interrupted drag wedges
  the preview.** `Dashboard.svelte:447-453` / `Analytics.svelte:167-173`: `startResize` captures
  `cardLeft = card.getBoundingClientRect().left` once and snaps to
  `(ev.clientX − cardLeft) / trackW`. For a Medium module rendered in the right column (grid tracks
  7–12 — e.g. `ls`/`wday` on Analytics, `cost`/`term` on the default Dashboard), `cardLeft` sits at the
  grid midpoint, so the guess maxes out at ~6 tracks with the pointer at the grid's right edge; the
  Large midpoint threshold (9) is unreachable and the handle is inert. Same drag works on left-column
  modules, so the affordance appears randomly broken. Also: teardown is registered only for `pointerup`
  — a `pointercancel` (touch interrupted, pen out of range) leaks the listeners and freezes
  `previewSize` for that key; and Dashboard's `fillClass` reads committed `sizeOf` while the span reads
  `previewSize`, so the 65vh fill pops only after release. *(Independently found by the behavior and
  correctness agents; re-verified in synthesis.)* Staging-gated (`isStaging`), so prod/demo unaffected.
  Fix (as built): compute the span from the drag delta against the span at grab time, with a DIAGONAL
  delta (x + y — a right-column handle has no room to travel right, but down always has room, matching
  the `nwse` cursor); add a `pointercancel` teardown that discards the preview; apply the LATEST move
  per rAF frame instead of dropping same-frame moves; key `fillClass` on the preview size.
- **A318 — A failed changelog broadcast is permanently ledgered and reported green.**
  `notify-changelog.ts:102-111` + `changelog-email.yml`: when Resend is down, `sendEmailBatch` returns
  `{ ok:false, sent:0, failed:N }` — the endpoint still calls `recordSend()` and returns **HTTP 200**,
  the workflow's `2??` case prints "Sent" and exits 0, and every retry thereafter answers
  `deduped:true`. Subscribers silently never receive that release and nothing alerts. Fix: skip the
  ledger + return 502 on total failure (`sent === 0 && failed > 0`) so the workflow's retry path
  engages; surface partial failure in the workflow log; pin with a node assertion in `test-email.mjs`.
- **A319 — The A271 module-size controller is duplicated wholesale between Dashboard and Analytics.**
  The pure math went to `makeLayoutKit` (good), but the DOM-side controller — `sizesOfProp`/`sizeOf`/
  `spanClass`/`SIZE_LABEL`/the `lastModKey` echo-guard `$effect`/`emitLayout`/`setModuleSize`/
  `sizeIndex` and the full pointer-resize block (`Dashboard.svelte:382-479` vs
  `Analytics.svelte:117-199`; `startResize`/`onResizeKey`/`nearestSize`/`previewSize` token-identical)
  — plus the `role="slider"` corner-handle markup and the ⋯-menu Size radio group are verbatim copies.
  A271 names Calendar as the next sized screen, so a third copy is imminent, and the A317 bug already
  had to be found twice. Fix: extract a `createSizeController(kit, …)` factory into a DOM-side
  `src/app/lib/modsize.svelte.ts` (NOT `modlayout.ts` — `test-modlayout.mjs` imports it in node) + a
  shared handle/menu part. Fold in: Analytics' `animate:flip` is dead code (its each iterates a
  constant array that never reorders) and its comment advertises an animation that never runs.

## P3 — correctness / hygiene / docs (filed A320–A325)

- **A320 — Module key/label tables are mirrored across files with no drift gate (+ an orphaned
  duplicate + no key dedupe).** Each domain's key set exists twice — `modlayout.ts:88,113` as data,
  `Dashboard.svelte:362-373` / `Analytics.svelte:107-116` as keys+labels — held in sync by comments
  only; drift fails silently in the persistence layer (`migrateLayout` strips the unlisted key from
  every persisted layout). `DEFAULT_MODULE_KEYS` is defined twice, and the Dashboard export is orphaned
  with a stale A148 rationale comment (`Dashboard.svelte:8`, `App.svelte:48` — the template save now
  uses modlayout's `defaultLayout()`). `migrateLayout`/`validLayout` also don't dedupe keys, so a
  corrupted/tampered stored layout with a duplicated key reaches Dashboard's keyed `{#each}`. Fix: move
  the `{key,label}` tables into `modlayout.ts`, derive the key sets, import the labels in the screens,
  dedupe in migration, drop the now-superfluous exports; extend `test-modlayout.mjs`.
- **A321 — `/api/notify-changelog` has no rate limiter in front of its shared-secret check**
  (`notify-changelog.ts:43-49`). Every sibling sensitive endpoint calls `rateLimited()` first; here an
  anonymous caller can hammer the constant-time compare at unlimited rate. Defense-in-depth only (the
  compare is sound, the secret high-entropy, blast radius capped by the per-version ledger).
- **A322 — Analytics quick-range presets mix UTC and local dates** (`Analytics.svelte:247-257`).
  `daysAgo()` derives the boundary via `toISOString()` (UTC) while YTD uses local `getFullYear()`; for
  a US-timezone user in the evening "30D" starts one calendar day ahead of the local day (trade dates
  are local). `RANGES` is also `$derived.by` with no reactive deps, freezing `now` per mount.
  Pre-existing (A197 era) but lives in the delta-reworked file.
- **A323 — The CI drift gate re-runs only `build-manifest.mjs`** (`ci.yml:110-122`);
  `static/data/econ-events.json` is generated-and-committed from the deterministic, network-free
  `build-econ-events.mjs`, so editing the script without regenerating (or hand-editing the JSON) passes
  CI. Also: the local `npm run ci` chain omits `check-mermaid`, which CI runs (parity nit).
- **A324 — Delta test-coverage gaps.** `buildAnalytics`'s hour-of-day bucketing (`slice(11,13)` parse,
  avg rounding), symbol win% rows, byTag/untagged rows, and `holdCoverage` have no node assertions; the
  corner drag-resize path has zero e2e coverage on either screen (the staging spec covers only the
  ⋯-menu path — the A317 bug lived exactly in the untested path).
- **A325 — Docs accuracy batch** (from the two doc-verification agents; every claim re-checked against
  code). Highlights: CLAUDE.md + architecture.md describe a boot sequence with a `restoreSession()`
  that doesn't exist and mount() last (mount is first; boot runs post-mount); README's Quick-start
  names retired pre-CH16 controls ("Load CSV" / "Start Blotterbook" / "Manage data"); architecture.md
  says the staging gate "stays open" without `ADMIN_KEY` (it fails closed, S12);
  functions/README.md says `/api/geo` is "NOT called by the app" (it is — A201 prefill);
  CLAUDE.md self-contradicts on the shadcn CLI (wired vs egress-blocked), omits `/api/sync/delete` +
  `/api/account/{delete,passkey-delete}` from its endpoint lists, `econ:loaded` from the event-bus
  list, and `src/dev` from the svelte-check scope; cloudflare-functions diagram still says push cap
  "≤15" (server is 12, A253/A281); cloud-sync-ux-a279.md misses the three A306 pill states, names a
  nonexistent `forceFullPush` option, and has stale `pending` semantics; storage-and-mode-separation
  diagram names a nonexistent `DB_NAME` symbol (now `LEGACY_DB_NAME`/`WS_DB_PREFIX`);
  boot-and-lifecycle's onboarding formula misses the A235 no-CSV-files condition + F48 stickiness;
  accounts-architecture attributes `passkey-delete.ts` to A305 (it's A302) + drifted App.svelte line
  refs; ui-redesign.md still points at the deleted old App.svelte's `<style>`; `admin-key.ts:8-10`
  header comment describes the retired fail-open presence-auth (code fails closed, S12);
  `App.svelte:211-213` comment calls `DemoStore.local.set` "a no-op" (it writes the in-memory map —
  the invariant holds but the wording contradicts the source).

## Dropped in verification

- *`phosphor-svelte` is an unused dep* — refuted: deliberately imported by the dev-only
  `Styleguide.svelte` for the A180 lucide-vs-phosphor comparison (16 imports + a weight-axis demo).
- *Turnstile network-failure fail-open* — documented deliberate posture; double opt-in is the control.
- *Superfluous exports as standalone finding* — folded into A320's restructuring.

## Verified CLEAN (recorded so the next pass doesn't re-audit)

- **Moat/egress:** full `fetch|XHR|sendBeacon|WebSocket|EventSource` sweep of `src/` — only `/data/*`
  ref-data, the documented `/api/*` endpoints, and the sync transport; no beacons, no external URLs; the
  new code paths (`modlayout.ts` pure math, Analytics layout persistence via `store.local`, Calendar/
  Howto reworks) are egress-free; demo's `DemoStore.local` is the in-memory map, so the new Analytics
  layout persistence needs no `isDemo` guard and persists nothing on demo.
- **CSP/XSS:** zero literal `style="` in `src/`; `_headers` intact (`style-src 'self'`,
  `script-src 'self' 'wasm-unsafe-eval'`); only `{@html}` sinks are `Home.svelte`'s static SVG consts.
- **Functions:** notify-changelog auth sound (fail-closed 503/401, constant-time HMAC compare, 425
  deploy gate, per-version ledger, confirmed-only fan-out, rotated one-click unsubscribe);
  `changelog-email.yml` leaks no secrets and has no shell injection; `/api/sync/*` still verify
  session + ownership + origin + tier (delete deliberately un-paywalled); `admin-key` fails closed.
- **Supply chain / secrets:** all deps exact-pinned, lockfile present, no new deps since 8972210, build
  scripts fetch nothing remote; secret-pattern grep clean (test placeholders only).
- **Svelte/TS constraints:** runes-only, `src/` any-free, no `@ts-ignore`; keyed each-blocks sound;
  the two prop-reseed `$effect`s are legitimate echo-guarded sync points; `rafPending` cancelled on
  pointerup; ModuleCarousel clamps/wraps; histogram drill-down bounds safe (fixed 8 buckets, half-open
  `[lo,hi)` agrees exactly between builder and filter); statDetail label keys match `analytics.ts`.
- **Core reuse / layering:** Analytics/Calendar import `usd`/`usdWhole`/`tone`/`isoWeek`/`monthCells`/
  `dowPnlRows`/`decimateMinMax` from core — no re-implementations; core imports nothing from
  app/site/svelte; site imports nothing from app; no circular imports; all parts/lib files have
  importers; the local Analytics drawdown walk is chart-geometry only (dollar figure uses the compute
  `maxDD` prop, A290).
- **modlayout/persistence:** v1→v2 migration lossless + defensive, domain isolation pinned by tests,
  storage keys distinct + per-surface namespaced — no cross-domain or cross-surface corruption path;
  Analytics echo-guard correct.
- **Build/CI:** all 17 suites wired into `test:unit`; drift gate (manifest), `size-budget`,
  `check-deploy`, `check-mermaid`, e2e-against-dist all run in CI; every delta path classifies in
  `bump-version.mjs` (`check-deploy-contract` sweeps `git ls-files src static`); A315 pages.dev
  routing + 425 retry loop bounded + idempotent, node-tested; no-dead-controls allow-list honest.
- **Calendar A272:** `ROWS_CLASS` counts match the real grid rows, 4/5/6 + fallback, lg-only (A182
  mobile untouched); Card is `flex flex-col` so `lg:flex-1` works as commented.
- **Docs verified accurate** (spot-checked, no action): data-flow.md in full; auth-flow.md (all four
  diagrams); synced-workspaces.md; ci-pipeline.md; versioning-two-track.md;
  compute-costmodel-render.md; csv-import-adapters.md; core-reuse-map.md; build-and-deploy.md;
  repo-layout-url-contract.md; changelog-email-a141.md as-built notes; ADR-001/002 current-state
  claims; the 17-suite/10-entry/840-KiB/20-primitive/23-part/8-screen counts.

## Outcome

Filed **A317–A325** (9 items: 3 effectively-P2, 6 P3) — all nine **fixed and closed this same pass**
(shipped in this PR) per the session's mandate, with the docs batch (A325) applied as a full
documentation-accuracy sweep. R1 stays open (recurring).
