# A141 — Changelog (Blotterlog) email notifications: recommendation

**Date:** 2026-07-05 · **Backlog item:** A141 (Discussion/Evaluation) · **Status:** recommendation delivered; implementation spun off below.

## Recommendation (up front)

**Build it first-party: a Pages Function signup endpoint + a D1 subscriber list + Resend as the
transactional sender, triggered by a GitHub Actions workflow that fires when `static/data/changelog.json`
gains a new prod release.** Rough cost at 0–1k subscribers: **$0/mo up to ~100 subscribers** (Resend
free tier: 3,000 emails/mo but hard-capped at 100/day, which bounds a single release send), then
**$20/mo (Resend Pro, 50k emails/mo)** once the list outgrows the daily cap. D1 and the Functions stay
on the Workers free plan throughout ($0). Runner-up: **Buttondown** ($0 to 100 subscribers, $9/mo to
~1k) buys the entire compliance layer (double opt-in, archives, one-click unsubscribe) and keeps email
addresses off our infrastructure entirely — the right fallback if the implementation item stalls. It was
not chosen because a third-party embedded form breaks the CSP (`form-action 'self'`, `connect-src 'self'`
in `static/_headers`), it puts the list in a vendor we can't query, and the first-party build is small
given `functions/_lib/` (auth, http) already exists. **Hard constraint holds by construction:** the
system touches only email addresses + rendered changelog content; it has no code path into the app,
IndexedDB, or any trade/journal data.

### Why D1 and not KV (the A17 justification)

Signups are per-visitor writes on a public endpoint. Expected volume (a few/day) is far below KV's
1,000-writes/day free cap, but that is not the point: **A17 categorically rejects per-visitor KV writes
on public paths** — a bot hitting the signup endpoint could exhaust the shared daily write budget and
break the admin status/flags that live in `STATUS_KV`. KV is also eventually consistent (no unique
constraint → duplicate/race signups) and can't run the queries a list needs (confirmed-only selects,
expiry purges). **D1's free tier (100k row writes/day, 5M row reads/day, 5 GB) is the right store** and
is already the planned home for accounts/entitlements (`functions/README.md`). Workers free-plan request
cap (100k/day) is untouched at this traffic.

### Provider comparison (free tiers verified 2026-07)

| Provider | Free tier | Fit |
|---|---|---|
| **Resend** | 3,000/mo, **100/day**, 1 domain | **Pick.** Batch API (100 msgs/call) keeps a 1k-recipient send at 10 subrequests — inside the 50-subrequest free cap (A15). Pro $20/mo removes the daily cap. |
| Postmark | 100/mo total | Dev/testing tier only; one 100+ send exhausts a month. No. |
| MailChannels | Free Workers arrangement **ENDED 2024-08-31** (verified). Paid Email API has a 100/day free plan. | No reason to prefer over Resend; the "free from Workers" era is over. |
| Brevo | 300/day, unlimited contacts | Viable $0 stopgap for sends when the list is 100–300; marketing-platform weight we don't need. |
| Buttondown | 100 subscribers free, then $9/mo (~1k) | Runner-up "buy" option — full newsletter compliance included, but off-CSP forms + vendor-held list. |

## Design sketch

- **Signup:** `functions/api/subscribe.ts` — `POST { email }` from a small form on `changelog.html`
  (same-origin, so the existing CSP holds unchanged). Validates + lowercases the address, inserts
  `{ email, status:'pending', confirm_token, created_at }` into D1 (`UNIQUE(email)`; re-signup of a
  pending/confirmed address just re-sends/no-ops the confirm mail, subject to a per-address cooldown
  column). Sends the confirmation email via Resend (1 subrequest).
- **Storage (D1 `subscribers`):** `email TEXT UNIQUE`, `status ('pending'|'confirmed')`,
  `confirm_token`, `unsub_token` (both 128-bit random), `created_at`, `confirmed_at`. Plaintext email is
  required to send — hashing the stored address is incompatible with sending, so don't pretend; instead
  keep the table single-purpose, never log raw addresses (hash in logs), and hard-delete on unsubscribe.
  A `sends (version, sent_at)` table records which changelog version has been mailed (idempotency).
- **Confirm (double opt-in):** `GET /api/confirm?token=…` flips `pending → confirmed`, stamps
  `confirmed_at`, invalidates the token. Pending rows older than 7 days are purged during
  subscribe/notify invocations (no cron needed). **Only confirmed rows are ever sent to.**
