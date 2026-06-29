---
name: promote-staging
description: Run Blotterbook's staging→prod promotion ritual (backlog item CH16) — take feature(s) that currently ship only on the staging surface (gated by isStaging / PAGE_MODE === 'staging' inside shared components) and make them unconditional so they ship on prod + demo too, keeping demo non-mutating. Use when asked to "promote staging", "do a CH16", "ship the staging features to prod", or after staging has proven a feature.
---

# Promote staging → prod (CH16)

CH16 in `static/data/backlog.json` is the canonical, always-open recurring driver. **Read that item's
`prompt` first** — it is the source of truth; this skill is the operating procedure around it.

## Key model (post-A33)

All three surfaces (app/demo/staging) mount ONE Svelte SPA under `src/app/`. There is no separate
staging codebase — "staging-only" behavior lives behind **runtime guards inside shared components**.
Promotion = removing those guards so the feature ships everywhere.

- **Feature gates** use `isStaging` / `STAGING_PAGE` (`PAGE_MODE === 'staging'`) — these are what you flip.
- **Environment infra** also keys off `PAGE_MODE === 'staging'` — the isolated IndexedDB, the sample
  seed, the `LS_*_staging` namespacing, the `_middleware.ts` key-gate. **This STAYS PUT** — do not touch it.

## Procedure

1. **Inventory** the delta: `grep -rn "isStaging\|STAGING_PAGE\|PAGE_MODE === 'staging'" src/app`. For each
   hit, classify it as a FEATURE gate (promote) or ENVIRONMENT infra (leave). List each feature + its
   gate(s) before editing. Promote the feature(s) named in the request; if none are named, promote the
   **full** delta.
2. **Per feature:** flip the gate to unconditional (`isStaging ? a : b` → `a`; `{#if isStaging}` →
   unconditional; `class:staging` + `.x.staging` CSS → `.x`), and remove the now-unused
   `isStaging`/`PAGE_MODE` import (lint/svelte-check will flag leftovers).
3. **Keep demo non-mutating (1:1 otherwise):** the feature must work on demo, but any TRADE-writing
   control stays `disabled` under `isDemo` and guarded (`if (isDemo) return;`). UI/layout prefs simply
   don't persist on demo (in-memory `DemoStore`) — that's correct, not a bug.
4. **Stay CSP-clean** (no inline `style=""` — A55) and a11y-intact.
5. **Update e2e:** any spec asserting demo/prod LACKS the feature (e.g. "demo … no X") must flip to assert
   it now HAS it (mirror the existing "(…, promoted)" specs in `e2e/interactions.spec.mjs`). Add a demo
   assertion proving non-mutation where relevant.
6. **Verify:** `npm test` (lint + typecheck + svelte-check + format + unit) and `npm run test:e2e` (builds,
   boots every surface) both green.
7. **Changelog (F13):** add an entry at the top of `data/changelog.json` `releases`, keyed to the NEXT
   prod version (a `feat:` title bumps minor; check `data/versions.json` `prod`), describing what shipped
   for users. Do NOT hand-edit `data/versions.json` — CI bumps it; staging keeps its lead.
8. Title the PR `feat:` (or `fix:`) so CH12 bumps prod correctly. Open a PR only if asked.

**Done when:** the in-scope features are live on prod + demo at 1:1 (demo non-mutating), all surfaces
verified, `npm test` + e2e green, a changelog entry added. Leave CH16 open (recurring).
