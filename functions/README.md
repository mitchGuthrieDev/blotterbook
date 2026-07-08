# Pages Functions — accounts, payments, storage tiers

> **Status: live (accounts phases 1–2; synced-workspaces backend F60/F62 live on prod + staging).**
> Passkey accounts (F53), donation provisioning via the verified Stripe webhook (F54), recovery email +
> magic-link re-enrollment (F55), the **subscription lifecycle → `cloud`-tier grant** (F60), and the
> **`/api/sync/*` encrypted-blob transport** (F62) are implemented; the Account screen + the whole
> cloud-sync client are live on prod + staging, opt-in `cloud`-tier (CH16, 2026-07-07; never demo).
> **Compute stays 100% local on
> every tier**, and these functions hold identity + entitlements + **ciphertext-only** synced blobs — the
> server can never read a symbol, P&L, note, tag, or workspace name (guardrail S25, refined not dropped;
> see [`docs/synced-workspaces.md`](../docs/synced-workspaces.md)).

Cloudflare Pages serves everything under `/functions/*` as edge functions
(Workers). They're the thin server layer the app will use for the things that
*can't* be client-side: authentication, billing entitlements, and (for the
subscription tier) cloud-hosted storage.

## Storage tiers

| Tier    | How it's bought          | Where trade data lives                          | Status                    |
|---------|--------------------------|-------------------------------------------------|---------------------------|
| `local` | one-time payment         | IndexedDB (this browser only)                   | shipped                   |
| `cloud` | recurring subscription   | IndexedDB **+** E2E-encrypted server copy (R2)  | **live on prod + staging, opt-in**  |

The client never branches on the tier when reading/writing data — it goes
through `Store` (`src/lib/core/store.ts`). The `CloudStore` write-behind wrapper
(`src/app/lib/cloudstore.ts`, F63) implements the same interface and is selected on the `cloud` tier via
`Entitlements.storeFor()` (`src/lib/core/entitlements.ts`, wired in F60), so the cloud tier does not
touch the rest of the app. On the `cloud` path, IndexedDB stays primary (offline-first; compute never
touches the network) and writes are mirrored to the server as **end-to-end-encrypted ciphertext** —
the server holds no key and can't decrypt.

## Account provisioning flow

1. User pays on a Stripe Checkout / Payment Link.
2. Stripe fires a webhook to `POST /api/webhook`.
3. The webhook verifies the signature and provisions the account + entitlement: a one-time payment
   credits a donation (`local`); a **subscription** upserts a `subscriptions` row (`status` +
   `current_period_end`) from the `customer.subscription.*` / `invoice.payment_failed` events (F60).
   All persisted in **D1** (`ACCOUNTS_DB`).
4. The app calls `GET /api/me`, which **grants `{ tier:'cloud', cloudSync:true }`** while the
   subscription is active, within its dunning grace window, or before `current_period_end` (period-end +
   grace); otherwise `local`. `Entitlements` picks the matching `Store` implementation.

## Accounts + donations (F53 passkeys · F54 donations · F55 recovery)

Backed by the D1 database bound as **`ACCOUNTS_DB`** (schema: [`functions/schema.sql`](schema.sql)).
Every `/api/account/*` route and the webhook **fail closed with a 503 JSON body** when the binding
is missing. Shared helpers live in `functions/_lib/accounts.ts` (sessions, challenges, users,
credentials, donations, recovery tokens) and `functions/_lib/email.ts` (the Resend sender).

**Passkey ceremonies (F53):** `POST /api/account/register-options` · `register-verify` ·
`login-options` · `login-verify` · `logout`. Sessions are an opaque `__Host-` cookie (only
`SHA-256(secret)` stored); every mutating route is Origin-checked. Also: `POST
/api/account/passkey-delete` removes one of the caller's passkeys (A302; refuses to delete the
last one), and `POST /api/account/delete` permanently deletes the account + ALL its data (A305,
GDPR; two-phase + resumable — sync workspaces/R2 blobs first, then every D1 row).

**Donations (F54):**

