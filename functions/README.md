# Pages Functions — accounts, payments, storage tiers (scaffold)

> **Status: scaffold only.** None of this is wired into the app yet. These
> files exist so the architecture is in place before accounts/payments are
> built. The app today is 100% local (IndexedDB) and ships no account UI.

Cloudflare Pages serves everything under `/functions/*` as edge functions
(Workers). They're the thin server layer the app will use for the things that
*can't* be client-side: authentication, billing entitlements, and (for the
subscription tier) cloud-hosted storage.

## Storage tiers

| Tier    | How it's bought          | Where trade data lives         | Status   |
|---------|--------------------------|--------------------------------|----------|
| `local` | one-time payment         | IndexedDB (this browser only)  | shipped  |
| `cloud` | recurring subscription   | IndexedDB **+** server storage | planned  |

The client never branches on the tier when reading/writing data — it goes
through `Store` (`app/store.js`). A future `CloudStore` implementing the same
interface gets selected by `Entitlements.storeFor()` (`app/entitlements.js`),
so adding the cloud tier does not touch the rest of the app.

## Account provisioning flow (planned, à la gwtrade.app)

1. User pays on a Stripe Checkout / Payment Link.
2. Stripe fires a webhook to `POST /api/webhook`.
3. The webhook verifies the signature and provisions the account + entitlement
   (one-time -> `local`, subscription -> `cloud`), persisted in **D1** or **KV**.
4. The app calls `GET /api/me` to learn the signed-in user's tier and picks the
   matching `Store` implementation.

## Endpoints (stubs)

- `functions/api/checkout.js` — create a Stripe Checkout session. **Stub.**
- `functions/api/webhook.js`  — receive + verify Stripe webhooks, provision
  accounts/entitlements. **Stub.**
- `functions/api/me.js`       — return the current user's storage tier. **Stub** that
  returns `{ tier: "local", cloudSync: false }` so `Entitlements.current()` has something to call.

## Public endpoints (shipped)

Live today; no auth required:

- `functions/api/geo.js` — returns the visitor's coarse region from Cloudflare edge metadata
  (`{ country, region, regionCode }`) to pre-fill the tax state. No IP lookup, no third-party
  service, nothing stored.
- `GET /api/status` — the homepage "Live" indicator (`{ mode, label, updatedAt }`). The **POST**
  is admin-only (see below).
- `GET /api/config` — feature flags the app reads at boot (no secrets). The **POST** is admin-only.

## Admin auth (shipped)

`/api/admin-key`, `/api/status`, `/api/config`, and the staging gate
(`_middleware.js`) share `_lib/auth.js`:

- **Short-lived tokens (S3).** `/api/admin-key` returns a signed HMAC token
  (not the raw key); the admin page stores and sends the *token*. The raw
  `ADMIN_KEY` never reaches the browser, but is still accepted server-side as a
  fallback. Tokens expire (`ADMIN_TOKEN_TTL_SEC`, default 2h).
- **Access JWT verification (S4).** When `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` are
  set, `/api/admin-key` verifies the `Cf-Access-Jwt-Assertion` signature against
  the team JWKS (cached 1h) + audience/issuer/expiry before issuing a token.
  Unset → falls back to requiring the header's presence (route is still behind
  Access + the middleware gate).

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

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` — once set, `/api/webhook` verifies the `Stripe-Signature` over the
  raw body (HMAC-SHA256, 5-min replay window) and rejects forgeries with 400 (S13). Until the
  secret is set the endpoint fails closed (501) and never acts on an event.
- `STRIPE_PRICE_ONE_TIME`, `STRIPE_PRICE_SUBSCRIPTION`

## Bindings to add when implementing

- **D1** (`DB`) or **KV** (`ACCOUNTS`) for accounts + entitlements.
- **R2** for the subscription tier's stored trade blobs (optionally encrypted
  client-side to preserve the "your data stays yours" guarantee).
