# User accounts architecture — passkeys-only, donation-aware (R24)

**Date:** 2026-07-05 · **Backlog item:** R24 · **Status:** written architecture (no code changed)

> **Implementation note (accuracy check against the shipped code):** F53 (Phase 1) shipped
> 2026-07-05 largely per this plan, but with structural details that evolved during the build —
> `functions/schema.sql` is the current source of truth for the actual tables, not the sketch below.
> Notably: sessions use a split `id` (public lookup key) + `secret_hash` design rather than a single
> hashed opaque token; `recovery_tokens` carries a `purpose` (`'verify'` | `'recover'`) column serving
> both email verification and lost-passkey recovery in one table; and `donations` gained
> `stripe_customer_id`/`claimed_at` instead of a `mode` column. `functions/api/account/` also already
> has endpoints beyond the four Phase-1 ceremony routes (`email-verify-send`/`-confirm`,
> `recover-send`/`-verify`) even though F54/F55 show as open in the backlog at time of writing — treat
> `functions/schema.sql` and `functions/api/account/*` as ground truth over the SQL/API sketch below,
> which records the original design intent and rationale (still valid) rather than the final shape.

## Recommendation (up front)

- **Auth = passkeys only (WebAuthn), built on `@simplewebauthn/server` + `@simplewebauthn/browser`**
  (v13.3.x, actively maintained, MIT, explicitly supports Cloudflare Workers — it's the standard
  primitive; better-auth's own passkey plugin wraps it). We own the four ceremony endpoints
  (~300 lines) instead of adopting an auth framework. **No passwords, ever** — no hashing, no
  breach surface, no reset-password flows.
- **Sessions = hand-rolled DB sessions** per Lucia's successor guidance (Lucia v3 was deprecated
  March 2025 and became exactly this recipe): opaque 256-bit token, SHA-256 hash stored in D1,
  `__Host-` HttpOnly cookie. No JWT — sessions must be revocable.