- `functions/api/checkout.ts` — **implemented.** `POST` with `{ plan?: 'one_time' | 'subscription' }`.
  Resolves the price ONLY from `STRIPE_PRICE_*` server-side (never a client amount), and when the
  caller has a session it passes **`client_reference_id = <user id>`** so the webhook can credit the
  exact account. Returns `{ url }`. Origin-checked; 501 until Stripe is configured. Since A278 this
  hosted-Checkout redirect is the FALLBACK path (script/iframe-blocked clients); the primary
  subscription path is the in-app Payment Element below.
- `functions/api/subscription/create.ts` — **implemented (A278).** Session-authed `POST` that creates
  (or resumes an in-flight INCOMPLETE) Stripe subscription with `payment_behavior:
  default_incomplete` and returns `{ clientSecret, publishableKey }` for the in-app Payment Element
  (an already-entitled caller gets `{ alreadySubscribed: true }`). Price resolved ONLY from
  `STRIPE_PRICE_SUBSCRIPTION`; customer reuse-before-create + per-user `Idempotency-Key`s; **never
  grants the tier — the signature-verified webhook stays the only writer of `subscriptions`** (S11/
  F60). Origin-checked; 501 without the Stripe env trio (`STRIPE_SECRET_KEY` +
  `STRIPE_PRICE_SUBSCRIPTION` + `STRIPE_PUBLISHABLE_KEY`), 503 without `ACCOUNTS_DB`. Errors follow
  the repo convention (A326): human sentence in `error`, machine code in `code`.
