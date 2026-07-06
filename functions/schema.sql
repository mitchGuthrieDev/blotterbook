-- Blotterbook accounts — D1 schema (Accounts Phase 1 F53 + Phase 2 F54 + Phase 3 F55;
-- architecture: docs/accounts-architecture.md). Also hosts the F44 changelog-email list (below).
-- Guardrail S25: identity + entitlements (+ changelog-email addresses) ONLY — no trade data ever
-- lands in these tables.
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
-- ⚠ RE-RUN REQUIRED: every table below uses `CREATE TABLE IF NOT EXISTS`, so this file is
-- idempotent — after ANY change here (F54 added `donations`, F55 added `recovery_tokens`, F44 added
-- `subscribers` + `changelog_sends`), the owner MUST re-run the
-- `wrangler d1 execute ... --file=functions/schema.sql` command above against the bound database so
-- the new tables exist in prod. Existing rows are untouched.

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

-- Donations (Accounts Phase 2 — F54). ONE row per Stripe `checkout.session.completed` event,
-- keyed by the Stripe EVENT ID so a replayed/duplicated webhook is a no-op (INSERT collides on
-- the PK → dedupe for free, S11). A donation is either credited immediately (client_reference_id
-- from /api/checkout, or an already-VERIFIED matching email) or stored UNCLAIMED (user_id NULL)
-- keyed by the lowercased checkout email, then claimed later when that email is verified (F55).
-- S25: identity + payment metadata only — never any trade data.
CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,                        -- Stripe event id ⇒ replay-safe dedupe (S11)
  user_id TEXT,                               -- NULL until claimed by a VERIFIED matching email
  email TEXT,                                 -- lowercased checkout email (the claim key)
  amount_cents INTEGER,
  currency TEXT,
  stripe_customer_id TEXT,                    -- copied onto users.stripe_customer_id when credited
  created_at INTEGER NOT NULL,                -- ms epoch (when the webhook processed it)
  claimed_at INTEGER                          -- when it was credited to a user (NULL = unclaimed)
);
CREATE INDEX IF NOT EXISTS idx_donations_email ON donations (email);
CREATE INDEX IF NOT EXISTS idx_donations_user ON donations (user_id);

-- Recovery / verification tokens (Accounts Phase 3 — F55). The emailed link carries an opaque
-- `id.secret` pair; only SHA-256(secret) is stored (same posture as sessions — a D1 leak never
-- yields a usable token). SINGLE-USE (used_at stamped on consume) + short TTL (~15 min).
--   purpose 'verify'  → confirm ownership of users.email (sets users.email_verified = 1)
--   purpose 'recover' → magic-link passkey RE-enrollment (issues fresh WebAuthn register options)
CREATE TABLE IF NOT EXISTS recovery_tokens (
  id TEXT PRIMARY KEY,                        -- random public half of the token (lookup key)
  user_id TEXT,                               -- nullable; set for both purposes today
  email TEXT NOT NULL,                        -- lowercased target email
  purpose TEXT NOT NULL,                      -- 'verify' | 'recover'
  token_hash TEXT NOT NULL,                   -- base64url(SHA-256(secret half)) — secret never stored
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER                             -- single-use: set on first successful consume
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_expires ON recovery_tokens (expires_at);

-- Changelog (Blotterlog) email subscriptions (F44 — docs/changelog-email-a141.md). Double opt-in
-- list + a per-version send ledger for idempotency. The confirm + unsubscribe links carry an opaque
-- `id.secret` pair; only SHA-256(secret) is stored (same posture as sessions/recovery — a D1 leak
-- never yields a usable link). Plaintext email is REQUIRED to send, so it is stored as-is; the table
-- is single-purpose, raw addresses are never logged (hash in logs), and unsubscribe HARD-DELETES.
-- Guardrail S25/A141: email + changelog content ONLY — never any trade/journal data.
CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,                        -- randomB64u(16) — public lookup half of both link tokens
  email TEXT UNIQUE NOT NULL,                 -- lowercased; required plaintext to send
  status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'confirmed' (only confirmed rows are ever mailed)
  confirm_token_hash TEXT,                    -- base64url(SHA-256(secret)) for the confirm link; cleared on confirm
  unsub_token_hash TEXT NOT NULL,             -- base64url(SHA-256(secret)) for one-click unsubscribe (stable per row)
  created_at INTEGER NOT NULL,                -- ms epoch (signup) — pending rows > 7 days are purged
  confirmed_at INTEGER,                       -- when pending → confirmed (the consent record)
  last_sent_at INTEGER                        -- per-address cooldown on confirm-mail re-sends (abuse control, S22)
);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers (status);

-- One row per changelog version already emailed → the send trigger is idempotent (a re-run, or a
-- second push touching changelog.json, never double-sends a release). Keyed by the prod version.
CREATE TABLE IF NOT EXISTS changelog_sends (
  version TEXT PRIMARY KEY,                   -- changelog release version that was mailed
  sent_at INTEGER NOT NULL,
  recipient_count INTEGER                     -- confirmed recipients at send time (0 is still recorded)
);

