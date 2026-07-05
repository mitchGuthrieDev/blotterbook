-- Blotterbook accounts — D1 schema (Accounts Phase 1, F53; architecture: docs/accounts-architecture.md).
-- Guardrail S25: identity + entitlements ONLY — no trade data ever lands in these tables.
--
-- Apply it with wrangler (one-time setup; see also functions/README.md):
--
--   npx wrangler d1 create blotterbook-accounts
--   npx wrangler d1 execute blotterbook-accounts --remote --file=functions/schema.sql
--
-- then bind the database to the Pages project as **ACCOUNTS_DB**
-- (Pages dashboard → Settings → Functions → D1 database bindings → variable name `ACCOUNTS_DB`).
-- Every /api/account/* endpoint fails closed with a 503 JSON body until the binding exists.
--
-- Phase 2 (F54) adds the `donations` table + Phase 3 (F55) `recovery_tokens` — not created yet.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                        -- crypto.randomUUID()
  email TEXT UNIQUE NOT NULL,                 -- lowercased; recovery + donation linkage
  email_verified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,                -- ms epoch
  donated_at INTEGER,                         -- first verified donation (NULL = none; F54 sets it)
  donation_total_cents INTEGER DEFAULT 0,
  stripe_customer_id TEXT                     -- set by the webhook when known (F54)
);

CREATE TABLE IF NOT EXISTS credentials (      -- one row per passkey
  id TEXT PRIMARY KEY,                        -- base64url credential ID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,                   -- base64url-encoded COSE public key
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                            -- JSON array of AuthenticatorTransport strings
  aaguid TEXT,                                -- authenticator model (→ "iCloud Keychain" nickname later)
  backed_up INTEGER,                          -- multi-device credential synced to a cloud keychain
  nickname TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials (user_id);

-- Sessions: opaque cookie token `id.secret` — only SHA-256(secret) is stored, so a DB leak
-- never yields a usable session token. Sliding 30-day expiry (expires_at extended on use).
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                        -- random public half of the token (lookup key)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,                  -- base64url(SHA-256(secret half))
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- Pending WebAuthn ceremonies — SINGLE-USE (deleted on first lookup) + short TTL (~5 min).
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                         -- 'register' | 'login'
  user_id TEXT,                               -- set when an authed user adds another passkey
  email TEXT,                                 -- pending registration email (server-held, not re-trusted from the client)
  challenge TEXT NOT NULL,                    -- the base64url challenge the authenticator must sign
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_challenge ON challenges (challenge);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges (expires_at);
