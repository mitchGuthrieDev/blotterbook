# Cloudflare Pages Functions (edge API)

The edge layer: the staging gate middleware, the public/admin API endpoints, and the Stripe/accounts
scaffold — all TypeScript functions pinned at the repo root and deployed automatically by Pages.

**Source of truth:** [`functions/_middleware.ts`](../../functions/_middleware.ts) ·
[`functions/api/`](../../functions/api/) · [`functions/_lib/`](../../functions/_lib/) ·
[`functions/README.md`](../../functions/README.md).

```mermaid
flowchart TD
    REQ["Browser / fetch"] --> MW["_middleware.ts"]
    MW --> GATE{"path == /app/staging.html ?"}
    GATE -->|"yes"| AUTH{"valid admin token /<br/>ADMIN_KEY / bb_staging cookie ?"}
    AUTH -->|"valid"| PASS["serve staging shell"]
    AUTH -->|"invalid (or creds unset*)"| B403["403 — fail closed"]
    GATE -->|"no"| ROUTES

    subgraph ROUTES["functions/api/*"]
        direction TB
        GEO["GET /api/geo<br/>coarse region from request.cf · public 30m"]
        STAT["/api/status<br/>GET public 30s · POST admin → STATUS_KV"]
        CFG["/api/config<br/>GET flags public 60s · POST admin → STATUS_KV"]
        AK["GET /api/admin-key<br/>Cf-Access JWT (S4) → short-lived token"]
        ME["GET /api/me → {tier:'local'} · scaffold"]
        CO["POST /api/checkout → 501 · Stripe scaffold"]
        WH["POST /api/webhook → verify HMAC → 501 · Stripe scaffold"]
    end

    subgraph LIB["functions/_lib/"]
        AUTHL["auth.ts — issue/verify token · JWKS cache · Stripe sig · const-time cmp"]
        HTTPL["http.ts — json · cachedJson · purgeCached · rateLimited"]
    end

    ROUTES --- LIB
    STAT -. "purge on POST" .-> KV[("STATUS_KV")]
    CFG -. "purge on POST" .-> KV
    STAT --- KV
    CFG --- KV
```

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/geo` | public | Visitor region (from `request.cf`) to pre-fill the tax-state selector |
| `GET/POST /api/status` | GET public · POST admin | Homepage "Live" indicator (KV-backed) |
| `GET/POST /api/config` | GET public · POST admin | Admin-managed feature flags read by the app at boot |
| `GET /api/admin-key` | Cloudflare Access JWT | Issue a short-lived signed admin token (S3/S4) |
| `GET /api/me` | public | Storage tier — always `{tier:'local'}` (accounts scaffold) |
| `POST /api/checkout` | (future) | Stripe Checkout — returns `501 not_implemented` |
| `POST /api/webhook` | Stripe HMAC | Stripe webhook — verifies signature, returns `501` |

## Notes

- **Staging gate fails closed.** If `ADMIN_KEY`/`TOKEN_SECRET` is configured, an invalid credential
  gets `403`; if neither is set, it *also* blocks (403) unless `ALLOW_PRESENCE_AUTH=1` (local/preview
  only) — a misconfigured deploy can't accidentally expose staging. (*the "unset" case.)
- **Defense in depth:** admin writes are rate-limited (fixed-window, KV-backed) and edge-cache entries
  are purged immediately on POST. `admin-key` verifies the Access JWT against the team JWKS when
  `ACCESS_TEAM_DOMAIN`+`ACCESS_AUD` are set (S4).
- **Stripe/accounts is scaffold only** — `checkout`/`webhook`/`me` return placeholders; the live
  storage tier (a `CloudStore` behind the same `Store` seam) is future work.
- Functions **fail soft** when `STATUS_KV` is unbound (GET falls back to defaults; admin POST → 500).
