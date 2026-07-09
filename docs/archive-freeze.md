# The archive freeze (2026-07-08)

> **Status: Blotterbook is archived as a frozen, local-only app.** New accounts, subscriptions, and
> cloud sync are paused. Nothing was deleted — every account/subscription/sync code path remains in
> the repo, gated behind one flag, ready to thaw. This document is the freeze's single source of
> truth: why, what's frozen vs. still working, the full touchpoint inventory, and the revert
> procedure.

## Why

Owner decision, 2026-07-08: the accounts/subscriptions/cloud-sync product (passkey accounts, Stripe
billing, E2E-encrypted synced workspaces — F53–F63) is being re-platformed as a conventional
client→server SaaS, on different infrastructure and a different architecture, rather than continuing
to grow inside this client-side, local-compute-first codebase. Rather than delete or fork the work,
this repo is **frozen as a free, local-only trading journal** — the CSV import, journal, and cost/tax
model keep working exactly as before, for free, forever, with zero server dependency for that path.
The account/subscription/sync code is kept **in place** (not removed) in case it's useful again later,
but every path that would let someone *start* using it (new account, new subscription, new sync setup)
is turned off. Existing users are not stranded: their accounts, their local data, and their already-
synced cloud data all keep working.

## What's frozen vs. what still works

| Frozen (creation paths) | Still working |
| --- | --- |
| New account registration (email + passkey enroll) | The entire local app on `/app/app.html` — CSV import, journal, cost/tax model, calendar, analytics, reports |
| Email-squat reclaim (`reclaim-send`) | Demo (`/app/demo.html`) — unchanged, never persists |
| Stripe checkout (one-time donation) | Existing-account login (passkey) |
| In-app subscription creation (`subscription/create`) | Existing-account passkey add/remove |
| Changelog-email signup (`/api/subscribe`) | Account recovery (email magic link) for existing accounts |
| All cloud-sync setup/enable UI (key generation, recovery-key ceremony, workspace opt-in) | Existing subscription **cancellation** |
| The Account nav entry + screen route on `/app/` (all surfaces) | Account **deletion** (and its data cleanup) |
| The homepage pricing CTA for synced workspaces | The `/api/sync/*` transport itself, for a workspace that was **already** opted in before the freeze — a still-open cloud-tier session keeps pushing/pulling its own already-encrypted data |
| The site header's Account link | `/api/me` (tier probe) — still answers; it just has nothing new to grant |
| `/account.html` (site) | |

The freeze is a **creation-path lockout**, not a data or service outage: nothing that already existed
(an account, a subscription, a synced workspace) stops working; only the on-ramps into those states are
closed.

## The flag

Everything branches on one boolean, defined in two places (client + server, since they can't share a
module):

- **`src/lib/archive.ts`** — `export const ARCHIVED = true;` + `export const ARCHIVE_NOTE` (the
  one user-facing sentence shown wherever a control is frozen). Imported by the Svelte app
  (`src/app/App.svelte`, `src/app/parts/WorkspaceSwitcher.svelte`, …) and by the site
  (`src/site/components/*.svelte`).
- **`functions/_lib/archive.ts`** — mirrors the same `ARCHIVED` constant server-side, plus
  `archivedResponse()`, a helper returning the standard 410 shape:
  `{ error: 'Blotterbook is archived — new accounts and subscriptions are paused.', code: 'archived' }`.

Every gate in the codebase is commented **`ARCHIVE FREEZE (docs/archive-freeze.md)`** — grep for that
string to find every touchpoint at once:

```bash
grep -rn "ARCHIVE FREEZE" src functions docs README.md CLAUDE.md e2e
```

## The full touchpoint inventory

### Flag definitions

- `src/lib/archive.ts` — `ARCHIVED` + `ARCHIVE_NOTE` (client).
- `functions/_lib/archive.ts` — `ARCHIVED` + `archivedResponse()` (server, 410 `{ error, code:
  'archived' }`).

### Server — creation endpoints answer 410 `archived`

- `functions/api/account/register-options.ts` — the **email-registration path** (new-account
  creation) is frozen; existing-account **login** via `register-options`'s sibling paths is
  unaffected.
- `functions/api/account/reclaim-send.ts` — email-squat reclaim (also a form of account creation).
- `functions/api/checkout.ts` — Stripe Checkout / donation session creation.
- `functions/api/subscription/create.ts` — the in-app Payment Element subscription bootstrap.
- `functions/api/subscribe.ts` — changelog-email double opt-in signup.

*(Existing-account paths — login, `/api/me`, passkey add/remove, recovery, account delete,
subscription cancel, and the `/api/sync/*` transport — are deliberately untouched; see the table
above.)*

### App (`src/app/`)