-- Subscriptions (Synced Workspaces Step 3 — F60). ONE current subscription per user (PK = user_id),
-- kept in sync by the F54 webhook's subscription-lifecycle handlers (customer.subscription.created/
-- updated/deleted + invoice.payment_failed). /api/me reads this to grant the `cloud` storage tier per
-- the LOCKED lapse policy (docs/synced-workspaces.md — period-end + grace): active/trialing, OR
-- past_due within a dunning grace window (measured from `updated`), OR still inside the paid period
-- after a cancel (now < current_period_end). S25: billing metadata only — never any trade data.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, -- the account's current subscription
  stripe_subscription_id TEXT,               -- Stripe subscription id (resolves lifecycle events)
  stripe_customer_id TEXT,                    -- Stripe customer id (resolves events lacking a ref)
  status TEXT,                               -- Stripe status: active|trialing|past_due|canceled|unpaid|…
  current_period_end INTEGER,                -- ms epoch — the paid period end (Stripe sends SECONDS; the webhook converts)
  updated INTEGER NOT NULL                    -- ms epoch of the last webhook update (past_due grace counts from here)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (stripe_customer_id);

-- Processed-webhook-event ledger (F60) — replay-safe dedupe for the subscription-lifecycle events,
-- keyed by the Stripe EVENT id (the donation path dedupes via the donations PK the same way). A
-- retried/duplicated delivery collides here and is a no-op.
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,                        -- Stripe event id
  type TEXT,                                  -- the event type processed
  created_at INTEGER NOT NULL                 -- ms epoch (when the webhook processed it)
);

-- ── Synced workspaces — the DUMB encrypted-blob transport (F62; docs/synced-workspaces.md) ─────────
-- Guardrail S25: these tables + the SYNC_BUCKET R2 objects hold ONLY ciphertext, blinded ids, wrapped
-- (un-unwrappable) key blobs, and timestamps/sizes/seq cursors. The server holds no key and never
-- decrypts — it can NEVER read a symbol, P&L, note, tag, screenshot, or workspace name. Every
-- /api/sync/* route is session-gated, Origin-checked on mutations, and fails closed (503) without
-- ACCOUNTS_DB / SYNC_BUCKET. Every workspace access is authorized to its owner_user_id.

-- The workspace's server identity + ownership. workspace_id is the client's F59 UUID; the NAME lives
-- ENCRYPTED as a sync_records row (type 'workspace-name'), never in plaintext here.
CREATE TABLE IF NOT EXISTS sync_workspaces (
  workspace_id TEXT PRIMARY KEY,             -- client-generated F59 UUID
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL                 -- ms epoch
);
CREATE INDEX IF NOT EXISTS idx_sync_workspaces_owner ON sync_workspaces (owner_user_id);

-- The per-workspace DEK wrapped (AES-KW) under the account IK (F61a WrappedDek JSON). Opaque ciphertext
-- of a key the server cannot unwrap — the client unwraps it in memory to en/decrypt that workspace's records.
CREATE TABLE IF NOT EXISTS sync_workspace_keys (
  workspace_id TEXT PRIMARY KEY REFERENCES sync_workspaces(workspace_id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,               -- denormalized for a fast owner check
  wrapped_dek TEXT NOT NULL,                 -- F61a WrappedDek JSON (AES-KW under the account IK)
  updated INTEGER NOT NULL                    -- ms epoch of the last write
);

-- The account IDENTITY KEY (IK) wrapped once per UNLOCK METHOD (F61a WrappedIK JSON). method is
-- 'passkey' | 'passphrase' | 'recovery' (opaque to the server); key_id selects the credential/derivation.
-- Opaque ciphertext of a key the server cannot unwrap.
CREATE TABLE IF NOT EXISTS sync_wrapped_ik (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,                       -- passkey | passphrase | recovery
  key_id TEXT NOT NULL,                       -- which credential / derivation this blob is for
  wrapped_ik TEXT NOT NULL,                   -- F61a WrappedIK JSON (AES-KW under the per-method KEK)
  updated INTEGER NOT NULL,
  PRIMARY KEY (user_id, method, key_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_wrapped_ik_user ON sync_wrapped_ik (user_id);

-- The change-index: one row per encrypted record (trade/journal/meta/…/workspace-name). blinded_id =
-- HMAC(workspaceKey, tradeId) — NEVER the raw content hash (exposing it would let the store confirm a
-- guessed trade). seq is a monotonic per-workspace cursor for incremental pull. The ciphertext blob
-- itself lives in R2 (SYNC_BUCKET) at ciphertext_ref — large records (encrypted screenshots) never sit
-- in a D1 row. deleted flags a tombstone (the delete half of LWW). Upsert is LWW by `updated`.
CREATE TABLE IF NOT EXISTS sync_records (
  workspace_id TEXT NOT NULL,                 -- REFERENCES sync_workspaces(workspace_id) — authorized per request
  blinded_id TEXT NOT NULL,                   -- HMAC(workspaceKey, tradeId), never the raw hash (S25)
  seq INTEGER NOT NULL,                       -- monotonic per-workspace sequence (pull cursor)
  type TEXT NOT NULL,                         -- opaque record-kind label (never inspected)
  ciphertext_ref TEXT NOT NULL,              -- R2 object key holding the AES-GCM EncryptedRecord blob
  updated INTEGER NOT NULL,                   -- LWW clock (writing client's wall clock, ms)
  deleted INTEGER NOT NULL DEFAULT 0,         -- 1 = tombstone
  PRIMARY KEY (workspace_id, blinded_id)      -- idempotent upsert/dedup per record
);
CREATE INDEX IF NOT EXISTS idx_sync_records_seq ON sync_records (workspace_id, seq);
