<!--
Blotterbook PR template — fill in the sections below and delete anything that doesn't apply.
Treat this as a layout to populate, not a checklist to obey.

TITLE = a Conventional Commit (it drives the CH12 two-track version bump on merge):
  feat:                                  → minor
  fix: / chore: / refactor: / docs: / style: / test: / perf:  → patch
  feat!:  or a `BREAKING CHANGE:` footer → major
Scope it when useful, e.g. `feat(staging): …`. Untyped titles default to a patch bump.
-->

## Summary

<!-- What changed and why, in 1–3 sentences. Reference backlog ids (A20, CH16, …) where relevant. -->

## Changes

<!-- Group by area; drop the groups that don't apply. -->
- **App / code:**
- **Docs:**
- **Data / reference:**
- **Backlog:** <!-- items closed (and moved to data/backlog_archive.json) and/or filed -->

## Verification

<!-- There is NO render/visual test coverage, so call out any manual / headless / CDP / before-after checks. -->
- [ ] Test suite green: `node scripts/test-adapters.mjs && node scripts/test-auth.mjs && node scripts/test-version.mjs && node scripts/test-flags.mjs && node scripts/test-tax.mjs`
- [ ] Build-drift gate clean: after `node scripts/build-includes.mjs && node scripts/build-manifest.mjs`, `git status` is clean (committed artifacts in sync)
- [ ] Affected surfaces checked as relevant (app / demo / staging / info pages)
- [ ] Visual / interaction verification (screenshots, before/after, CDP) — describe:

## Versioning & deploy impact

<!-- bump-version.mjs classifies the changed paths; this only documents the expected effect. -->
- **Prod-shipping touched?** (`app/*`, `partials/*`, `assets/*`, `tokens.css`, the homepage/info pages, or `data/*` except `versions`/`backlog`/`backlog_archive`) → a version bump fires on merge. Non-shipping only (docs, `CLAUDE.md`, `admin.html`, `scripts/*`, `.github/*`, backlog JSON) → no bump.
- Do **not** hand-edit `data/versions.json` — CI bumps it.
- If `prod` bumps, add a `data/changelog.json` entry (F13).

## Notes / follow-ups

<!-- Deferred work, spun-off backlog items, demo lock-down confirmation for staging→prod promotions, anything a reviewer should know. -->
