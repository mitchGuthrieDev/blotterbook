# Repo audit — 2026-07-02 (R1, pass 6)

Read-only audit of the current tree (post-#94 + the A179–A189 feature batch: dashboard tabs v2 with
staged layouts, the add-modules picker, the activity-log replay buffer, the mobile layout pass, the
A180 Phosphor spike). Four parallel auditors — architecture/duplication, Svelte 5/TS quality,
security, correctness/build/CI — each required to verify claims against source with `file:line`
evidence; the coordinator independently re-verified the P2 and the dev-chunk claim against the
built `dist/`. Per the R1 charter no code was changed — each finding is filed as a backlog item
(**A190–A195**).

**Headline: no P1s; the moat and the calc core hold.** Pass 5's P3 batch (A147–A164) is verified
remediated, the A66 calc remediation (A168–A175) is intact, the staged-layout/tab-draft state
machine traces correctly through every switch/revert/delete edge, and the security posture is
clean end-to-end (no egress, CSP intact, seam-only persistence, functions auth hardened per A155).
The findings are one measurement gap the #94 code-split opened (P2) and a P3 tail of drag-UX,
consistency, coverage, and drift items.

## P2 — real gaps

| # | Finding | Filed |
| --- | --- | --- |
| 1 | **The bundle-size gate stopped measuring 6 of 7 app screens after the #94 code-split.** `scripts/check-bundle-size.mjs:44` sums only the `<script src>` chunks statically referenced by `dist/app/app.html`; the screens are `import()`-loaded (`src/app/App.svelte` SCREEN_LOADERS), so their chunks (`index-*.js` ~46 KiB, `CsvLibrary-*.js` ~26 KiB, …) escape the sum. Pass 5's 517 KiB → today's 411 KiB is the screens *leaving the measurement*, not shrinking — a heavy import in any lazy screen now ships past the 600 KiB ceiling silently, and the script's own header comment ("a stray heavy import … can't bloat the download silently") is false. | **A190** |

## P3 — quality, consistency, coverage, drift

| # | Finding | Filed |
| --- | --- | --- |
| 2 | **`phosphor-svelte` named imports do not tree-shake — an 8.5 MB dev chunk ships in `dist/` every deploy.** `dist/assets/devcomponents-*.js` is 8,469,825 bytes (the build's chunk-size warning); the comment at `src/dev/Styleguide.svelte` ("named imports stay tree-shaken") is contradicted. Unlinked + noindex, so deploy bloat rather than a user regression. | A191 |
| 3 | **DashTabs drag-reorder commits + persists on every `dragover` crossing** (`DashTabs.svelte` `dragOver` → `App.svelte` `reorderDashTab` → `persistTabs()`): N localStorage writes per drag, reorder fires on edge-entry (not midpoint) while `animate:flip` is animating (boundary thrash with unequal-width tabs), and an Esc/cancelled drop does not revert already-committed moves. Keyboard path unaffected. | A192 |
| 4 | **Workspace-template asymmetry under the staged-layout model:** `dashLayouts.apply`/`revert` route through `saveModules` and now only *stage* (dirty asterisk, second Save required) while `save`/`remove` persist immediately (`App.svelte:239-261`) — an inconsistent contract the template UI doesn't signal. | A193 |
| 5 | **Coverage gaps for the new features:** the drag-reorder path has no spec; the flavor text has a `data-testid` but no assertion; `pickFlavor` has no fixture; the A174 weekend `dowPnl` filter is inlined in `Calendar.svelte` (not node-testable, untested); the mobile spec couples to `button.aspect-square` (utility-class selector) and uses `waitForTimeout(250)`. | A194 |
| 6 | **Docs/comment drift + micro-cleanups:** `docs/architecture-diagrams/ci-pipeline.md:17` still says the 480 KiB budget (actual 600); `ActivityTerminal.svelte:5` references the deleted `src/app/components/` twin; `types.ts:217` + `Roadmap.svelte:173` keep pre-A187 "saved view(s)" wording; the terminal logs "reference data loaded" above "session initiated" (boot emit order); `Dashboard.svelte` `commitModules` never updates `lastModKey`, so the re-seed effect redundantly reassigns `modOrder` on every layout edit. | A195 |

## Verified clean (evidence-checked)

- **Moat / egress:** every `fetch()` in `src/` is same-origin config/refdata/static JSON; feedback is
  mailto-only with typed text; no beacons/websockets/analytics; `_headers` CSP intact
  (`style-src 'self'`, `object-src 'none'`); no `{@html}` on user data (the two `Home.svelte` sites
  render developer-authored SVG constants); `SHOT_RE` still guards every screenshot write path;
  attribute-escaped tab names/tags/titles throughout the new UI.
- **Store seam:** zero direct `indexedDB`/`localStorage` outside `store.ts`; all new tab/layout
  persistence rides `store.local` (namespaced `TABS_KEY`/`MOD_KEY`/`WS_KEY`); demo remains
  non-persisting by construction (in-memory `DemoStore.local`).
- **Staged-layout state machine:** switch-away snapshots drafts, switch-back restores copies,
  revert→default round-trips, delete clears draft+dirty, reload discards staged edits by design.
- **Runes/TS discipline:** no `export let`/`$:`/`createEventDispatcher`/store writables in
  components; `src/` remains `any`-free; the previously-fixed ActivityTerminal effect no longer
  reads the state it writes, and the other flagged effects (Dashboard re-seed, Calendar journal)
  are loop-guarded; keyed each blocks stable under `animate:flip`.
- **Functions auth (A155):** `exp`/`iss` required fail-closed; alg pinned; admin POST rate-limited +
  token-checked + key allow-listed; deps exact-pinned, lockfile coherent, no install scripts.
- **Pass-5 remediations:** A147–A164 all verified in place (shared helpers single-sourced,
  emitters wired, `dashLayouts.save` captures the real default, dead exports pruned).
- **Gates re-run this audit:** build green; `check-deploy-contract` 14/14; `test-compute` 78/0
  (incl. the A188 ring-buffer fixtures); 10 Vite entries == 10 `src/*.html`.

## Method

Four parallel read-only auditors (architecture/duplication, Svelte-TS quality, security,
correctness/build/CI), each instructed to verify every claim against source before reporting and to
return `file:line` evidence; several suspected defects were dropped by the auditors themselves
(e.g. the ActivityTerminal effect-loop recurrence, draft-layout staleness, demo write bypasses —
all clean). The coordinator re-verified the P2 by reading `check-bundle-size.mjs` against the
built `dist/` chunk list, and confirmed the 8.5 MB `devcomponents` chunk on disk. Fix items
**A190–A195** filed; R1 stays open for the next pass.
