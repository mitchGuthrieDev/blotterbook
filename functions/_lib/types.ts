/* Shared types for the Pages Functions (A78). Env declares the bindings/secrets set in the
   Cloudflare Pages dashboard (all optional — the handlers fail closed/soft when one is unset).
   Ctx is the EventContext shape Pages passes to onRequest handlers. KVNamespace/EventContext
   come from @cloudflare/workers-types. */
export interface Env {
  STATUS_KV?: KVNamespace;
  /** D1 database for accounts (F53) — users/credentials/sessions/challenges (see functions/schema.sql).
   *  Unbound → every /api/account/* endpoint fails closed with a 503 JSON body (never a crash).
   *  Guardrail S25: identity + entitlements only — no trade data is ever stored here. */
  ACCOUNTS_DB?: D1Database;
  /** R2 bucket for the synced-workspaces encrypted-record ciphertext blobs (F62). Holds ONLY opaque
   *  AES-GCM ciphertext (F61a EncryptedRecord) keyed by workspace_id + blinded_id — never a symbol,
   *  P&L, note, tag, screenshot, or workspace name (guardrail S25). Unbound → every /api/sync/*
   *  endpoint fails closed with a 503 JSON body (never a crash). D1's change-index rows point at
   *  these objects via ciphertext_ref. */
  SYNC_BUCKET?: R2Bucket;
  /** Optional WebAuthn relying-party overrides — default to the request URL's hostname/origin.
   *  Set RP_ID to the apex domain (e.g. `blotterbook.com`) if passkeys must span subdomains. */
  RP_ID?: string;
  RP_ORIGIN?: string;
  ADMIN_KEY?: string;
  TOKEN_SECRET?: string;
  ADMIN_TOKEN_TTL_SEC?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_PRESENCE_AUTH?: string;
  ADMIN_DEBUG?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ONE_TIME?: string;
  STRIPE_PRICE_SUBSCRIPTION?: string;
  /** Resend API key for the F55 transactional emails (verify + recovery magic link). Unbound →
   *  the email endpoints fail closed with 503 { error: 'email unavailable' } (never a crash). */
  RESEND_API_KEY?: string;
  /** From address for F55 emails (e.g. `Blotterbook <no-reply@blotterbook.com>`). Optional —
   *  falls back to a sensible default when unset. */
  EMAIL_FROM?: string;
  /** Shared secret the changelog-email send trigger (.github/workflows/changelog-email.yml) presents
   *  to POST /api/notify-changelog (constant-time compared — F44). Unbound → the endpoint is disabled
   *  (503), so no one can trigger a broadcast on a deploy that isn't wired for it. */
  CHANGELOG_NOTIFY_SECRET?: string;
  /** Cloudflare Turnstile secret for the changelog signup form's abuse control (F44). Unbound →
   *  Turnstile is skipped entirely (defense-in-depth only, S22 — the double opt-in + confirmed-only
   *  send rule are the real invariants, never this). */
  TURNSTILE_SECRET?: string;
  /** Canonical user-facing origin (e.g. `https://blotterbook.com`), A315. The changelog-email send
   *  trigger invokes /api/notify-changelog at the bare `<project>.pages.dev` origin (that hostname is
   *  Cloudflare's own zone, so custom-domain Bot Fight Mode doesn't challenge the runner) — without
   *  this override, links built from the request origin would leak the pages.dev host into a
   *  subscriber's inbox. Set on the `blotterbook.com` Pages env so user-facing links (currently: the
   *  unsubscribe URL) stay branded regardless of which origin invoked the Function. Unset → falls back
   *  to the request origin (unchanged behavior). */
  PUBLIC_ORIGIN?: string;
}

export type Ctx = EventContext<Env, string, Record<string, unknown>>;
