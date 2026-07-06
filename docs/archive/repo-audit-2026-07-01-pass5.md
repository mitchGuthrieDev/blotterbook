# Repo audit — 2026-07-01, pass 5 (R1, post-#92)

Recurring full-repo audit (backlog **R1**), read-only, run the same day as — and immediately after —
the fourth pass's quick-win batch landed (**#92** `dd0a6aa`: the A129 helper consolidation, A130 tag
canonicalization, A131 `minMax` removal, A134 demo-import lockdown, A140/A143/A144/A145 UI fixes).
Four dimensions were audited in parallel — **architecture & duplication**, **Svelte 5 / TS quality**,
**security posture**, and **build / CI / correctness** — and every filed claim was **adversarially
re-verified against source by the coordinator** before filing. **No code was changed** (R1 is
read-only; findings ship as new backlog items **A147–A164**).

Where pass 4 found "three of four dimensions clean," this pass dug into **feature-level behavior**
(what the shipped screens actually do when clicked) and found what static constraint-checking can't:
**one P1 and six P2s, all user-visible functional bugs** — most of them mock leftovers or seams that
survived the CH16 cutover. The hard constraints all still hold: **no P1/P2 security findings, the
moat is intact**, and the baseline is green across the board. **R1 stays open** (recurring).

## Baseline (measured this run)

- `npm test` — green (lint, tsc core + functions + svelte-check **0/0**, format:check, all 7 suites).
- `npm audit` — **0 vulnerabilities**; all 24 deps exact-pinned, lockfile in sync, **no install hooks**.
- `npm run build` — succeeds; size budget **517.0 KiB / 600.0 KiB** (83.0 KiB headroom); `check-deploy` 14/14.
- Constraint greps: **0** `export let` / `$:` / `createEventDispatcher` / `svelte/store` writables /
  inline `style=` / `: any` / `as any` / out-of-seam `indexedDB`·`localStorage` (every raw grep hit
  is a comment). `{@html}` confined to the static developer-authored SVG constants in `Home.svelte`.

## Security — the moat holds (verified clean, again)

