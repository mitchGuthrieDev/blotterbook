# Claude Code skills shortlist (A196)

**Date:** 2026-07-05 · **Backlog item:** A196 (DISCUSSION/ANALYSIS) · **Existing skills:**
`.claude/skills/{promote-staging,repo-audit}` — both ~45-line SKILL.mds that point at the canonical
backlog item's `prompt` as source of truth and encode the operating procedure around it. New skills
should match that bar: short, procedure-shaped, with the exact greps/file touch-points and the
"done when" spelled out.

## Prioritized shortlist

| # | Skill | Pain removed | Authoring effort | Priority |
|---|-------|--------------|------------------|----------|
| 1 | `add-adapter` | 5-file ritual; subtle sniff/minScore + no-misfire rules; A209 needs it TWICE imminently | small-medium | **P1** |
| 2 | `backlog-upkeep` | The donePolicy strip-prompt + move-to-archive dance, done by hand EVERY session (10 items archived manually 2026-07-05) | small | **P1** |
| 3 | `cut-changelog` | Version-keyed user-facing entry + conventional-commit coupling; recurring on every prod bump | small | P2 |
| 4 | `add-dashboard-module` | 5 touch-points inside one 1,289-line file — the picker thumbnail is the one everyone forgets | small | P2 |
| 5 | `add-ui-primitive` | Vendor-by-hand transcription (CLI registry egress-blocked) + Styleguide section | small | P3 |
| 6 | (rate-update) | Two documented steps; **not worth a skill** — fold into A210's doc instead | — | skip |

## Per-skill detail

### 1. `add-adapter` — P1
- **Trigger:** "add a platform adapter", "support Quantower/NinjaTrader exports", "do an A209 adapter".
- **Encodes:** (a) the `Adapter` object shape in `src/lib/core/adapters.ts` — `id/label/kind
  ('closed'|'fills')/beta:true/minScore/sniff/toTrades` (+ optional `upgradeHint`), registered in the
  `ADAPTERS` array (~line 869); fills exports normalize via `pairFills()`, and `Fill.commission` is set
  when the export carries real costs (A208). (b) The **A174/A178 detection rules**: `sniff` matches
  headers on word boundaries via `hasAny(lc(rows[0]))`, must clear its own `minScore`, and must score 0
  on every OTHER platform's fixture — the skill mandates re-running the full detection loop. (c) The
  fixture ritual in `scripts/test-adapters.mjs`: a representative CSV in `C`, which auto-feeds the
  detection + parse/shape loops, plus explicit PnL/holdMs asserts for fills adapters. (d) The docs tail:
  Howto import guide (`src/site/components/Howto.svelte` — nav link `#imp-<id>`, guide section, export-
  types table) + the Home platforms list; changelog entry when it ships. (e) Belt-and-braces patterns to
  copy: same-column delimiter refusal (A168), Status-gated executions, `normTime`/`num`/`rootSym`.
- **Stays manual:** obtaining a REAL export (A209 is owner-blocked on files — never guess headers from
  docs), judging column semantics, and the beta→verified promotion (that's A103's separate pass).
- **Why P1:** A209 = two runs of this ritual arriving soon; the misfire rules are exactly the kind of
  non-obvious constraint a skill prevents regressing; fixture + docs steps are easy to drop.

### 2. `backlog-upkeep` — P1
- **Trigger:** "file a backlog item", "mark A### done", "archive the done items", end-of-session backlog
  sweep.