- **Send trigger:** a new GitHub Actions workflow (`changelog-notify.yml`) `on: push` to `main` with
  `paths: [static/data/changelog.json]` — *not* a step inside `version-bump.yml`, because that workflow
  fires on the version bump while the curated changelog entry lands in a separate hand-authored commit
  (per CLAUDE.md), and its `[skip ci]` release commit + retry loop shouldn't gain email side effects.
  The workflow POSTs `/api/notify-changelog` with a shared secret (GH secret ↔ Pages env var,
  constant-time compare via `_lib/auth.ts` patterns — real auth, per S22). _As built the workflow is
  `changelog-email.yml`, and per A315 (2026-07-07) it targets the canonical
  `https://<project>.pages.dev` origin rather than the custom domain (whose Bot Fight Mode
  challenge-blocked the GitHub runner); the Function's `PUBLIC_ORIGIN` env var keeps the
  unsubscribe link branded `blotterbook.com`, and a `?version=` deploy-freshness gate returns 425
  until Pages serves the just-committed release. Repo secrets + Pages env vars were configured on
  prod 2026-07-07._ The Function reads
  `/data/changelog.json`, takes the top release, checks the `sends` table (dedupe), renders text+HTML
  from `title/summary/highlights`, and batch-sends via Resend with per-recipient unsubscribe links.
  A Cron Trigger diffing changelog.json was considered and rejected: Pages Functions don't take cron
  triggers (it'd need a separate Worker), and the repo push is the authoritative "new prod entry" event.
- **Unsubscribe:** per-recipient `https://…/api/unsubscribe?token=…` in the footer **and** in
  `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (Gmail/Yahoo bulk
  requirement). One GET/POST with a valid token hard-deletes the row — no login, no confirmation page
  friction. Optionally retain a salted hash tombstone briefly to damp re-subscribe abuse.
- **Sending domain:** a dedicated subdomain (e.g. `news.<domain>`) with SPF/DKIM/DMARC via Cloudflare
  DNS — free, and isolates the root domain's reputation.

## Privacy / opt-in requirements checklist

- [ ] **Double opt-in** — no email beyond the single confirmation mail until the address is confirmed.
- [ ] **One-click unsubscribe** — footer link + `List-Unsubscribe(-Post)` headers; token, not login.
- [ ] **Hard delete on unsubscribe**; pending signups auto-purged after 7 days.
- [ ] **Data minimization** — store email + tokens + timestamps only. **No IP, no user-agent, no
      analytics**, and by the A141 hard constraint no linkage to any trade/journal data (the list lives
      in D1; trade data never leaves the browser — the moat holds).
- [ ] **GDPR-lite posture** — consent is the double opt-in record (`created_at`/`confirmed_at`);
      privacy page gains a section naming the purpose (release notes only), the processor (Resend, as
      data processor), and the erasure path (the unsubscribe link *is* the erasure request).
- [ ] **Content discipline** — emails carry changelog content only; no tracking pixels or click
      tracking (disable Resend open/click tracking).
- [ ] **Abuse controls** — Cloudflare Turnstile on the signup form (free) + per-address cooldown in D1;
      a best-effort per-IP limiter is fine as defense-in-depth **but per S22 must not be the security
      boundary** (it fails open) — the real invariants are Turnstile, double opt-in, and the
      confirmed-only send rule. No KV writes on this path (A17).

## Open questions

1. Expected list size and release cadence — if either stays tiny, Resend free ($0) may suffice
   indefinitely; the $20/mo step only triggers when a single send exceeds 100 recipients/day.
2. Turnstile adds a Cloudflare script to `changelog.html` — acceptable CSP change (`script-src` +
   `connect-src` additions on that page), or prefer cooldown-only friction at launch?
3. Should confirm/unsubscribe land on small static pages (nicer UX) or plain Function responses (v1)?
4. Digest behavior: if several prod entries land before a send, one email covering all unsent versions?
5. Does this warrant the Workers Paid plan now anyway (A16 says it's a prerequisite for cloud sync)?
   Not required for this feature — free-tier D1/requests suffice — but it would moot all cap math.

## Proposed backlog items

- **F-A141a (implementation):** Changelog email subscriptions — D1 `subscribers`/`sends` schema +
  `subscribe`/`confirm`/`unsubscribe`/`notify-changelog` Pages Functions + Resend integration + signup
  form on the Blotterlog page + privacy-page section. Includes tests (`scripts/test-*.mjs` suite) for
  token/validation logic and the S22/A17 constraints above.
- **F-A141b (trigger):** `changelog-notify.yml` GitHub Actions workflow (paths-filtered on
  `static/data/changelog.json`) + shared-secret wiring + send idempotency via the `sends` table.
- **F-A141c (deliverability/ops):** sending subdomain SPF/DKIM/DMARC setup; monitor Resend daily-cap
  headroom; decide the $20/mo Pro upgrade (or Brevo stopgap) when the confirmed list nears 100.
- **Guardrail note for A17/S22:** the subscribe path writes to D1 only (never KV) and its limiter is
  defense-in-depth only.