- **`src/app/App.svelte`**:
  - `sections` — the sidebar nav list drops the `{ label: 'Account', … }` section while `ARCHIVED`
    (Account.svelte and its route branch are left in the code, just unreachable via nav).
  - `fromHash()` — a bookmarked/typed `#account` hash falls back to `dashboard` while `ARCHIVED`
    (belt-and-suspenders on top of `account` already being absent from `allNavKeys`).
  - `store` — no `CloudStore` wrap while `ARCHIVED` (`store = isDemo || ARCHIVED ? localStore :
    wrapStore(localStore)`) — a plain local `Store`, so there's no write-behind hook at all.
  - `gateArmed` — `LaunchGate` never arms while `ARCHIVED` (`!isDemo && !ARCHIVED &&
    accountGateEnabled()`); direct local access on every surface. `accountGateEnabled()`
    (`src/app/lib/flags.ts`) also hard-returns `false` when `ARCHIVED`, so this is doubly gated.
  - The boot sequence skips `configureCloudSync()` entirely while `ARCHIVED` — zero
    `/api/sync`/`/api/me`-driven sync-controller traffic at boot, on top of the controller itself
    no-oping (see `cloudsync.svelte.ts` below).
- **`src/app/parts/WorkspaceSwitcher.svelte`** — the whole cloud-sync state-machine row (status pill,
  enable/pause/resume, direction controls) is replaced by one muted line while `ARCHIVED`:
  `data-testid="archived-note"`, text **"Cloud sync is paused — Blotterbook is archived."**, titled
  with the full `ARCHIVE_NOTE`. Workspace CRUD (create/rename/delete/switch) is untouched — that's
  local-only and keeps working.
- **`src/app/lib/cloudsync.svelte.ts`** — `configureCloudSync()` no-ops when `ARCHIVED` (defense in
  depth alongside the App.svelte skip above).
- **`src/app/lib/flags.ts`** — `accountGateEnabled()` hard-returns `false` when `ARCHIVED`.
- **`src/app/screens/Account.svelte`** — left in place, unreachable (no nav entry, no hash route in
  practice); not deleted so the thaw doesn't have to rebuild it.
- **`src/app/parts/LaunchGate.svelte`** — left in place, unreachable (gate never arms).

### Site (`src/site/`)

- **`src/site/components/Home.svelte`** — the header's Account link (`{#if !ARCHIVED}`) and the
  Account CTA button are both hidden while archived; the pricing section's "Synced workspaces" card
  swaps its ribbon to "Paused" and drops the live subscribe link for a `disabled` button (titled with
  the full `ARCHIVE_NOTE`) plus a muted paused-note paragraph below it — this note is plain text, not
  a dedicated `data-testid="archived-note"` element (unlike the WorkspaceSwitcher/AccountDash/
  HelpCloudSync instances below); a small FAQ-answer addendum in the same file notes the pause too.
- **`src/site/components/AccountDash.svelte`** (served at `/account.html`) — renders **only** an
  archived-notice card while `ARCHIVED`: `data-testid="archived-note"`, linking to `/app/app.html`
  (use the local app) and `/help/support.html` (get help) — the login/signup/identity/plan/sync UI
  underneath is not reachable.
- **`src/site/lib/Nav.svelte`** (shared site header, used by non-homepage pages) — the Account link
  is hidden while `ARCHIVED`, mirroring Home.svelte's header.
- **`src/site/components/HelpCloudSync.svelte`** — gains a warning banner at the top of the article
  noting cloud sync is paused for new setups, linking back to this doc's spirit (existing synced
  workspaces are unaffected).
- **`src/site/components/HelpSupport.svelte`** — one appended archived sentence in the "Account &
  billing" section (the /account.html dashboard is replaced by the notice while archived).
- **`src/site/components/HelpGettingStarted.svelte`** — the "First run" copy branches: while
  archived, "No sign-up needed — open the app" replaces the free-account sentence (the launch gate is
  bypassed).
- **`src/site/components/Roadmap.svelte`** — a `.note.warn` archived-status banner at the top; the
  shipped/planned checklist below is untouched.
- **`src/site/components/Legal.svelte`** — an archived-status note after the blurb corrects the
  operative facts (no account needed to launch; new accounts/subscriptions/donations paused; the
  account/subscription sections apply to pre-existing accounts). The counsel-reviewed terms prose
  itself is deliberately NOT edited.
- **`src/site/components/Admin.svelte`** — deliberately NOT gated: the admin panel stays fully
  functional behind Cloudflare Access so existing accounts can still be supported (comps revoked,
  users looked up) during the freeze.

### e2e (`e2e/`)