- **Reject better-auth** for this scope: it's a full framework (email/password, orgs, social)
  around the 5% we need, D1 support is recent (native in 1.5) with open Workers session-cache bugs
  (e.g. #4203), and it would own our `user` table shape. Revisit only if scope balloons.
- **Reject managed auth.** Clerk (free ≤10k MAU, passkeys included) requires ClerkJS from their
  CDN — breaks `script-src 'self'`, non-negotiable. Auth0 (free ≤25k MAU, passkeys) is
  redirect-based so CSP survives, but identity egress to Okta undercuts the privacy posture for
  zero effort saved at this scale. Self-hosted passkeys keep even *identity* first-party; the
  marketing claim "trade data never leaves the browser" survives every option here — accounts
  carry identity + entitlements only, **never trades** — but first-party keeps it unqualified.
- **SSO: no Google/Apple OAuth.** For most users, "Sign in with the Google/Apple account" *is* the
  passkey UX already — iCloud Keychain and Google Password Manager are the platform authenticators
  that create and sync the passkey. OAuth would add redirect flows, client secrets, and a second
  account-linking model for near-zero UX gain. Recovery is a **verified recovery email** (magic
  link → short-lived session → enroll a new passkey) plus UI nudges to register a second passkey.
- **Backup account-hash lock: NO.** Exports stay plain JSON, restorable with no account and no
  server — the app works logged-out and that's the moat. A signature adds integrity/ownership
  theater (strippable by anyone, verifiable only online) at the cost of the local-first promise.
  Instead: (1) add a plain content checksum to the export envelope (corruption detection, no
  account); (2) fold the `Store.local` layouts/tabs into `exportAll` v3 first — an independent gap.

## Data model (D1 — guardrail A17: accounts are per-user writes, so D1, never KV)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- crypto.randomUUID()
  email TEXT UNIQUE NOT NULL,       -- lowercased; recovery + donation linkage
  email_verified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  donated_at INTEGER,               -- first verified donation (NULL = none)
  donation_total_cents INTEGER DEFAULT 0,
  stripe_customer_id TEXT           -- set by webhook when known
);
CREATE TABLE credentials (          -- one row per passkey
  id TEXT PRIMARY KEY,              -- base64url credential ID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT, aaguid TEXT, backed_up INTEGER,   -- aaguid → "iCloud Keychain" nickname
  nickname TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- SHA-256(token) — DB leak ≠ session theft
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER
);
CREATE TABLE challenges (           -- pending WebAuthn ceremonies, TTL ~5 min
  id TEXT PRIMARY KEY, type TEXT NOT NULL,           -- 'register' | 'login'
  user_id TEXT, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE donations (
  id TEXT PRIMARY KEY,              -- Stripe event id ⇒ webhook dedupe for free (S11)
  user_id TEXT, email TEXT,         -- user_id NULL until claimed by verified email
  amount_cents INTEGER, currency TEXT, mode TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE recovery_tokens (
  hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, used_at INTEGER      -- single-use, ~15 min TTL
);
```

Entitlements later hang off `users` (a `tier` column or table) — `functions/README.md`'s flow and
`src/lib/core/entitlements.ts` (`current()` → `/api/me`) slot in unchanged.

## API surface (new Pages Functions; all same-origin, CSP untouched — WebAuthn is a browser API)

- `POST /api/account/register/options` / `register/verify` — create ceremony (email in), store
  challenge, verify attestation, insert `users`+`credentials`, set session cookie.
- `POST /api/account/login/options` / `login/verify` — assertion ceremony (usernameless/discoverable
  credentials — no email prompt on login), verify, bump `counter`, set session cookie.
- `POST /api/account/logout` — delete session row, clear cookie.
- `GET /api/me` — **extend the existing stub**: anonymous → today's `{ tier:'local', cloudSync:false }`;
  authed → adds `{ user: { email, donated, donatedAt, donationTotalCents }, passkeys: [...] }`.
- `POST /api/account/recovery/request` / `recovery/verify` — email a single-use magic link;
  verify → short-lived session flagged for immediate new-passkey enrollment.
- `GET|DELETE /api/account/passkeys[/:id]` — list/rename/remove (refuse deleting the last one
  unless a recovery email is verified).
- Reuse `functions/_lib/` (`json`, `rateLimited` as defense-in-depth per S22 — auth correctness
  never depends on it). New env/bindings: `DB` (D1), `RESEND_API_KEY` (or equivalent) for the two
  transactional mails, `RP_ID`/`ORIGIN` consts.

## Session mechanism

Cookie, not bearer token: `__Host-bb_session` = opaque random 256-bit value; `HttpOnly; Secure;
Path=/; SameSite=Lax`; 30-day sliding expiry (extend `expires_at` on use). CSRF posture: SameSite=Lax
+ an explicit **Origin header check** on every mutating `/api/account/*` route (all POSTs are
same-origin JSON; no form posts) — no token dance needed. `script-src 'self'` means no third-party
JS can ride the cookie. D1 lookup is one indexed read per authed request; fine at this scale.

## Recovery story

Passkeys sync within an ecosystem (iCloud Keychain / Google Password Manager), so single-device
loss is already covered for most users. For ecosystem loss: (1) **recovery email** — required at
registration (it's also the donation-linkage key), magic-link flow above; (2) **second passkey**
nudge on the Account screen (e.g. "add one on your phone" — cross-device QR enrollment comes free
with WebAuthn). No SMS, no security questions, no support-ticket resets.

## Phased build plan

**Phase 1 — passkeys + Account sidebar item (ship first).** D1 binding + migrations; the four
ceremony endpoints + logout + extended `/api/me`; `@simplewebauthn/*` deps. App side: an `Account`
nav item at the bottom of the sidebar — logged-out it reads **Login** and opens a dialog (existing
shadcn `dialog`) with "Log in with a passkey" / "Create account"; logged-in it becomes an
**Account** screen: email, passkey list (rename/remove/add), donation status badge, sign-out, and a
disabled **Workspaces** section stub ("Synced workspaces — coming later"). Session state is a rune
in a new `src/app/lib/account.svelte.ts`; demo surface shows the logged-out state with every
control disabled (demo never mutates); gate rollout behind `isStaging` first.

**Phase 2 — donation → account (Stripe, S11).** Extend `/api/webhook` *after* the existing
signature verification: on `checkout.session.completed` insert into `donations` (PK = event id →
idempotent), match `customer_details.email` → set `users.donated_at`/total; unmatched rows sit
keyed by email and are **claimed at registration/recovery once the email is verified** (never on
self-asserted email). Upgrade donations to `POST /api/checkout` (per R15) passing
`client_reference_id` = user id when logged in for exact linkage; success redirect prompts
account creation when anonymous ("Save your supporter status — create an account").

**Phase 3 — login-gated launch (design now, ship staged).** An initial-state module before the
app shell: **Log in** beside **Create account** (both passkey ceremonies). Behind an
`APP_FLAGS`/config flag + `isStaging` until the owner flips it; demo never gates. ⚠ Tension flag:
a hard gate contradicts "no sign-up, local-first" (Howto.svelte says so verbatim) — recommend a
"Continue without an account" escape hatch, or at minimum an explicit owner sign-off on retiring
that copy (see Open questions).

**Phase 4 — workspace scaffolding.** Activate the Workspaces section: name/list workspaces
(D1 metadata only — **trade data itself never goes server-side until the owner explicitly approves
a CloudStore tier**, and R2 blobs should be client-side encrypted per `functions/README.md`).
Wire `Entitlements.current()` → `/api/me` tier and `storeFor()`. **Hard-gated on A16** (Workers
Paid before any paying sync tier) and on the CloudStore initiative being real.

## Open questions for the owner

1. **Phase 3 gate severity:** hard gate, or gate-with-"continue without account"? The marketing
   copy ("no sign-up") must change either way — approve the copy change?
2. **Recovery email mandatory at registration?** Recommended yes (it's also the donation key);
   the alternative (passkey-only, no email) makes lost-ecosystem accounts unrecoverable.
3. **Email sender:** Resend/Postmark/SES for the two transactional mails — pick one (new vendor;
   only *emails* leave our infra, never trade data). Related to the A141 changelog-email idea.
4. **Claim window:** should anonymous donations claimable-by-email expire (e.g. 1 year)?
5. **Does `donated` unlock anything** (supporter badge only, or future perks)? Affects whether
   `/api/me` needs it before Phase 2.

## Proposed backlog items

- **F53 (P2, large)** — Accounts Phase 1: D1 schema + passkey register/login/logout endpoints
  (`@simplewebauthn/server` v13) + session cookie (`__Host-`, hashed in D1, Origin-checked) +
  extended `/api/me`; sidebar Login→Account screen with passkey management + donation badge +
  Workspaces stub; demo-safe (disabled), staged behind `isStaging`; unit-test ceremonies in
  `scripts/test-accounts.mjs`.
- **F54 (P2, medium)** — Accounts Phase 2: webhook donation provisioning after S11 verification
  (dedupe on event id, email claim at verified-email time only), `client_reference_id` via
  `/api/checkout`, post-donation account prompt.
- **F55 (P3, medium)** — Recovery: mandatory recovery email + magic-link re-enrollment flow +
  second-passkey nudge; pick the email vendor (Open question 3).
- **F56 (P3, medium)** — Phase 3 login-gated launch module (Log in + Create account), behind a
  config flag + staging; resolve Open question 1 before promoting.
- **A236 (P3, small)** — Export v3: fold the `Store.local` seam (dashboard layouts/tabs/workspace
  templates) into `exportAll`/`importAll` + add a plain SHA-256 payload checksum to the envelope.
  Independent of accounts; explicitly **no** account-hash lock (R24 verdict).
- **S25 (P2, small)** — Guardrail: accounts hold identity + entitlements only — no trade data,
  ever, in D1/KV/R2 without an explicit owner-approved CloudStore ADR; auth never depends on the
  fail-open rate limiter (extends S22); challenges/sessions/recovery tokens single-use + TTL'd.
- **(existing) A16 / A17 / S11** — unchanged; A16 gates Phase 4, A17 is honored (D1 only), S11's
  verify-before-provision ordering is preserved by Phase 2.

## R25 — passkeys-only review (2026-07-06)

A short decision review now that F53–F55 have shipped the passkey ceremonies, donation provisioning,
and the recovery/verify flows. Question on the table: is passkeys-only auth the right posture, and
should we add a phone/email MFA factor?

**Risks of passkeys-only.**

- **Ecosystem lock-in / device loss.** A passkey created in iCloud Keychain or Google Password
  Manager syncs *within* that ecosystem but not across them. A user who loses their whole ecosystem
  (or switches Apple↔Android) can be locked out. *Mitigated by F55:* verified recovery email →
  magic-link re-enrollment, plus the second-passkey nudge (enroll one on a phone via cross-device QR)
  so most users already hold two independent authenticators.
- **Managed / locked-down devices.** Corporate MDM or kiosk browsers can disable WebAuthn platform
  authenticators or block cross-device (hybrid) flows, leaving a user with no way to enroll. Roaming
  security keys work but we can't assume them. The recovery email is the escape hatch here too.
- **Old browser / OS gaps.** Passkeys need a reasonably current OS + browser; discoverable-credential
  (usernameless) login needs newer still. Pre-passkey environments simply can't create an account —
  acceptable for a modern trading-tools audience, but real tail exclusion.
- **Shared computers.** No password to type is a security win, but a synced passkey on a shared
  machine's platform authenticator is a footgun; the usual guidance (don't save your passkey on a
  shared device) applies and is a support/education cost, not a code one.
- **Signup abandonment.** "Create a passkey" is still unfamiliar; some users bounce at the OS prompt.
  Blotterbook softens this because **accounts are optional** — the app is fully usable logged-out, so
  a failed passkey ceremony never blocks the core product (unlike the Phase 3 hard-gate tension,
  still unresolved — Open question 1).

**Phone/email MFA recommendation.** F55's magic link **is already an email possession factor** — it
gates account recovery and donation claiming, so we have a second factor without new PII. SMS OTP
would add a phone number (PII we otherwise never collect — counter to the privacy posture), recurring
per-message cost, carrier/deliverability complexity, and it is **more phishable and SIM-swappable**
than either a passkey or a single-use email link — a net downgrade as a security factor.

**Recommendation: stay passkeys + verified email recovery; do NOT add SMS.** Passkeys remain the
primary (phishing-resistant, no shared secret) factor and the emailed magic link is a sufficient,
low-PII recovery/possession factor; SMS OTP adds cost, PII, and phishability for no security gain.
Keep investing in the F55 mitigations (push the second-passkey nudge, keep recovery email verified
and prominent) rather than a new channel.
