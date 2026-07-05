# Stripe integration assessment — donations now, subscriptions later (R15)

**Date:** 2026-07-05 · **Backlog item:** R15 · **Status:** written scoping (no code changed)

## Recommendation (up front)

**Donations MVP = hosted, full-redirect Stripe — no Stripe.js on our pages, zero CSP change.**
Concretely: start with **two dashboard-created Payment Links** ($25 one-time, $50/year) opened
from the existing "Back the project" pricing card in a new tab. This is the smallest path to
taking money: **no server code, no publishable key, no client secret, nothing added to the
static bundle.** The already-scaffolded `POST /api/checkout` (Checkout Session, server-side
price IDs per S13) is the **upgrade path**, not the MVP — it buys on-site metadata/success
control and is the mandatory primitive for subscriptions, so implement it as part of the
subscription scaffolding. **Reject the Payment Element** for this product: it embeds Stripe.js,
which would force `script-src https://js.stripe.com` + `frame-src https://js.stripe.com` +
`connect-src https://api.stripe.com` into the currently-pure `'self'` CSP for no donation-side
benefit.

Primitive comparison (per current Stripe docs): all three take one-off payments; Payment Links
and Checkout both offer hosted pages and the "customer chooses price" model (donations); only
the Payment Element runs on-page (Stripe.js, CSP cost). Payment Link = dashboard-configured,
static URL; Checkout Session = the same hosted page created per-request by our server with full
programmatic control (metadata, success/cancel URLs, customer, mode=subscription).

## Donations MVP build plan (Payment Links)

1. **Stripe account + products (dashboard, test mode).** Create Products/Prices: "Back the
   project — $25 (one-time)" and "— $50 / year" (**note:** $50/*year* is a *recurring* Price ⇒
   Stripe treats it as a subscription; see Open questions #2). Create the two Payment Links;
   set the confirmation to redirect back to `https://blotterbook.com/?donated=1` (or a `/thanks`
   page, later). Donation-appropriate settings: no promo codes, quantity 1, collect email only.
2. **Homepage hook.** `src/site/components/Home.svelte`, `#pricing` section (~L466): the second
   `.plan` card "Back the project" (~L516–555). Replace the footer line "Donations open soon —
   secure checkout via Stripe" (~L554) with two explicit CTAs — `<a href={LINK} target="_blank"
   rel="noopener noreferrer">` styled as buttons (no Tailwind preflight: bare `<a>` gets UA
   blue/underline — style explicitly). New-tab matches the decided F24/A125 pattern (that
   staging Donate button was retired at the CH16 cutover; nothing named "Donate" ships today).
   The link URLs are public by design — putting them in the static client leaks no secret.
3. **No server required for the MVP.** Donations grant **no entitlement** — nothing to
   provision, so the webhook is *optional* here. S11 stands: `/api/webhook` already verifies
   `Stripe-Signature` (HMAC over the raw body, constant-time, 5-min replay window —
   `functions/_lib/auth.ts:verifyStripeSignature`) and otherwise 501s; leave it inert.
4. **Test → live.** Exercise the flow end-to-end with test-mode links + card `4242…`; verify
   the redirect-back and the pricing-card copy. Live cutover: activate the Stripe account
   (**requires the entity decision — see Launch prerequisites**), swap the two URLs to live-mode
   links, done. Keep test/live URLs in one obvious const so the swap is a one-line diff.
5. **Copy/legal touch:** link the (future) Donations/Refund policy from the card per F18.

**Effort: small — ~0.5–1 day** (dashboard setup + Svelte card edit + e2e assertion on the CTA
target/`rel` + copy), *excluding* the account-activation/entity blocker.

**Secrets/env for the MVP: none.** The existing `Env` already declares `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ONE_TIME`, `STRIPE_PRICE_SUBSCRIPTION`
(`functions/_lib/types.ts`) — they stay unset until the Checkout-Session/webhook work lands.
All Stripe secrets live only in the Pages dashboard env; **never in the static client** (the
redirect approach needs no publishable key at all).

## Checkout-Session upgrade (when wanted / for subscriptions)

Implement `POST /api/checkout` per its scaffold sketch: body `{ plan: 'one_time'|'subscription' }`
→ resolve the Price ID **only** from `env.STRIPE_PRICE_*` (S13 — never client-supplied
price/amount) → `fetch` Stripe REST (`/v1/checkout/sessions`, form-encoded; no SDK needed on
Workers) with `mode=payment|subscription`, `success_url`/`cancel_url` → return `{ url }`; the
client does `window.open(url)` / `location.assign(url)` — still a full redirect, still no
Stripe.js. Add rate limiting via the existing `rateLimited()` **as defense-in-depth only** (S22)
— the endpoint creates sessions but charges nothing, so anonymous access is acceptable for
donations; the *subscription* plan must additionally require an authenticated user (see below).
Effort: **~1 day** incl. a `scripts/test-*` unit for the plan→price mapping.

## Subscription scaffolding (later goal — note the dependency)

**Hard gates, in order:** (1) user accounts/auth — none exist; (2) remote storage (`CloudStore`
behind the `Store` seam + D1/KV accounts + R2 blobs — `functions/README.md`); (3) **A16**: move
to **Workers Paid before** any paying sync tier (free-tier 100k req/day + 1k KV writes/day
cannot back a paid product). Do not sell the $5/mo synced-workspaces tier before all three.

**Stub now (cheap, unblocks later):**
- Test-mode Product/Price for "Synced workspaces ~$5/mo"; park the ID in `STRIPE_PRICE_SUBSCRIPTION`.
- Configure the **Billing Portal** (dashboard, test mode) — cancellation/card-update UI for free.
- Extend `/api/webhook` with a verified-event **switch skeleton** that recognizes
  `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
  `invoice.paid|payment_failed`, dedupes on `event.id`, ACKs 200 fast — but **provisions
  nothing** until accounts exist (S11: verification already precedes everything; keep it that way).