Exhaustive egress inventory: every `fetch` in `src/` is same-origin `/data/*.json` or `/api/*`
config/geo; the only POST bodies are admin `{mode,label}`/`{flags}` — **never trade/journal/CSV
data**. No third-party script/font/CDN in any shell; the one `window.open` is the admin → staging
link (`noopener`); the one `location.href` write is the user-clicked Reports `mailto:` export (an
export to the user's own mail client, same class as the CSV/Markdown downloads — not egress). CSP
unchanged and tight. Functions: staging gate fails closed, admin token constant-time, Stripe webhook
raw-body + replay-window verified, no secret echoed anywhere. Demo non-mutation holds by
construction (in-memory `DemoStore`) and by e2e (no Blotterbook IndexedDB created). #92's
`cleanTags` change strictly *strengthens* the tag trust boundary. Residual security findings are all
P3 defense-in-depth (A154/A155 below).

## Prioritized findings (filed — read-only)

| Sev | Finding | Filed |
| --- | --- | --- |
| **P1** | **The onboarding "Choose a CSV file" button does nothing.** `Onboarding.svelte:70-78` nests the CTA `<Button>` (a real `<button>`) inside the `<label>` wrapping the `sr-only` file input — per the HTML spec, label activation is suppressed when the click targets an interactive descendant, so the click never reaches the input (empirically confirmed in Chromium). The label contains nothing else clickable, so on the first-run `/app` surface the primary import CTA is dead; drag-and-drop is the only working path, and e2e never clicks the CTA (`boot.spec.mjs:17` only asserts the heading). Also: the dropzone `div role="button" tabindex="0"` has no `onkeydown`. Fix: drive a hidden input programmatically like `CsvLibrary` does; add keyboard handling; add an e2e that clicks the CTA. | **A147** |
| **P2** | **Saving a workspace layout while on the default layout stores `[]` → applying it blanks (and persists) an empty dashboard.** `dashModules` is `undefined` until customized (`App.svelte:88`), "Save current layout…" captures `[...(dashModules ?? [])]` (`App.svelte:111`) = `[]`, and `validKeys([])` (`Dashboard.svelte:142`) passes `[]` through (only nullish triggers the default) — all four modules hidden, persisted to `Store.local`, survives reload. | **A148** |
| **P2** | **The Blotter detail drawer ships dead write controls that silently discard input.** The journal-note `<textarea>` has no binding, `Save` / bulk `Tag` / bulk `Delete` / "Add" tag / "Drop a chart image" have no handlers (`Blotter.svelte:193-194,377-401`) — a note typed there and "saved" is lost silently (the working path is the Trade Editor). Mock leftovers from the CH16 cutover. The drawer is also a hand-rolled overlay (no Esc, no focus trap) where `CsvLibrary` correctly uses `Sheet`, and rows open mouse-only. Fix: wire through `dash.saveTradeMeta`/`deleteTrades` or remove until implemented; rebuild on `Sheet`. | **A149** |
| **P2** | **Calendar ISO-week labels are wrong for every Sunday-led full row.** The row label uses the first non-null cell (`Calendar.svelte:122`) — the Sunday, whose ISO week is the week that *ended* that day, while the row's Mon–Sat trades belong to the next ISO week (July 2025 renders W27, W27, W28, W29, W30 — the weekly P&L total attributed to the wrong week number in essentially every month whose 1st isn't a Sunday). The screen also carries a private `isoWeek` reimplementation (`:98-103`) while the unit-tested `core.isoWeek` has zero app consumers. Fix: label by the row's Monday and import the core helper. | **A150** |
| **P2** | **The core event bus has zero emitters — the Activity Terminal can never populate on ANY surface.** `emit()` (`core.ts:72`) has no callers in `src/`; `ActivityTerminal` subscribes to 8 events none of which is ever fired, so the Dashboard Activity module permanently renders "Waiting for activity…" on app, demo, *and* staging. The last emitters died in the CH16 cutover (`git log -S`). Corrects **A133**, which misdiagnoses this as staging-only ("as it does on the other surfaces" — it works nowhere). Fix: emit from the `dashboard.svelte.ts` actions (+ `doBackup`), or retire the bus + module; update the data-flow docs either way. | **A151** |
| **P2** | **The Calendar screenshot lightbox is wired but has no dialog.** `zoomShot` is set on click (`Calendar.svelte:461`), `zoomOpen` (`:82`) is never read, the `Dialog` import (`:18`) is unused, and the file contains no `<Dialog.Root>` — "Enlarge screenshot" does nothing. The working twin exists in `TradeEditor.svelte:579-590`. Fix: extract a shared `ScreenshotLightbox` part and mount it in both. | **A152** |
| **P2** | **#92's tag canonicalization (A130) is incomplete: no migration/read-path story, and the in-memory cache diverges.** Pre-#92 mixed-case tags persist raw in IndexedDB forever: `Scalp` and `scalp` become two filter chips, and a re-save silently changes a tag's identity so pre-existing saved filter views stop matching with no signal (`store.ts:189,239` read raw; no `init()` migration). Separately, `saveNote` caches the **raw** record while the store persists `cleanTags` (`dashboard.svelte.ts:199-214`) — a live-entered `R&D` chip reads `R&D` all session, `rd` after reload; a tag canonicalizing to `''` makes the store delete the record while the local calendar note-dot stays lit. UI entry points (`Calendar.addTag`, TradeEditor) still don't canonicalize, and `cleanTags` has no unit fixture. | **A153** |
| P3 | **CSV export/import trust-boundary hardening (three related gaps).** The trades-CSV export escaper (`App.svelte:416`) doesn't neutralize spreadsheet formula prefixes (`=`,`+`,`-`,`@`, tab); the Trade Editor persists the free-typed symbol verbatim as `root` (`dashboard.svelte.ts:165`), bypassing the `rootSym` sanitizer every other `root` write path enforces; `importAll` restores `time`/`qty`/`side`/trademeta `note` un-validated and a crafted trade's own `id` key survives the copy and **overrides the computed hash** in `addTrades`' `store.put({ id, ...t })` (spread order), corrupting dedupe under an attacker-chosen key. Chain: restore untrusted backup → export CSV → open in Excel. All defense-in-depth today (Svelte auto-escapes; requires an untrusted backup). | **A154** |
| P3 | **`verifyAccessJwt` treats `exp` and `iss` as optional claims** (`functions/_lib/auth.ts:178,181` — a JWKS-signed assertion *missing* `exp` never expires; missing `iss` skips the issuer check). Alg pinning, `aud`, `nbf`, signature all correct, and Cloudflare Access always emits both — hardening, not a bypass. Plus: the `_middleware.ts` header comment still advertises the removed `?k=` query-param path (S19). | **A155** |
| P3 | **Reports downloads ignore the configured title/account and section toggles.** `Reports.svelte` collects `meta={title,account}` and passes it to `onexport`; `App.svelte:410` drops it — the Markdown/text/email payloads hardcode "Blotterbook — Performance Report" and always include all sections, while the on-screen preview (and PDF via print) honors the settings. Plus a duplicate `ExportKind` declaration in the same file. | **A156** |
| P3 | **Helper duplication batch — the A129 class, next ring out.** `dowBuckets` re-implemented verbatim in `analytics.ts:68-73` (core's own comment: "so the two can't drift"); weekday-label array triplicated (core `DOW_LABEL` has one consumer); `fmtDate`/`pad2` inlines at `Calendar.svelte:174`, `Reports.svelte:63-66`, `adapters.ts:71`; `tone` ternaries still inline in Calendar/Blotter markup; short-month array duplicated; fees hand-formatted instead of `money()` (loses grouping); `minMax` was deleted by A131 while its intended consumers still hand-roll the loop (Reports/Dashboard) and `linePath` is re-rolled in Reports/Analytics; the round-turn formula `rate*2*qty` is stated 4× (candidate core `roundTurn()`); month-grid scaffolding built independently 5× (candidate `monthCells()`); ~29 inline `'text-chart-2':'text-destructive'` ternaries (candidate `pnlClass()`); `isBeta` is a third implementation of the major<1→Beta rule; Blotter↔TradeEditor duplicate the pagination block + footer verbatim and Dashboard↔Calendar duplicate the `seg` snippet. | **A157** |
| P3 | **Dead code prune + one latent reactivity hazard.** `PanelBundle` (`types.ts:225`) and `reportHtmlDoc` (`report.ts:102`) are exported, referenced nowhere; the dashboard factory exposes `breakEvenMetrics`, the raw `journal` getter, and `reloadAll` with no external callers; `TradeEditor.svelte:214` mutates a `$state` Map in place (`original.delete(id)`) — non-reactive, currently masked by the adjacent `draft` reassignment, breaks on refactor. | **A158** |
| P3 | **Tag-filter plumbing is UI-unreachable since CH16** — `applyFilters`' tag branch, `dash.tags`, and the persisted saved-view `tag` field are live code with no UI control (the Dashboard `FilterModel` has no `tag` member), so saved views always persist `tag:''` and **R17**'s premise ("surfaced in the dashboard Tag filter") is stale. Decide: restore a tag control in the Filters popover, or delete the plumbing. | **A159** |
| P3 | **CsvLibrary's dropzone advertises drag & drop but implements none** — no `ondrop`/`ondragover` in the file; dropping a CSV triggers the browser default and **navigates the tab away from the app**. Rows are also mouse-only (`onclick` on `<tr>`, no keyboard path). | **A160** |
| P3 | **Gate gaps.** e2e demo write-guards use `if (await x.count())` conditional assertions that vacuously pass if the control is renamed (`interactions.spec.mjs:~83,111`); the deploy-contract guard and `bump-version` classification cover `src/ + static/data` only — shipping files under `static/` outside `data/` (`_headers`, `_redirects`, `robots.txt`, `sitemap.xml`, og-image) are unclassified, so a new served static file bumps nothing and no gate fails. | **A161** |
| P3 | **Untyped fetch boundaries** — `loadRefData` (`core.ts:412-427`) and the `versions.json` fetch (`App.svelte:553`) flow `r.json()` out as implicit `any`, contrary to the house rule the site components already follow. Declare the ref-data shapes in `types.ts` and cast at the boundary. | **A162** |
| P3 | **Docs drift** — CLAUDE.md says the bundle budget is a "480 KiB ceiling" (actual 600 KiB since CH16) and "11 HTML entries" (actual 10 post-cutover); ADR-002 repeats the 480; CLAUDE.md's data-flow section documents the event bus as live (see A151). | **A163** |
| P3 | **#92's own two cosmetic regressions.** A145 resized only Home's bespoke header — the shared `Nav.svelte` on howto/roadmap/changelog/legal keeps the old sizing, so the site header visibly jumps between `/` and the info pages; A140's Calendar heat ramp (10/18/28/40/55) no longer matches the legend swatch alphas (`/20` mid-swatches) despite the comment claiming it does. | **A164** |

## Claims rejected on verification

- **"The Reports `mailto:` is data egress."** No — it's the user-clicked Email export building a
  `mailto:` handed to the user's own mail client, the same trust class as the CSV/Markdown downloads
  and clipboard copy. Not egress; not filed.
- **"`TradeEditor.addTrade` hardcodes `date: '2026-06-30'`."** True but unreachable — `coreEditable`
  is `false` at every mount site, so the add-row affordance never renders. Noted, not filed.
- **"`version-bump.yml` can exit 0 after failed pushes."** Deliberate (branch-protection note in the
  warning) and serialized by the concurrency group; `ci.yml` itself has no `|| true` /
  `continue-on-error` anywhere. Observation only.
- **"`noUncheckedIndexedAccess` off hides bugs."** No concrete bug traced to it (the
  `BROKERS[k].name` sites trust `brokers.json` integrity — a data-contract assumption, not a code
  bug). Observation only.
- **"`styleProps` doesn't clear removed keys."** All call sites pass stable key sets; documented
  behavior. Not filed.

## Observations (not filed)

- **The two implementations of `isoWeek` agree** for every date 2019–2032 (verified numerically) —
  the A150 label bug is a *call-site* bug, not an algorithm divergence; the duplication is filed for
  drift risk, not current wrongness.
- **#92's helper consolidation is behavior-preserving** — `tone`/`pad2`/`MONTH_NAMES`/`fmtDate`
  swaps are byte-identical to the removed locals; no rounding/locale/sign/negative-zero/NaN change
  anywhere. Timezone handling is consistently local-time end to end, and `priorBounds` is DST-safe.
- **Bundle headroom** unchanged since pass 4: 517.0/600 KiB. Still worth watching, not filing.

## Method

Four parallel read-only agents (one per dimension) → consolidate/dedupe (the tag cluster and the
`isoWeek` duplicate were each reported by two agents independently — treated as corroboration) →
**coordinator re-verified every P1/P2 and each security claim directly against source** (the
onboarding label structure, the `[]` layout capture, the dead Blotter controls, the Sunday ISO-week
call site, the zero-`emit()` grep, the missing lightbox Dialog, the export escaper, the editor
`root` path, the `exp`/`iss` conditionals) → measure the baseline directly → file the survivors as
**A147–A164**, correct A133's scope, and annotate R17. **R1 stays open** — this is the fifth pass;
pass 4's A129–A131 landed in #92 the same day.