Every touched spec declares a local mirror of the flag at the top —
`const ARCHIVED = true; // mirror of src/lib/archive.ts — flip on thaw (docs/archive-freeze.md)` —
and branches on it: the pre-freeze test stays intact inside `if (!ARCHIVED) { … }` (or is left
unconditional where the freeze doesn't change the assertion), and the archived-reality assertion
is added alongside (in an `if (ARCHIVED)` block or as an unconditional new test). Thawing an
individual spec is a one-constant flip.

- `e2e/cloud-sync.spec.mjs` — the whole setup/subscribe/state-machine/prod-promotion suite is
  unreachable (no Account screen to drive it from) and is wrapped in `if (!ARCHIVED)`; new archived
  assertions added: no Account nav button on app/staging, the switcher's `archived-note` line, and
  zero `/api/sync`+`/api/me` requests across boot + interaction. The demo "never renders sync UI"
  test is unchanged (demo's story doesn't change).
- `e2e/workspace-switcher.spec.mjs` — the sync-affordance tests (`sync-status`/`sync-enable`/
  "checking…") are wrapped in `if (!ARCHIVED)`; new `archived-note` assertions added. Workspace
  CRUD tests (create/rename/delete/switch) are unchanged.
- `e2e/boot.spec.mjs`, `e2e/staging-redesign.spec.mjs` — the F56 `launch-gate` tests are wrapped in
  `if (!ARCHIVED)`; new tests assert the gate never renders and every surface boots straight to its
  content.
- `e2e/interactions.spec.mjs` — the demo "Account screen is promoted" test is wrapped in
  `if (!ARCHIVED)`; a new test asserts demo has no Account nav item (unchanged behavior otherwise).
- `e2e/no-dead-controls.spec.mjs` — the disabled-controls exemption already skips `:enabled` controls,
  so the frozen disabled Synced-workspaces CTA / Account nav removal need no allow-list change; a
  comment records why.
- `e2e/ssg.spec.mjs` — `/account.html`'s content assertion is updated to the archived-notice copy;
  the Home hydration test's Account-link assertion is wrapped in `if (!ARCHIVED)` with a new
  archived-reality check alongside.

### Docs / non-code

- `docs/archive-freeze.md` — this document.
- `README.md` — a prominent "⚠ Archived" section at the top.
- `CLAUDE.md` — a short "ARCHIVE FREEZE (2026-07-08)" note under the intro paragraph.
- `static/data/backlog.json` / `static/data/backlog_archive.json` — **A339** files the freeze as a
  backlog record (done, `completedDate: 2026-07-08`); **R1** and **CH16** are annotated
  "— DORMANT (archive freeze 2026-07-08)" without being closed (they're recurring rituals that
  resume on thaw).
- `static/data/changelog.json` — a user-facing entry announcing the freeze.

## The revert procedure

**(a) Preferred:** `git revert` the archive-freeze commit(s). Since the freeze is additive (new flag
files) plus small, single-purpose diffs at each gate (all commented `ARCHIVE FREEZE`), a clean revert
should restore prior behavior without conflicts. Re-run `npm test` + `npm run test:e2e` afterward.

**(b) Manual flip**, if a clean revert isn't possible (e.g. real feature work landed on top of the
freeze in the meantime):

1. Flip `ARCHIVED = false` in **`src/lib/archive.ts`** and **`functions/_lib/archive.ts`**.
2. Flip the mirror `const ARCHIVED = true` → `false` at the top of each touched e2e spec (grep
   `mirror of src/lib/archive.ts` in `e2e/`) — this alone re-arms every wrapped pre-freeze test and
   retires the archived-reality ones, since each pair is written as `if (!ARCHIVED)` / `if (ARCHIVED)`.
3. Restore the Cloudflare-side state: **no infrastructure was torn down.** Pages environment
   variables (Stripe keys, `CHANGELOG_NOTIFY_SECRET`, etc.), the `ACCOUNTS_DB` D1 database, and the
   `SYNC_BUCKET` R2 bucket were all left intact and bound — thawing is a code-only change.
4. Re-run `npm test` (lint + typecheck + format + the 18 unit suites) and `npm run test:e2e` end to
   end; confirm the drift gate (`build-manifest.mjs` / `build-econ-events.mjs`) is still clean.
5. Un-annotate R1 and CH16 in `static/data/backlog.json` (drop the "— DORMANT" line) so the recurring
   rituals resume, and revisit A339's `doneNote` if you want a matching "un-frozen" backlog record.

### Operational leftovers outside this repo

Thawing the code doesn't undo these — the owner should handle them separately if desired:

- **Stripe products/prices are left active.** Nothing in this freeze pauses or archives them in the
  Stripe dashboard; if new subscriptions should be impossible even via a direct Stripe link, pause the
  prices there too.
- **The changelog-email GitHub workflow (`.github/workflows/changelog-email.yml`) still fires on
  every prod release.** This is harmless while frozen — `/api/subscribe` (new signups) is frozen, but
  the broadcast endpoint (`/api/notify-changelog`) still works for **existing, already-confirmed**
  subscribers, so release announcements (like the freeze announcement itself) keep reaching the
  people who already opted in. Disable the workflow if the owner wants to stop sending changelog
  emails entirely while archived.