- `functions/api/subscription/cancel.ts` — **implemented (A333).** Session-authed `POST
  { resume?: boolean }` that sets (or, with `resume`, clears) `cancel_at_period_end` on the caller's
  active/trialing/past_due subscription via the Stripe REST API, returning
  `{ cancelAtPeriodEnd, currentPeriodEnd }`. The tier keeps working until the paid period ends
  (grantsCloud's period-end policy); the webhook stays the only lifecycle writer — the endpoint's one
  local write is the `cancel_at_period_end` display flag (updated optimistically; the
  `customer.subscription.updated` event confirms it, and entitlement never reads it). 404
  `no_subscription` when there is nothing to toggle; Origin-checked; 501/503 fail-closed; A326 error
  shape. ⚠ live DBs need the one-time `ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end
  INTEGER` migration (see schema.sql).
- `functions/api/webhook.ts` — **implemented (F54 + F60).** Verifies the Stripe signature over the RAW
  body FIRST (S11), then dedupes every event via a `webhook_events` ledger (replay-safe). On
  `checkout.session.completed` it records the donation in `donations` **keyed by the Stripe event id**.
  Linkage: `client_reference_id` → credit that user; else a **verified** matching email → credit; else
  the row sits **unclaimed** (keyed by lowercased checkout email) and is claimed when that email is
  verified. Never trusts an unverified checkout email. **F60 subscription lifecycle:** it also handles
  `customer.subscription.created/updated/deleted` + `invoice.payment_failed`, upserting a
  `subscriptions` row keyed to the user with `status` (`canceled` on delete, `past_due` on invoice
  failure, else the object status) + `current_period_end`. 501 without the webhook secret, 503 without
  `ACCOUNTS_DB`.
- `functions/api/me.ts` — **extended (F54 + F60).** Anonymous → `{ tier:'local', cloudSync:false }`
  (unchanged); authed adds `{ user:{ email, emailVerified, donated, donatedAt, donationTotalCents,
  createdAt }, passkeys:[…] }`. **F60:** it reads the `subscriptions` row and **grants
  `{ tier:'cloud', cloudSync:true }`** while `status ∈ {active, trialing}`, OR `past_due` within a
  3-day dunning grace, OR `now < current_period_end` after a cancel (period-end + grace) — otherwise
  `local`. On cutoff the tier drops to `local`; **local IndexedDB data always remains, only sync stops.**
  The Account screen reads `donated`/`donatedAt`/`donationTotalCents` for the real supporter status.

**Recovery email + magic-link re-enrollment (F55):**

- `POST /api/account/email-verify-send` — **authed**, Origin-checked. Emails a single-use verify
  link (15-min TTL). 401 without a session; 503 `{ error:'email unavailable' }` when `RESEND_API_KEY`
  is unbound.
- `GET|POST /api/account/email-verify-confirm?token=…` — consumes the token, sets
  `users.email_verified = 1`, and **claims** any unclaimed donations for that email. GET (the email
  link) 302-redirects back to `/app/app.html?verified=1#account`; POST returns JSON.
- `POST /api/account/recover-send` — **unauthed**, Origin-checked. Takes `{ email }`, ALWAYS returns a
  generic `200` (no account enumeration); emails a magic link only when a **verified** account
  exists. 503 `{ error:'email unavailable' }` when `RESEND_API_KEY` is unbound.
- `POST /api/account/recover-verify` — consumes the recovery token and returns fresh WebAuthn
  **registration** options bound to that user (a new `register` challenge row); the client then posts
  to `register-verify`, which enrolls the new passkey and starts a session (the standard add-passkey
  path). Re-asserts `email_verified` and claims donations.
- `POST /api/account/reclaim-send` — **unauthed**, Origin-checked (A316). Takes `{ email }`, ALWAYS
  returns a generic `200`; emails a single-use reclaim link only when a **never-verified** account
  holds the address (the squatting case — offered by the client after `register-options` answers its
  409 with `reclaimable: true`). 503 when `RESEND_API_KEY` is unbound.
- `POST /api/account/reclaim-confirm` — consumes the reclaim token (proof of inbox ownership). If the
  holder is still never-verified and owns no sync workspaces (their R2 ciphertext would need the A305
  pager), deletes the squatter shell, pre-creates a **fresh, already-verified** account for the email
  (claiming donations), and returns registration options bound to it — `register-verify` then enrolls
  the first passkey and starts the session. `register-options` also **lazily frees** a TTL-expired
  (30-day) never-verified holder at the collision point, so stale squats clear without any link.

Recovery/verify tokens are stored **hash-only** (`SHA-256(secret)`), single-use (`used_at` stamped on
consume), and TTL'd (~15 min) — same posture as sessions (S25). Security never depends on the
fail-open rate limiter (S22/S25).

## Synced workspaces — the dumb encrypted-blob transport (F62)

Step 5 of synced workspaces (design: [`docs/synced-workspaces.md`](../docs/synced-workspaces.md)). The
server is a **deliberately dumb encrypted-blob store**: it holds no key and never decrypts, so it can
**never read a symbol, P&L, note, tag, screenshot, or workspace name** (guardrail **S25**, strengthened).
D1 (`ACCOUNTS_DB`) holds the change-index + wrapped-key blobs; R2 (`SYNC_BUCKET`) holds the record
ciphertext. Shared helpers live in [`functions/_lib/sync.ts`](_lib/sync.ts). Every route is
**session-gated** (opaque `__Host-` cookie), **Origin-checked** on mutations, **fails closed (503)**
without `ACCOUNTS_DB` / `SYNC_BUCKET`, and authorizes each workspace to its `owner_user_id` (a
cross-user or nonexistent workspace answers **404**, so existence never leaks across accounts).

- `POST /api/sync/workspaces` — register (idempotent, owned-by-caller upsert) a workspace + its wrapped
  DEK (F61a `WrappedDek`) + optional encrypted workspace-name record. `GET` lists the caller's
  workspaces (ids + wrapped DEKs + `created_at`).
- `PUT /api/sync/wrapped-ik` — add/rotate one method's wrapped-IK blob (upsert by `method` + `key_id`).
  `GET` returns every wrapped-IK blob for the caller (unlock on a fresh device).
- `POST /api/sync/push` — `{ workspace_id, records: [{ blinded_id, type, ciphertext, updated, deleted? }] }`.
  Stores each ciphertext in R2, upserts the D1 index row under a **monotonic per-workspace `seq`**, and
  honors **LWW** (a stale `updated` never clobbers a fresher row). Batches over 12 records → **413** (A281,
  lowered from 15 for headroom under the A15 subrequest cap; the client chunks).
- `GET /api/sync/pull?workspace_id=&since=<seq>` — returns records with `seq > since` (≤ 25 per page) with
  their ciphertext, plus a `nextSince` cursor + `more` flag for incremental paging.

Every response exposes only `{ workspace_id, blinded_id, seq, type, updated, deleted, ciphertext,
created_at }` + wrapped-key blobs — never a trade field or a plaintext name.

## Public endpoints (shipped)

Live today; no auth required:

- `functions/api/geo.ts` — returns the visitor's coarse region from Cloudflare edge metadata
  (`{ country, region, regionCode }`). No IP lookup, no third-party service, nothing stored.
  Called by the app at boot when no tax state is saved yet (`prefillStateFromGeo` in
  `src/app/lib/dashboard.svelte.ts`, A201) — fire-and-forget, in-memory only, silent on failure.
- `GET /api/status` — the homepage "Live" indicator (`{ mode, label, updatedAt }`). The **POST**
  is admin-only (see below).
- `GET /api/config` — feature flags the app reads at boot (no secrets). The **POST** is admin-only.

## Changelog email subscriptions (F44)

First-party changelog (Blotterlog) release-note emails — D1 list + Resend + double opt-in
(design: [`docs/changelog-email-a141.md`](../docs/changelog-email-a141.md)). Uses the same
`ACCOUNTS_DB` D1 binding (single-purpose `subscribers` + `changelog_sends` tables in
[`schema.sql`](schema.sql)) and the existing `RESEND_API_KEY`/`EMAIL_FROM` email seam. **Guardrail
S25/A141: email address + changelog content ONLY — never any trade data.** Every endpoint fails
closed (503) when `ACCOUNTS_DB` / `RESEND_API_KEY` is unbound.

- `POST /api/subscribe` — same-origin signup from the Blotterlog page. Writes a `pending` row +
  emails a confirm link (double opt-in). **Enumeration-safe:** one generic 200 for new / already-
  pending / already-confirmed. Turnstile + a per-address D1 cooldown are defense-in-depth only (S22).
- `GET|POST /api/confirm?token=…` — consumes the single-use confirm link (`pending → confirmed`).
  GET redirects to `/changelog.html?subscribed=1`; POST returns `{ ok }`. Only `confirmed` rows are
  ever mailed.
- `GET|POST /api/unsubscribe?token=…` — one-click, no login. HARD-DELETES the row (the link IS the
  erasure request). Idempotent + enumeration-safe. Sent as the footer link **and** in
  `List-Unsubscribe(-Post)` headers on every broadcast.
- `POST /api/notify-changelog` — the send trigger. Auth = the `CHANGELOG_NOTIFY_SECRET` shared secret
  (constant-time compare — a real control, S22). Reads `/data/changelog.json`, takes the top prod
  release, dedupes via `changelog_sends`, and batch-sends (Resend `/emails/batch`, ≤100/call → under
  the A15 50-subrequest cap) to confirmed subscribers with per-recipient unsubscribe links. Called by
  [`.github/workflows/changelog-email.yml`](../.github/workflows/changelog-email.yml) (paths-filtered
  on `static/data/changelog.json`; set the `CHANGELOG_NOTIFY_URL` + `CHANGELOG_NOTIFY_SECRET` repo
  secrets — unset ⇒ the workflow no-ops). **A315:** the workflow targets the canonical
  `https://<project>.pages.dev` origin (NOT `blotterbook.com` — the custom-domain zone's Bot Fight
  Mode challenges the GitHub runner with a 403 interstitial; the pages.dev hostname is Cloudflare's
  own zone and isn't governed by it). Supports an optional `?version=<v>` deploy-freshness gate
  (425 while Pages still serves the previous release, so the workflow retries instead of
  broadcasting stale). User-facing links (the unsubscribe URL) are built off `PUBLIC_ORIGIN` when
  set, so the branded domain — not the pages.dev host — reaches subscriber inboxes.

## Admin user table + entitlement overrides (A276)

- `GET /api/admin/users` — admin-token-authed (same posture as `/api/status`; the bearer
  `x-admin-key` header is the CSRF control). Cursor-paginated user list (`created_at DESC`,
  default 25 / clamp 100, `?q=` email substring) returning identity + entitlement fields ONLY
  (S25 — never trade/sync/Stripe-id internals) plus `effectiveTier` computed by
  `hasCloudEntitlement`. Fail-closed 503 without `ACCOUNTS_DB`.
- `POST /api/admin/entitlement` — grant/revoke a manual cloud comp: upserts the audit-trailed
  `entitlement_overrides` row (`granted_by`/`revoked_by` from `Cf-Access-Authenticated-User-Email`;
  revoked rows are KEPT). `hasCloudEntitlement` (accounts.ts) is the single entitlement choke
  point — a live override OR a qualifying subscription — read by both `/api/me` and the
  `/api/sync/*` paywall (`callerHasCloud`), so a comp behaves exactly like a paid tier.

## Admin auth (shipped)

`/api/admin-key`, `/api/status`, `/api/config`, `/api/admin/*` (A276), and the staging gate
(`_middleware.ts`) share `_lib/auth.ts`:

- **Short-lived tokens (S3).** `/api/admin-key` returns a signed HMAC token
  (not the raw key); the admin page stores and sends the *token*. The raw
  `ADMIN_KEY` never reaches the browser, but is still accepted server-side as a
  fallback. Tokens expire (`ADMIN_TOKEN_TTL_SEC`, default 2h).
- **Access JWT verification (S4).** When `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` are
  set, `/api/admin-key` verifies the `Cf-Access-Jwt-Assertion` signature against
  the team JWKS (cached 1h) + audience/issuer/expiry before issuing a token.
  Unset → **fails closed** with a 503 (S12) unless `ALLOW_PRESENCE_AUTH=1`
  (local/preview only) re-enables the presence-only fallback.

Admin-auth environment variables (set in the Pages dashboard):

- `ADMIN_KEY` — the existing admin secret (also the default token-signing secret).
- `TOKEN_SECRET` — optional dedicated HMAC signing secret (defaults to `ADMIN_KEY`).
- `ADMIN_TOKEN_TTL_SEC` — optional token lifetime in seconds (default `7200`).
- `ACCESS_TEAM_DOMAIN` — e.g. `https://<team>.cloudflareaccess.com` (enables S4).
- `ACCESS_AUD` — the Access application's Audience (AUD) tag (enables S4).
- `ALLOW_PRESENCE_AUTH` — set to `1` ONLY for local/preview. With `ACCESS_TEAM_DOMAIN`+
  `ACCESS_AUD` unset, admin-key issuance and the staging gate **fail closed** (S12); this
  flag re-enables the old presence-only behavior where the route is gated some other way.
- `ADMIN_DEBUG` — set to `1` to enable the `?check` diagnostic below (off by default, so it
  can't fingerprint the infra for anonymous callers — S12). Unset it again after diagnosing.

**Is S4 actually on? `GET /api/admin-key?check`** (requires `ADMIN_DEBUG=1`) — run it through
Access (the admin host) and read the JSON. It issues NO token and returns NO secret; it
reports whether S4 is enforced and, separately, the signature / issuer / audience / expiry
checks so a misconfigured env var is obvious:

- `s4Active` — true only when both `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set (when
  false, the endpoint is falling back to the presence-only check — S4 is effectively off).
- `accessTeamDomain` / `accessAud` — the configured values, to eyeball against your dash.
- `jwt.signatureValid` — the assertion's signature verified against the team JWKS.
- `jwt.issMatches` — token `iss` equals `ACCESS_TEAM_DOMAIN` (false ⇒ wrong team domain).
- `jwt.audMatches` — token `aud` includes `ACCESS_AUD` (false ⇒ wrong AUD tag).
- `jwt.expired`, `jwt.kidFound`, `jwt.email`, `jwt.present`.

Healthy config: `s4Active:true` and `jwt` shows `signatureValid:true, issMatches:true,
audMatches:true, expired:false`.

## Environment variables (set in the Pages dashboard when implementing)

- `STRIPE_SECRET_KEY` — used by `/api/checkout` to create Checkout Sessions via the Stripe REST API.
- `STRIPE_WEBHOOK_SECRET` — once set, `/api/webhook` verifies the `Stripe-Signature` over the
  raw body (HMAC-SHA256, 5-min replay window) and rejects forgeries with 400 (S13). Until the
  secret is set the endpoint fails closed (501) and never acts on an event.
- `STRIPE_PRICE_ONE_TIME`, `STRIPE_PRICE_SUBSCRIPTION` — the only source of the price id (the client
  sends a plan NAME, never a price/amount).
- `STRIPE_PUBLISHABLE_KEY` — **(A278)** returned by `/api/subscription/create` so the client can mount
  the in-app Payment Element (public by design — it identifies the account to Stripe.js, grants no
  API access). Unset → the endpoint answers 501 and the client falls back to hosted Checkout.
- `RESEND_API_KEY` — **(F55)** the Resend API key for the two transactional emails (verify + recovery
  magic link). `functions/_lib/email.ts` posts to `https://api.resend.com/emails` via `fetch()` (no
  SDK). **Unbound → the email endpoints return 503 `{ error:'email unavailable' }`** and never crash.
  Setup for the owner: create a Resend account, verify the sending domain, mint an API key, and set
  it (plus `EMAIL_FROM`) in the Pages dashboard.
- `EMAIL_FROM` — optional From address for F55 emails (e.g. `Blotterbook <no-reply@blotterbook.com>`);
  defaults to that when unset. Also used by the F44 changelog emails.
- `CHANGELOG_NOTIFY_SECRET` — **(F44)** shared secret the changelog-email send trigger presents to
  `POST /api/notify-changelog` (constant-time compared). **Unbound → the endpoint is disabled (503)**
  so no one can trigger a broadcast on a deploy that isn't wired for it. Also set the matching
  `CHANGELOG_NOTIFY_URL` + `CHANGELOG_NOTIFY_SECRET` **repo secrets** for the workflow —
  `CHANGELOG_NOTIFY_URL` must be the canonical `https://<project>.pages.dev` origin, not the custom
  domain (A315 — Bot Fight Mode on the custom-domain zone blocks the GitHub runner; a trailing
  slash is tolerated, the workflow strips it). _Configured on prod 2026-07-07._
- `PUBLIC_ORIGIN` — **(F44/A315)** the branded origin (`https://blotterbook.com`, no trailing
  slash) used by `/api/notify-changelog` to build user-facing links (the unsubscribe URL) when the
  workflow invokes it at the pages.dev origin. Falls back to the request origin when unset — which
  would leak the pages.dev host into subscriber inboxes, so keep it set. _Configured on prod
  2026-07-07._
- `TURNSTILE_SECRET` — **(F44, optional)** Cloudflare Turnstile secret for the changelog signup form.
  **Unbound → Turnstile is skipped** (defense-in-depth only, S22 — never the security boundary; the
  double opt-in + confirmed-only send are the real invariants). Fails open when the service is down.

## Bindings to add when implementing

- **D1** (`ACCOUNTS_DB`) for accounts + entitlements + donations + recovery tokens + the F44 changelog
  list + the F62 synced-workspaces change-index / wrapped keys — schema in
  [`functions/schema.sql`](schema.sql). **After ANY change to `schema.sql`** (F54 added `donations`,
  F55 added `recovery_tokens`, F44 added `subscribers` + `changelog_sends`, **F62 added
  `sync_workspaces` + `sync_workspace_keys` + `sync_wrapped_ik` + `sync_records`**, **A276 added
  `entitlement_overrides` + two indexes**) the owner must
  **re-run** the idempotent apply command so the new tables exist in prod:
  `npx wrangler d1 execute blotterbook-accounts --remote --file=functions/schema.sql`.
- **R2** (`SYNC_BUCKET`) for the synced-workspaces encrypted-record ciphertext blobs (F62). Holds ONLY
  opaque AES-GCM ciphertext (F61a `EncryptedRecord`), keyed `records/<workspace_id>/<blinded_id>` — never
  a symbol, P&L, note, tag, screenshot, or workspace name (guardrail S25); D1's `sync_records` rows point
  at these objects via `ciphertext_ref`. **Every `/api/sync/*` endpoint fails closed with a 503 JSON body
  when `SYNC_BUCKET` (or `ACCOUNTS_DB`) is unbound.** Create + bind the bucket:
  `npx wrangler r2 bucket create blotterbook-sync`, then Pages dashboard → Settings → Functions → R2
  bucket bindings → variable name `SYNC_BUCKET`.
