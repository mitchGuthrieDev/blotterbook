# Repo audit — 2026-07-08 pass 2 (post-#133/#134 delta: account page, subscriptions, admin, Help hub)

*Fourth pass of the 2026-07-07/08 R1 sequence, run after PR #133 (A316 email reclaim, A271 module
sizing promoted, A293 standalone Account page, A278 in-app Payment Element) and PR #134 (A276 admin
entitlement overrides, A273 Help hub replacing How-To) landed. Four parallel read-only dimension
agents (architecture/duplication, Svelte 5/TS quality + UI behavior wiring, security/moat,
correctness/tests/build/CI), each adversarially verifying every finding against source before
reporting; all three P2s re-verified by hand in synthesis. Weighted toward the delta since commit
4917630 with the prior passes' verified-clean lists honored. Findings filed as A326–A331; R1 stays
open (recurring).*

## Headline

Baseline **green** before the pass: `npm test` (all 18 node suites + lint + typecheck + format),
`npm run build`, `size-budget` (800.3 / 840.0 KiB), `check-deploy` (18/18), no generated-data drift.
The moat is **intact** — no new egress, CSP `style-src 'self'` holds on every surface, the only
`{@html}` sinks remain the static hand-authored SVG constants, and the new account/admin/subscription
attack surface is well-built (the reclaim flow, admin double-auth, and webhook-only tier writes all
verified sound end-to-end). **No P1.** The real findings are three P2s in the delta: the subscription
endpoint's error shape breaks the SubscribeForm's own degradation path, the deploy-contract canonical
guard silently stopped covering the pages A273 moved into `src/help/`, and the public `/account.html`
SSG page now imports runtime modules from `src/app/` — a layering inversion the previous pass had
recorded as clean.

## P2 — behavior / delivery / architecture (filed A326–A328)

- **A326 — `/api/subscription/create`'s error shape makes SubscribeForm's hosted-Checkout fallback
  unreachable and shows raw machine codes to users.**
  `functions/api/subscription/create.ts:89,93,123,140,143` is the only account-family endpoint that
  puts a machine code in `error` (`not_configured` / `auth_required` / `subscription_failed`) with the
  human sentence in a separate `message` field; every sibling (`register`, `login`, `recover`,
  `reclaim`, …) puts the sentence in `error`. The shared client helper throws `data?.error`
  (`account.svelte.ts:67`), so `boot()`'s fallback test `/not configured/i` (`SubscribeForm.svelte:60`)
  never matches `not_configured` (space vs. underscore): with `STRIPE_PUBLISHABLE_KEY` unset the form
  is supposed to degrade to "Use secure checkout →" but instead renders the literal string
  **"not_configured"** and a "Refresh status" button that can never succeed; every 502/401 likewise
  renders a raw code. Fix: flip the endpoint to the repo-wide convention (human sentence in `error`).
  Folded in (same flow): the `as never` cast on the Payment Element options
  (`SubscribeForm.svelte:54` — type as `StripePaymentElementOptions` instead) and the
  unmount-mid-boot window where `payment.mount()` can fire into a detached node after cleanup ran
  (`SubscribeForm.svelte:34-55` — guard with a destroyed flag).
- **A327 — The deploy-contract canonical guard silently skips all five `src/help/*.html` pages.**
  `scripts/check-deploy-contract.mjs:93` runs `execSync('git ls-files src/*.html')` with an
  **unquoted** pathspec, so `/bin/sh` expands the glob from the repo root first — and a shell glob
  doesn't cross `/`, so git receives only the six top-level pages. Verified live: unquoted returns
  6 files, quoted (`'src/*.html'`, a git pathspec) returns 15 including `src/help/*`. A273 moved
  canonical-bearing pages from covered top-level (`src/howto.html`) into the uncovered nested dir, so
  a typo'd canonical on any Help page now sails through the CI guard whose stated purpose is checking
  them. Current canonicals happen to be correct (hence P2, not P1). Fix: quote the pathspec
  (`git ls-files -- 'src/*.html'`); shells without a canonical are already skipped by the `if (m)`.