- **Encodes:** the item schema (`id/title/category/priority/effort/status/completedDate/partial/prompt/
  doneNote`, categories from the file's `categories` list, next free `A###` id — currently A211+); the
  **donePolicy** verbatim from `static/data/backlog.json`: on `done` → set `completedDate`, write the
  `doneNote` as the shipped record, DELETE `prompt`, and MOVE the object into
  `static/data/backlog_archive.json`; recurring items (`recurring: true` — R1, CH16) are NEVER closed,
  dated, or prompt-stripped; bump the top-level `"updated"` date; then `node scripts/build-manifest.mjs`
  (verify no manifest movement — backlog isn't cache-busted) and `npm run format` on the touched JSON.
  A "self-contained prompt" quality bar (scope, constraints, "done when") with a pointer to existing
  items as exemplars.
- **Stays manual:** deciding priority/effort and writing the actual prompt/doneNote prose.
- **Why P1:** highest frequency of any candidate (every working session), fully mechanical, and the
  failure modes are real — prompts left on done items, items closed in-place instead of moved,
  recurring items accidentally closed, stale `updated` date.

### 3. `cut-changelog` — P2
- **Trigger:** "add a changelog entry", "cut the release notes", after any user-visible merge to main.
- **Encodes:** prepend to `releases` in `static/data/changelog.json` keyed to the NEXT prod version —
  derived from `static/data/versions.json` `prod` + the PR's conventional-commit type (`feat:` minor,
  `fix:`/`chore:` patch, `!` major — CH12); NEVER hand-edit `versions.json`; house voice (user-facing,
  title + summary + highlights, the "your trade data still never leaves the browser" closer); then
  `build-manifest.mjs` (changelog.json IS fetched → hash moves) and commit the regenerated manifest.
- **Stays manual:** the editorial judgment of what's highlight-worthy.
- **Why P2:** recurs on every prod bump; the next-version arithmetic and the manifest step are the two
  things repeatedly gotten wrong; small overlap with promote-staging step 7 (fine — that step can
  delegate to this skill).

### 4. `add-dashboard-module` — P2
- **Trigger:** "add a dashboard module", "new module like Commission Compare (A203)".
- **Encodes:** the five touch-points in `src/app/screens/Dashboard.svelte`: (1) `MODULES` entry
  (~line 190; note A203 precedent — picker-addable, NOT in `DEFAULT_MODULE_KEYS` unless default-on);
  (2) a `{#snippet <key>Body()}`; (3) the render dispatch chain (~line 1157); (4) an **A189
  `moduleThumb` SVG branch** (~line 1114 — geometry attrs + `fill-chart-*` utilities only, CSP-clean);
  (5) `moduleHeader` comes free. Plus the guardrails: tokens only (chart-1..5 for data color), demo
  non-mutation for any write, `check-bundle-size` 600 KiB budget, e2e/no-dead-controls allow-list, and
  a changelog entry.
- **Stays manual:** the module's actual analytics/markup.
- **Why P2 not P1:** single-file and recently exercised (A203), so the pattern is fresh in-repo; no
  scheduled next module. The thumbnail + dispatch are the classic forgotten steps a checklist catches.

### 5. `add-ui-primitive` — P3
- **Encodes:** since the shadcn-svelte CLI registry is egress-blocked, vendor by hand: transcribe the
  canonical source into `src/lib/components/ui/<name>/` (per-part `.svelte` files + `index.ts`, bits-ui
  v2, `data-slot` attrs, `cn` from `$lib/utils` — mirror `select/` as the exemplar), portal-to-body
  behavior, then **add a Styleguide section** (`src/dev/Styleguide.svelte` — mandated by the UI mockup
  workflow) and grep `src/` for any new `style="`.
- **Why P3:** 20 primitives already installed; remaining need is rare. Author on first demand.

### Skipped: rate-data update
Edit `static/data/*.json` → `node scripts/build-manifest.mjs` → commit. Two steps, already documented
in CLAUDE.md "Adding things", with the F30 history/citation rules living in A210 +
`docs/rates-data-assessment.md`. A skill would restate docs without removing error surface.

## Build-order recommendation

Author **`add-adapter` first** (A209's two real exports are arriving — the skill pays for itself on the
first Quantower file, again on NinjaTrader, and again every A103 verification pass), then
**`backlog-upkeep`** (smallest to write, highest run-rate; immediately de-risks every session's
close-out). Hold `cut-changelog` and `add-dashboard-module` until the next natural occurrence; write
`add-ui-primitive` only when a missing primitive actually comes up.

## Proposed backlog items

- **A2xx — Author `.claude/skills/add-adapter`** (CHORE / REFACTOR, P2, small): SKILL.md per this doc's
  §1, matching the promote-staging structure (point at A209/A103 as canonical drivers). Done when the
  skill exists and a dry-run against an existing adapter reproduces the ritual.
- **A2xx — Author `.claude/skills/backlog-upkeep`** (CHORE / REFACTOR, P2, small): SKILL.md per §2,
  quoting the donePolicy verbatim and the archive-move ritual. Done when filing + closing an item via
  the skill leaves backlog.json/backlog_archive.json/manifest/format all clean.