- Keep `/api/me` returning `{ tier:'local' }`; the entitlement lookup slots in behind it later.

**Defer (blocked on accounts/storage):** Customer creation + customer↔user mapping (D1/KV),
`/api/portal` (portal session, authenticated), webhook provisioning `subscription → cloud` tier,
`Entitlements.storeFor()` wiring, dunning/grace-period policy. Full build: **large (1–2 wk),
BLOCKED** — don't start until the CloudStore initiative is real.

## CSP / `_headers` impact

**None for the recommended path** — already anticipated in `static/_headers` ("When Stripe
checkout lands it redirects (full navigation), so no CSP change is needed"). Anchor/`location`
navigation isn't gated by `connect-src`/`form-action`; the checkout page is Stripe's origin with
Stripe's CSP. Embedded Stripe (Payment Element / embedded Checkout) would need `script-src` +
`frame-src js.stripe.com`, `connect-src api.stripe.com` (+ `img-src`), weakening the strictest
headers we have — avoid unless a future need outweighs that.

## Launch prerequisites (flagged, not built now)

- **Entity decision + legal pack (F18, A202 — currently HELD).** Stripe activation requires a
  legal entity/seller identity; F18's ToS + Privacy Policy + the **$25/$50 voluntary,
  NON-REFUNDABLE donation** policy must be published and linked from the card/checkout before
  live mode. This gates *going live*, not building/testing (test mode needs no activation).
- Live webhook endpoint + `STRIPE_WEBHOOK_SECRET` are per-mode — set both test and live secrets
  when the webhook work lands (distinct signing secrets per endpoint).

## Open questions for the owner

1. **Payment Links vs going straight to `/api/checkout`?** Links ship ~1 day sooner; the
   Function is needed for subscriptions regardless. (Recommended: Links now, Function later.)
2. **Is "$50/year" truly recurring?** A recurring donation is a Stripe *subscription* (Customer,
   renewal emails, cancellation surface — portal or support email). A one-time "$50 covers a
   year" donation avoids all of that for the MVP. Recommend deciding before creating the Price.
3. **Fixed tiers vs "customer chooses price"?** Stripe's pay-what-you-want model fits donations
   (preset $25/$50 + custom amount) but can't mix with recurring on one link.
4. **Success UX:** redirect back to `/?donated=1` toast vs a dedicated `/thanks` page (new HTML
   entry → vite.config + sitemap + SSG list churn). Recommend the query-param toast first.
5. **Supporter recognition (card promises "planned"):** needs the webhook to *record* verified
   donations (KV) — build with the webhook skeleton, or drop the bullet until then?
6. **Reinstate the app-header Donate button** (F24/A125 pattern, retired at CH16) pointing at
   the same links?

## Proposed backlog items

- **F38 (P2, small)** — Donations MVP: create test-mode Payment Links ($25 one-time; $50/yr
  pending Q2) and wire the Home.svelte "Back the project" card CTAs (new tab, `rel="noopener
  noreferrer"`, explicit styling — no preflight); e2e asserts target + rel; swap to live links
  at launch. *Live cutover blocked on F18/entity.*
- **CH37 (P2, small)** — Stripe account setup: business profile (entity — blocked on R7
  decision), test+live keys, Products/Prices, Billing Portal config; record dashboard state in
  `functions/README.md`; set `STRIPE_*` env in the Pages dashboard (server-only).
- **F39 (P3, medium)** — Implement `POST /api/checkout` (Checkout Session via Stripe REST
  fetch; plan→`env.STRIPE_PRICE_*` mapping server-side per S13; full-redirect, no Stripe.js);
  unit test the mapping; keep CSP untouched.
- **F40 (P3, small)** — `/api/webhook` event-switch skeleton: after the existing S11
  verification, recognize + dedupe (event.id) the checkout/subscription/invoice events, record
  verified donations to KV (supporter recognition seed), ACK 200; **provision nothing**.
- **A220 (P3, small)** — Reinstate the app-header Donate button (F24/A125 new-tab pattern) on
  app+staging (demo-safe: external link, no writes), pointing at the F38 links.
- **(existing) F18 / A202 / A16** — unchanged; F18+A202 gate live mode, A16 gates the paid
  sync tier. Subscription *provisioning* work stays unfiled until accounts + CloudStore exist.