- **A328 — The SSG marketing surface now imports the app layer (`src/site` → `src/app`).**
  `src/site/components/AccountDash.svelte:14,26` imports `SubscribeForm.svelte` (from
  `src/app/parts/`) and the whole account rune module (from `src/app/lib/account.svelte.ts`) into the
  prerendered public `/account.html` page — the only `src/site` file that reaches into `src/app`, and
  a direct regression of the invariant the 2026-07-08 pass recorded clean ("site imports nothing from
  app"). The *reuse* is right (the alternative was duplicating the whole account ceremony); the
  *placement* is the debt — modules consumed by both app and site belong in a shared home, not under
  `src/app/`. Fix: relocate `account.svelte.ts` + `SubscribeForm.svelte` to `src/lib/account/` (typed
  by svelte-check alongside `src/lib/components` — runes modules can't go under plain-tsc coverage)
  and point both surfaces at it, so the dependency arrows are app→shared and site→shared.

## P3 — hygiene / dedup / docs (filed A329–A331)

- **A329 — Account glue drift between the two Account surfaces.** The resumable two-phase
  `deleteAccount` loop lives only inside `AccountDash.svelte:55-87` (a view component) while every
  other account action is a node-testable function in `account.svelte.ts`; `fmtDate` is byte-identical
  in `Account.svelte:169` and `AccountDash.svelte:111`; the email regex is written three times
  (`Account.svelte:143,153`, `AccountDash.svelte:28`). Fix: add a `deleteAccount()` action to the
  account module (+ `test-accounts.mjs` coverage), export a shared `EMAIL_RE` and date formatter, and
  import in both surfaces. (Natural to do together with the A328 relocation.)
- **A330 — The A278 Stripe CSP relaxation also applies to `demo.html`, the zero-egress showcase
  surface.** `static/_headers` path-scopes the relaxed policy to `/app/*` + `/account.html`; the
  prefix also matches `/app/demo.html`, so demo's CSP ceiling now allows `api.stripe.com`
  (connect-src) + `js.stripe.com` (script-src) it can never use (demo has no session; the form never
  mounts). Not exploitable today (no injection sink on demo) — purely allowlist-ceiling hygiene on
  the surface whose story is "egresses nothing." Fix: re-declare a strict pure-`self` policy for
  `/app/demo.html` after the `/app/*` rule (most-specific match wins on Pages).
- **A331 — Docs/copy drift batch.** (a) The user-facing changelog trails prod: `versions.json` prod is
  `0.70.0` (PR #134 ships the Help hub) but the newest `changelog.json` entry is `0.69.0` — CLAUDE.md's
  "add an entry when prod bumps" is unmet. (b) Two user-facing strings still point at the deleted
  "How-To guide": `src/lib/core/adapters.ts:1174` and `src/app/parts/Onboarding.svelte:105` — reword
  to the Help hub (and link `/help/import.html` in Onboarding). (c) `functions/api/sync/push.ts:11`
  still says entitlement is checked via `grantsCloud()` — A277 rerouted it through
  `hasCloudEntitlement()` (which honors admin comps).

## Verified clean this pass (don't re-audit next time unless the area changes)

- **Reclaim flow (A316) end-to-end**: 256-bit CSPRNG token, SHA-256-at-rest, purpose-checked,
  constant-time compare, single-use, 15-min TTL, expired-burn; rate-limited 5/300s both endpoints;
  enumeration-safe generic 200 on send; can only displace a never-verified, workspace-less squatter;
  link requires control of the holder's inbox; sessions/credentials/recovery of the squatter dropped;
  `?reclaim`/`?recover` scrubbed from history before the ceremony; no open redirect (origin from
  `request.url`).
- **Admin endpoints (A276)**: `isAdminAuthorized` (constant-time) enforced on reads *and* writes,
  fail-closed; cursor validated `/^\d+$/`; LIKE term escaped + bound; `adminUserView` exposes no
  Stripe ids/sessions/credentials/sync fields; audit trail via Access email; revoked override rows
  retained.
- **Subscription create (A278)**: webhook remains the only tier writer; price only from env;
  session + Origin + env gates; customer reuse + per-user idempotency keys; no client-supplied
  amounts. `hasCloudEntitlement` is the single choke point for `/api/me` *and* the mutating sync
  routes (no comped-user split-brain). `test-subscription.mjs` (17 assertions) covers
  401/503/501/already-subscribed/resume/reuse/idempotency/2025-API-shape/502.
- **Moat / CSP**: no new egress in the compute path (Dashboard delta is size-controller work only);
  zero new `{@html}`/`innerHTML`/`style="` sinks; Stripe CSP adds exactly the documented
  Payment-Element origins, all other surfaces pure-`self`; no secrets committed; `@stripe/stripe-js`
  pinned + lockfile-consistent; no card data outside Stripe's iframe; admin token in page-session
  state, not localStorage.
- **Runes/TS**: delta is runes-only and `any`-free; fetch boundaries typed (`UsersResp`/`AdminUser`,
  `CreateSubscriptionResult`, the delete-loop shape). One escape hatch (the A326 `as never`) filed.
- **A319/A320 fixes landed as specced**: one `createSizeController` + shared
  `ModuleSizeMenu`/`ModuleResizeHandle`; module key/label tables single-sourced in `modlayout.ts`;
  screens derive labels; no third copy (Calendar unsized).
- **Howto→Help migration complete**: `Howto.svelte`/`entries/howto.ts`/`src/howto.html` deleted; no
  stale `/howto.html` hrefs in shipped code; 301 target resolves; sitemap/robots/canonicals/redirects/
  `_headers`/`vite.config.mjs` (15 entries)/`vite-ssg.mjs` page list all in lockstep;
  `bump-version.mjs` classifies every new path (check-deploy part 2: 230/230 classified);
  `vite-ssg.mjs` exact-match fix prevents the `/help/index.html` vs `/index.html` template collision.
- **Dashboard delta correctness**: KPI SVG bars guard division by zero; values pass through existing
  `Metrics` unchanged; the ≥6-Small carousel grouping keys on preview size; the e2e allow-list's
  single addition (`/^Resize .+ module$/`) is justified and covered by the promoted keyboard-resize
  + drag-engine tests.
- **Help pages**: all 11 `#imp-*` anchors match Home.svelte's links; HelpNav active states correct;
  mobile disclosure CSS-only; `ssg.spec.mjs` asserts SSR content for all five pages + account
  (incl. noindex).
- **Test suites**: 18 suites consistent across `package.json`/CI/CLAUDE.md; `test-accounts.mjs`
  (237 ok) covers admin pagination/filter/leak-check + the full reclaim matrix incl. the
  workspace-owner 409; CI has no silent-pass path (no `|| true`, drift gate exits 1).
- **Store seam / core purity**: all `indexedDB`/`localStorage` inside `store.ts` + the two approved
  spots (`Admin.svelte` S10 token field is page-session only, `flags.ts` staging override);
  zero svelte imports under `src/lib/core/`.

R1 stays **open** (recurring). All six findings were fixed in this same pass — see the follow-up
commits on this branch and the backlog `doneNote`s.
