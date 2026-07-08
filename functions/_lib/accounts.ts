/* Shared account helpers for the passkey endpoints (Accounts Phase 1 — F53).
   Architecture: docs/accounts-architecture.md. Schema: functions/schema.sql (D1, bound as ACCOUNTS_DB).

   Sessions — Lucia-successor recipe: the cookie value is an opaque `id.secret` pair; only
   SHA-256(secret) is stored (a D1 leak never yields a usable token). `__Host-` prefix +
   HttpOnly + Secure + SameSite=Lax; 30-day sliding expiry. Revocation = delete the row.

   CSRF posture: SameSite=Lax plus an explicit Origin check (checkOrigin) on every mutating
   /api/account/* route — all POSTs are same-origin JSON, so no token dance is needed.

   Fail-closed: every endpoint calls getDb() and returns dbUnavailable() (503 JSON) when the
   ACCOUNTS_DB binding is missing — never a crash, never a silent success.

   GUARDRAIL (S25): these tables hold identity + entitlements ONLY. Nothing about trades is
   ever sent to or stored on the server. Rate limiting (http.ts rateLimited) is defense-in-depth
   only — auth correctness NEVER depends on it (S22).

   This module only exports helpers (no onRequest), so it is never served as a route. */

import type { Env } from './types.ts';
import { json } from './http.ts';

export const SESSION_COOKIE = '__Host-bb_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30-day sliding window
// A302: hard ABSOLUTE cap measured from created_at. The sliding TTL alone lets an exfiltrated cookie
// live forever if used at least monthly (each use + each /api/me probe re-issues Max-Age). This ceiling
// forces re-authentication (a fresh passkey ceremony) after 90 days no matter how often it's used.
export const SESSION_ABSOLUTE_MAX_MS = 90 * 24 * 3600 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000; // pending WebAuthn ceremonies live ~5 min
export const RECOVERY_TTL_MS = 15 * 60 * 1000; // verify / recovery magic-link tokens live ~15 min (F55)

/** Shared email shape check — the ONE regex the account layer validates emails with. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---- narrow D1 seam ----------------------------------------------------------------------
   The subset of D1Database the account helpers use. D1Database satisfies it structurally;
   scripts/test-accounts.mjs substitutes an in-memory mock implementing the same shape. */
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}
export interface AccountsDb {
  prepare(sql: string): DbStatement;
}

export function getDb(env: Env): AccountsDb | null {
  return env.ACCOUNTS_DB ?? null;
}

/** 503 body for an unbound ACCOUNTS_DB — accounts fail CLOSED, with a clear reason. */
export function dbUnavailable() {
  return json({ error: 'Accounts are not available: the ACCOUNTS_DB D1 binding is not configured on this deployment.' }, 503);
}

/* ---- row shapes (mirror functions/schema.sql) -------------------------------------------- */
export interface UserRow {
  id: string;
  email: string;
  email_verified: number;
  created_at: number;
  donated_at: number | null;
  donation_total_cents: number | null;
  stripe_customer_id: string | null;
}
export interface CredentialRow {
  id: string;
  user_id: string;
  public_key: string; // base64url COSE key
  counter: number;
  transports: string | null; // JSON array
  aaguid: string | null;
  backed_up: number | null;
  user_verified: number | null; // 1 = UV performed at enrollment (A310)
  nickname: string | null;
  created_at: number;
  last_used_at: number | null;
}
export interface SessionRow {
  id: string;
  user_id: string;
  secret_hash: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number | null;
}
export interface ChallengeRow {
  id: string;
  type: string;
  user_id: string | null;
  email: string | null;
  challenge: string;
  recovery: number | null; // 1 = recovery-originated register challenge (A302)
  expires_at: number;
}
export interface DonationRow {
  id: string; // Stripe event id
  user_id: string | null;
  email: string | null;
  amount_cents: number | null;
  currency: string | null;
  stripe_customer_id: string | null;
  created_at: number;
  claimed_at: number | null;
}
export interface RecoveryTokenRow {
  id: string;
  user_id: string | null;
  email: string;
  purpose: string; // 'verify' | 'recover' | 'reclaim'
  token_hash: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}
export interface OverrideRow {
  user_id: string; // PK — one manual entitlement override per user (A276)
  tier: string; // 'cloud' (the only tier granted for now)
  expires_at: number | null; // ms epoch; NULL = permanent
  reason: string | null; // free-text note
  granted_by: string; // Access-authenticated admin email
  granted_at: number; // ms epoch
  revoked_at: number | null; // ms epoch when revoked (NULL = active) — the row is KEPT as the audit trail
  revoked_by: string | null; // admin email that revoked it
}
export interface SubscriptionRow {
  user_id: string; // PK — the account's single current subscription
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: string | null; // Stripe status: active|trialing|past_due|canceled|unpaid|…
  current_period_end: number | null; // ms epoch (Stripe seconds converted at the webhook boundary)
  updated: number; // ms epoch of the last webhook update
  past_due_since: number | null; // ms epoch of the FIRST failure of the current past_due run (grace base; NULL when not past_due — A266)
  last_event_created: number | null; // Stripe event.created (SECONDS) of the last APPLIED lifecycle event (out-of-order guard — A303)
  cancel_at_period_end: number | null; // 1 = cancellation scheduled at period end (A333 self-serve cancel; still `active` until then)
}

/* ---- encoding / crypto -------------------------------------------------------------------- */
const enc = new TextEncoder();

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uToBytes(str: string): Uint8Array<ArrayBuffer> {
  const pad = '==='.slice((str.length + 3) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomB64u(byteLen = 32): string {
  return b64u(crypto.getRandomValues(new Uint8Array(byteLen)));
}

export async function sha256b64u(text: string): Promise<string> {
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/* Constant-time compare for the fixed-length session-secret hashes. */
function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---- request plumbing ---------------------------------------------------------------------- */

/** Origin check for mutating routes: the Origin header must be present and match the request's
 *  own origin (all account POSTs are same-origin fetches from the app). Fail-closed. */
export function checkOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch (_) {
    return false;
  }
}
export function badOrigin() {
  return json({ error: 'Cross-origin request rejected.' }, 403);
}

/** WebAuthn relying-party identity — defaults derived from the request URL; RP_ID/RP_ORIGIN
 *  env vars override (e.g. apex-domain passkeys spanning subdomains). */
export function rpFrom(request: Request, env: Env) {
  const url = new URL(request.url);
  return { rpID: env.RP_ID || url.hostname, origin: env.RP_ORIGIN || url.origin, rpName: 'Blotterbook' };
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch (_) {
    return null;
  }
}

/** Extract the base64url challenge a WebAuthn response was signed over (from its own
 *  clientDataJSON), so the server can find + consume the matching pending-challenge row
 *  without the client re-sending any extra state. */
export function challengeFromClientData(clientDataJSON: unknown): string | null {
  if (typeof clientDataJSON !== 'string' || !clientDataJSON) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64uToBytes(clientDataJSON))) as { challenge?: unknown };
    return typeof data.challenge === 'string' && data.challenge ? data.challenge : null;
  } catch (_) {
    return null;
  }
}

/* ---- sessions ------------------------------------------------------------------------------- */

/** Create a session row and return the cookie token (`id.secret`). Only SHA-256(secret) persists. */
export async function createSession(db: AccountsDb, userId: string, now = Date.now()) {
  const id = randomB64u(16);
  const secret = randomB64u(32);
  const expiresAt = now + SESSION_TTL_MS;
  await db
    .prepare('INSERT INTO sessions (id, user_id, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, userId, await sha256b64u(secret), now, expiresAt)
    .run();
  return { token: `${id}.${secret}`, expiresAt };
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** Resolve the request's session cookie to a live session row (hash-compared, unexpired),
 *  sliding the expiry forward on use. Returns null for missing/garbage/expired/mismatched
 *  tokens; expired rows are deleted opportunistically. */
export async function sessionFromRequest(request: Request, db: AccountsDb, now = Date.now()): Promise<SessionRow | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  const row = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<SessionRow>();
  if (!row) return null;
  // Expired by the sliding TTL, OR past the A302 absolute cap from created_at — either way it's dead.
  // (created_at can be null on legacy rows written before the column existed → the cap is skipped.)
  const pastAbsoluteCap = row.created_at != null && now >= row.created_at + SESSION_ABSOLUTE_MAX_MS;
  if (row.expires_at <= now || pastAbsoluteCap) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  if (!hashesEqual(await sha256b64u(secret), row.secret_hash)) return null;
  const expiresAt = now + SESSION_TTL_MS; // sliding window
  await db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?').bind(expiresAt, now, id).run();
  return { ...row, expires_at: expiresAt, last_seen_at: now };
}

/** Delete the session row named by the request's cookie (logout). No-op on a bad token.
 *
 * DECISION (A310): this deletes by session id WITHOUT verifying the cookie's secret. That is
 * intentional and safe — this is a REVOCATION-ONLY primitive, never an authentication one. The worst
 * an attacker who guesses/knows only a session id (not the secret) can do is destroy that session,
 * i.e. log its owner out — a denial of convenience, never an escalation. It cannot read data, mint a
 * session, or authenticate as anyone (that path is sessionFromRequest, which DOES constant-time
 * compare the secret hash). Keeping it secret-free lets logout succeed even from a partially-corrupt
 * cookie. Do NOT reuse destroySession as an auth check. */
export async function destroySession(request: Request, db: AccountsDb): Promise<void> {
  const token = readSessionToken(request);
  const id = token?.split('.')[0];
  if (id) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

export function sessionSetCookie(token: string, maxAgeSec = Math.floor(SESSION_TTL_MS / 1000)): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/* ---- challenges (single-use + TTL — S25) ---------------------------------------------------- */

export async function putChallenge(
  db: AccountsDb,
  ch: { type: 'register' | 'login'; challenge: string; userId?: string | null; email?: string | null; recovery?: boolean },
  now = Date.now()
): Promise<void> {
  await db.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(now).run(); // opportunistic sweep
  await db
    .prepare('INSERT INTO challenges (id, type, user_id, email, challenge, recovery, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(randomB64u(16), ch.type, ch.userId ?? null, ch.email ?? null, ch.challenge, ch.recovery ? 1 : null, now + CHALLENGE_TTL_MS)
    .run();
}

/** Revoke ALL sessions for a user (A302) — used on recovery re-enrollment so a stolen device's
 *  sessions can't outlive a recovery, and available as a general "sign out everywhere" primitive. */
export async function deleteSessionsForUser(db: AccountsDb, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/** Delete a user and EVERY D1 row keyed to them (A305). Explicit child-row deletes — never relies on a
 *  D1 ON DELETE CASCADE (the foreign_keys pragma may be off, and live DBs predate the A305 FK migration),
 *  so this is correct with or without the FKs. The caller (/api/account/delete) MUST first clear the
 *  user's R2 ciphertext + sync_records via deleteWorkspacePage — a D1 delete can't reach R2. Workspace
 *  rows (sync_workspaces/sync_workspace_keys) are also dropped by owner here as a backstop in case a
 *  shell was orphaned. Ordered children-first. */
export async function deleteUserAccount(db: AccountsDb, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sync_wrapped_ik WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM sync_workspace_keys WHERE owner_user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM sync_workspaces WHERE owner_user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM subscriptions WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM entitlement_overrides WHERE user_id = ?').bind(userId).run(); // A276 — drop the override + its audit trail with the account
  await db.prepare('DELETE FROM credentials WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM donations WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM recovery_tokens WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM challenges WHERE user_id = ?').bind(userId).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}

/** Look up a pending challenge by its value + type and DELETE it (single-use — a second
 *  consume, or an expired row, returns null). */
export async function consumeChallenge(
  db: AccountsDb,
  challenge: string,
  type: 'register' | 'login',
  now = Date.now()
): Promise<ChallengeRow | null> {
  if (!challenge) return null;
  const row = await db.prepare('SELECT * FROM challenges WHERE challenge = ? AND type = ?').bind(challenge, type).first<ChallengeRow>();
  if (!row) return null;
  await db.prepare('DELETE FROM challenges WHERE id = ?').bind(row.id).run(); // single-use, even when expired
  return row.expires_at > now ? row : null;
}

/* ---- users + credentials -------------------------------------------------------------------- */

export async function userByEmail(db: AccountsDb, email: string) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
}
export async function userById(db: AccountsDb, id: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}
/** Create a user, race-safe (A310): the INSERT is `ON CONFLICT(email) DO NOTHING`, so a concurrent
 *  double-registration of the same email can't 500 on the UNIQUE constraint. Returns the created row,
 *  or `null` when the email was already taken (the caller maps that to a clean 409). */
export async function createUser(db: AccountsDb, email: string, now = Date.now()): Promise<UserRow | null> {
  const row: UserRow = {
    id: crypto.randomUUID(),
    email,
    email_verified: 0,
    created_at: now,
    donated_at: null,
    donation_total_cents: 0,
    stripe_customer_id: null,
  };
  const res = (await db
    .prepare('INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(row.id, row.email, 0, now)
    .run()) as { meta?: { changes?: number } } | undefined;
  // changes === 1 → we inserted; 0 → a concurrent registration already claimed this email → null
  // (the caller returns a clean 409 instead of an uncaught UNIQUE-constraint 500).
  return (res?.meta?.changes ?? 0) > 0 ? row : null;
}

export async function credentialById(db: AccountsDb, id: string) {
  return db.prepare('SELECT * FROM credentials WHERE id = ?').bind(id).first<CredentialRow>();
}
export async function credentialsForUser(db: AccountsDb, userId: string): Promise<CredentialRow[]> {
  const { results } = await db.prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at').bind(userId).all<CredentialRow>();
  return results;
}
/** Insert a passkey credential, race-safe (A310): `ON CONFLICT(id) DO NOTHING` so a concurrent
 *  double-verify of the same credential can't 500 on the PK. Returns `true` when THIS call inserted
 *  the row, `false` when a concurrent verify already registered it (the caller returns a clean 409).
 *  Persists `user_verified` (A310) — whether the authenticator performed UV at enrollment. */
export async function insertCredential(
  db: AccountsDb,
  c: {
    id: string;
    userId: string;
    publicKey: string;
    counter: number;
    transports: string[];
    aaguid: string | null;
    backedUp: boolean;
    userVerified: boolean;
  },
  now = Date.now()
): Promise<boolean> {
  const res = (await db
    .prepare(
      'INSERT INTO credentials (id, user_id, public_key, counter, transports, aaguid, backed_up, user_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING'
    )
    .bind(c.id, c.userId, c.publicKey, c.counter, JSON.stringify(c.transports), c.aaguid, c.backedUp ? 1 : 0, c.userVerified ? 1 : 0, now)
    .run()) as { meta?: { changes?: number } } | undefined;
  // changes === 1 → this call inserted; 0 → a concurrent verify already registered this credential id
  // (the caller returns a clean 409 instead of an uncaught PK-constraint 500).
  return (res?.meta?.changes ?? 0) > 0;
}
export async function touchCredential(db: AccountsDb, id: string, counter: number, now = Date.now()): Promise<void> {
  await db.prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?').bind(counter, now, id).run();
}

/** Delete a credential OWNED BY the given user (A302). Scoped by user_id so a caller can never delete
 *  another account's passkey. Returns the number of rows deleted (0 = not found / not theirs). */
export async function deleteCredentialForUser(db: AccountsDb, userId: string, id: string): Promise<number> {
  const res = (await db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').bind(id, userId).run()) as
    { meta?: { changes?: number } } | undefined;
  return res?.meta?.changes ?? 0;
}

export function parseTransports(text: string | null): string[] {
  try {
    const v: unknown = JSON.parse(text || '[]');
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch (_) {
    return [];
  }
}

export async function setEmailVerified(db: AccountsDb, userId: string): Promise<void> {
  await db.prepare('UPDATE users SET email_verified = ? WHERE id = ?').bind(1, userId).run();
}

// A310 — never-verified-account squatting mitigation. An anonymous registration binds ANY email with
// no proof of ownership (register-verify), yet recovery only emails VERIFIED addresses — so an attacker
// who registers victim@x first permanently blocks the real victim from BOTH signup (409) and recovery
// (silent no-send). This TTL is the age past which a never-verified account is considered an abandoned
// shell eligible for purge, freeing its email. 30 days is comfortably longer than the email-verify
// token TTL, so a real user who intends to verify has ample time.
export const UNVERIFIED_USER_TTL_MS = 30 * 24 * 3600 * 1000;

/** True when the user owns at least one sync workspace. Such an account's R2 ciphertext needs the
 *  PAGED account-delete cleanup (A305 — a D1 delete can never reach R2), so every purge/reclaim path
 *  below must skip workspace owners rather than orphan their blobs. */
export async function ownsSyncWorkspaces(db: AccountsDb, userId: string): Promise<boolean> {
  return !!(await db.prepare('SELECT * FROM sync_workspaces WHERE owner_user_id = ?').bind(userId).first());
}

/** A316: lazily free a TTL-expired, never-verified account at the registration collision point
 *  (register-options calls this when the requested email is already held). Deletes the squatter shell
 *  via {@link deleteUserAccount} (explicit child-row cleanup — never a bare cascade) and returns true
 *  when the email was freed. Returns false — leaving the 409 path to run — when the holder is
 *  verified, younger than the TTL, or owns sync workspaces (see {@link ownsSyncWorkspaces}). */
export async function maybeFreeExpiredUnverified(db: AccountsDb, user: UserRow, now = Date.now()): Promise<boolean> {
  if (user.email_verified) return false;
  if (user.created_at >= now - UNVERIFIED_USER_TTL_MS) return false;
  if (await ownsSyncWorkspaces(db, user.id)) return false;
  await deleteUserAccount(db, user.id);
  return true;
}

/**
 * Purge never-verified accounts older than {@link UNVERIFIED_USER_TTL_MS}, freeing their squatted
 * emails. Bounded (`limit`) so an admin sweep stays within the subrequest budget (A15) — each
 * deletion is an explicit {@link deleteUserAccount} (never a bare cascade), and workspace owners are
 * skipped (their R2 blobs need the A305 pager). Returns the number of users removed.
 *
 * A316: the squatting fix is wired LAZILY — register-options frees the one colliding account via
 * {@link maybeFreeExpiredUnverified} at the moment it matters, and the proven-ownership reclaim flow
 * (/api/account/reclaim-send + reclaim-confirm) covers the pre-TTL window. This bulk helper remains
 * for manual/admin sweeps only.
 */
export async function purgeUnverifiedUsers(db: AccountsDb, now = Date.now(), limit = 10): Promise<number> {
  const cutoff = now - UNVERIFIED_USER_TTL_MS;
  const { results } = await db
    .prepare('SELECT * FROM users WHERE email_verified = 0 AND created_at < ? LIMIT ?')
    .bind(cutoff, limit)
    .all<UserRow>();
  let removed = 0;
  for (const u of results) {
    if (await ownsSyncWorkspaces(db, u.id)) continue;
    await deleteUserAccount(db, u.id);
    removed++;
  }
  return removed;
}

/* ---- donations (Phase 2 — F54) --------------------------------------------------------------
   The donations table PK is the Stripe EVENT id, so a replayed webhook can never double-credit
   (donationById → skip). A donation is credited to a user immediately when linkage is trusted
   (client_reference_id, or an already-verified matching email); otherwise it sits UNCLAIMED and
   is swept onto the user by claimDonationsForUser() the moment that email is verified (F55). */

/** S26(3): the guard for whether a donation event actually credits a user's donor tally. The
 *  event is still RECORDED + linkage/dedupe still apply either way (insertDonation runs
 *  unconditionally, keyed by the Stripe event id) — this only gates the donated_at stamp /
 *  donation_total_cents accumulation in applyDonationToUser, so a $0 line item or a non-USD
 *  checkout (we only ever configure USD prices — S26) can't inflate a user's donor status. */
export function isCreditableDonation(amountCents: number, currency: string | null): boolean {
  return amountCents > 0 && typeof currency === 'string' && currency.toLowerCase() === 'usd';
}

export async function donationById(db: AccountsDb, id: string) {
  return db.prepare('SELECT * FROM donations WHERE id = ?').bind(id).first<DonationRow>();
}

export async function insertDonation(
  db: AccountsDb,
  d: {
    id: string;
    userId: string | null;
    email: string | null;
    amountCents: number;
    currency: string | null;
    stripeCustomerId: string | null;
    claimedAt: number | null;
  },
  now = Date.now()
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO donations (id, user_id, email, amount_cents, currency, stripe_customer_id, created_at, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(d.id, d.userId, d.email, d.amountCents, d.currency, d.stripeCustomerId, now, d.claimedAt)
    .run();
}

/** Add a credited amount to a user's donation tally. The FIRST credit stamps donated_at (kept
 *  stable on later credits); the Stripe customer id is recorded when known. Returns the updated row.
 *
 *  S26(3): only stamps donated_at / accumulates donation_total_cents when the amount+currency pass
 *  isCreditableDonation (amountCents > 0 AND currency is 'usd', case-insensitive) — a zero-amount
 *  or non-USD event still gets recorded (by the caller's insertDonation) and dedupes normally, it
 *  just doesn't move the donor tally. Not creditable → no-op, returns `user` unchanged. */
export async function applyDonationToUser(
  db: AccountsDb,
  user: UserRow,
  amountCents: number,
  currency: string | null,
  stripeCustomerId: string | null,
  now = Date.now()
): Promise<UserRow> {
  if (!isCreditableDonation(amountCents, currency)) return user;
  const donatedAt = user.donated_at ?? now;
  const total = (user.donation_total_cents ?? 0) + amountCents;
  const customer = stripeCustomerId ?? user.stripe_customer_id ?? null;
  await db
    .prepare('UPDATE users SET donated_at = ?, donation_total_cents = ?, stripe_customer_id = ? WHERE id = ?')
    .bind(donatedAt, total, customer, user.id)
    .run();
  return { ...user, donated_at: donatedAt, donation_total_cents: total, stripe_customer_id: customer };
}

/** Claim every UNCLAIMED donation keyed by this user's email onto the user (called once the email
 *  is verified — F55). Returns how many rows were credited. Never trusts an unverified email:
 *  callers must only invoke this for a user whose email ownership is proven.
 *
 *  S26(3): every unclaimed row is still linked to the user (user_id + claimed_at stamped) so it
 *  never lingers as "unclaimed" — applyDonationToUser separately decides whether it moves the
 *  tally, so a stale non-USD/zero-amount row gets swept up (stops re-scanning it) without ever
 *  crediting the user. */
export async function claimDonationsForUser(db: AccountsDb, user: UserRow, now = Date.now()): Promise<number> {
  const { results } = await db.prepare('SELECT * FROM donations WHERE email = ?').bind(user.email).all<DonationRow>();
  const unclaimed = results.filter(d => d.user_id == null);
  let u = user;
  let credited = 0;
  for (const d of unclaimed) {
    await db.prepare('UPDATE donations SET user_id = ?, claimed_at = ? WHERE id = ?').bind(user.id, now, d.id).run();
    u = await applyDonationToUser(db, u, d.amount_cents ?? 0, d.currency, d.stripe_customer_id, now);
    if (isCreditableDonation(d.amount_cents ?? 0, d.currency)) credited++;
  }
  return credited;
}

/* ---- subscriptions + webhook-event dedupe (Synced Workspaces Step 3 — F60) -------------------
   ONE current subscription per user (keyed by user_id). The webhook's subscription-lifecycle
   handlers upsert status + current_period_end here; /api/me + the /api/sync/* mutating routes read
   it (via grantsCloud) to grant the `cloud` tier per the locked period-end + grace lapse policy.
   S25: billing metadata only — never any trade data. */

// Dunning grace (F60): a past_due subscription keeps the cloud tier for this long after the FIRST
// failed-payment event of the current lapse (measured from `past_due_since`, NOT from `updated` —
// A266: `updated` is re-stamped on every Stripe retry, which would stretch the window to the whole
// retry span). A few days covers Stripe's retry cadence so a transient decline doesn't strand a payer.
export const SUBSCRIPTION_GRACE_MS = 3 * 24 * 3600 * 1000;

/**
 * The LOCKED lapse policy (docs/synced-workspaces.md — period-end + grace): grant `cloud` while the
 * subscription is active/trialing, OR past_due inside the dunning grace window, OR still inside the
 * paid period after a cancel (now < current_period_end). Otherwise the tier is `local` — the local
 * IndexedDB data always remains, only cloud sync stops. Shared by /api/me and the sync routes so the
 * server-side entitlement is the single source of truth (A253 — the client check is advisory only).
 */
export function grantsCloud(sub: SubscriptionRow | null, now: number): boolean {
  if (!sub) return false;
  if (sub.status === 'active' || sub.status === 'trialing') return true;
  // Grace runs from the first failure of this past_due run (A266 clamp); fall back to `updated` for
  // legacy rows written before past_due_since existed.
  if (sub.status === 'past_due' && now < (sub.past_due_since ?? sub.updated) + SUBSCRIPTION_GRACE_MS) return true;
  // Ride out the already-paid period ONLY after a clean cancel — a user who cancels keeps cloud until
  // the period they paid for ends. Do NOT extend this to past_due/unpaid: Stripe advances
  // current_period_end into the new (unpaid) period on a failed renewal, so an ungated fallback would
  // hand a delinquent account a free unpaid month and silently defeat the dunning grace above (A303).
  if (sub.status === 'canceled' && sub.current_period_end != null && now < sub.current_period_end) return true;
  return false;
}

export async function subscriptionForUser(db: AccountsDb, userId: string) {
  return db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').bind(userId).first<SubscriptionRow>();
}
export async function subscriptionByStripeId(db: AccountsDb, stripeSubscriptionId: string) {
  return db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').bind(stripeSubscriptionId).first<SubscriptionRow>();
}
export async function userByStripeCustomerId(db: AccountsDb, stripeCustomerId: string) {
  return db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').bind(stripeCustomerId).first<UserRow>();
}

/* ---- manual entitlement overrides (A276) — the admin comp/grant lever --------------------------
   An override hands the `cloud` tier to an account regardless of its subscription. hasCloudEntitlement()
   below is the SINGLE SOURCE OF TRUTH the entitlement consumers call (A277): /api/me and the /api/sync/*
   mutating routes grant `cloud` when EITHER a live override OR a paying subscription (grantsCloud) says
   so. Revoked overrides are KEPT — the revoked_at/revoked_by stamp is the audit trail. S25: entitlement
   metadata only. */

/** Pure predicate: is this override currently granting? Live = not revoked AND (permanent OR unexpired). */
export function overrideGrantsCloud(o: OverrideRow | null, now: number): boolean {
  if (!o) return false;
  if (o.revoked_at != null) return false;
  if (o.expires_at != null && now >= o.expires_at) return false;
  return true;
}

export async function subscriptionOverrideForUser(db: AccountsDb, userId: string) {
  return db.prepare('SELECT * FROM entitlement_overrides WHERE user_id = ?').bind(userId).first<OverrideRow>();
}

/** The ONE cloud-entitlement choke point (A277): true when the user has a LIVE manual override OR a
 *  subscription that grantsCloud(). Both /api/me and the sync routes resolve entitlement through here so
 *  a comp/grant and a paid subscription are honored identically and in one place. */
export async function hasCloudEntitlement(db: AccountsDb, userId: string, now = Date.now()): Promise<boolean> {
  if (overrideGrantsCloud(await subscriptionOverrideForUser(db, userId), now)) return true;
  return grantsCloud(await subscriptionForUser(db, userId), now);
}

/** Grant (or refresh) a user's entitlement override — upsert by user_id. On a refresh it updates
 *  tier/expires_at/reason/granted_by/granted_at AND CLEARS any prior revoked_at/revoked_by (re-granting
 *  a previously-revoked override reactivates it). tier defaults to 'cloud'. */
export async function grantEntitlementOverride(
  db: AccountsDb,
  o: { userId: string; tier?: string; expiresAt?: number | null; reason?: string | null; grantedBy: string },
  now = Date.now()
): Promise<void> {
  const tier = o.tier ?? 'cloud';
  await db
    .prepare(
      'INSERT INTO entitlement_overrides (user_id, tier, expires_at, reason, granted_by, granted_at, revoked_at, revoked_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET tier = ?, expires_at = ?, reason = ?, granted_by = ?, granted_at = ?, revoked_at = ?, revoked_by = ?'
    )
    .bind(
      o.userId,
      tier,
      o.expiresAt ?? null,
      o.reason ?? null,
      o.grantedBy,
      now,
      null,
      null,
      tier,
      o.expiresAt ?? null,
      o.reason ?? null,
      o.grantedBy,
      now,
      null,
      null
    )
    .run();
}

/** Revoke a user's override — stamp revoked_at/revoked_by. The row is KEPT (audit trail); a later
 *  grant reactivates it (clearing the stamp). No-op when the user has no override row. */
export async function revokeEntitlementOverride(db: AccountsDb, userId: string, revokedBy: string, now = Date.now()): Promise<void> {
  await db.prepare('UPDATE entitlement_overrides SET revoked_at = ?, revoked_by = ? WHERE user_id = ?').bind(now, revokedBy, userId).run();
}

/** Admin-panel per-user view (A276). Composes the already-fetched user + subscription + override rows
 *  into the shape /api/admin/* returns — NEVER any stripe_customer_id/stripe_subscription_id/session/
 *  credential/sync/workspace field (S25). effectiveTier is computed in-memory from the two rows via the
 *  same predicates hasCloudEntitlement() uses, so the list stays consistent with the live gate. */
export function adminUserView(u: UserRow, sub: SubscriptionRow | null, override: OverrideRow | null, now = Date.now()) {
  const cloud = overrideGrantsCloud(override, now) || grantsCloud(sub, now);
  return {
    id: u.id,
    email: u.email,
    emailVerified: !!u.email_verified,
    createdAt: u.created_at,
    donationTotalCents: u.donation_total_cents ?? 0,
    donatedAt: u.donated_at ?? null,
    subscription: sub ? { status: sub.status, currentPeriodEnd: sub.current_period_end ?? null } : null,
    override: override
      ? {
          tier: override.tier,
          expiresAt: override.expires_at ?? null,
          reason: override.reason ?? null,
          grantedBy: override.granted_by,
          grantedAt: override.granted_at,
          revokedAt: override.revoked_at ?? null,
        }
      : null,
    effectiveTier: cloud ? 'cloud' : 'local',
  };
}

/** Record this Stripe customer id on the user when not yet linked, so later lifecycle events that
 *  carry only the customer id (e.g. invoice.payment_failed) resolve back to the account. No-op when
 *  already set — never overwrites an existing linkage. */
export async function linkStripeCustomer(db: AccountsDb, user: UserRow, stripeCustomerId: string): Promise<void> {
  if (!stripeCustomerId || user.stripe_customer_id) return;
  await db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(stripeCustomerId, user.id).run();
}

/** Upsert the user's current subscription row (read-then-insert-or-update — one row per user). */
export async function upsertSubscription(
  db: AccountsDb,
  s: {
    userId: string;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    status: string | null;
    currentPeriodEnd: number | null;
    eventCreated?: number | null; // Stripe event.created (SECONDS) driving this update — persisted for the out-of-order guard (A303)
    cancelAtPeriodEnd?: boolean | null; // A333: undefined/null = this update doesn't know (e.g. invoice events) → preserve the stored flag
  },
  now = Date.now()
): Promise<void> {
  const existing = await subscriptionForUser(db, s.userId);
  // A266: stamp past_due_since on the transition INTO past_due; PRESERVE it across subsequent
  // payment_failed retries (so grace measures from the first failure, not the latest); clear it when
  // the subscription leaves past_due. This is what clamps the dunning grace to a fixed window.
  const isPastDue = s.status === 'past_due';
  const wasPastDue = existing?.status === 'past_due';
  const pastDueSince = isPastDue ? (wasPastDue ? (existing?.past_due_since ?? now) : now) : null;
  // A303: carry the applied event.created forward (keep the prior stamp when this update didn't carry one).
  const lastEventCreated = s.eventCreated ?? existing?.last_event_created ?? null;
  // A333: preserve the stored cancel flag when this update doesn't carry one (invoice.payment_failed).
  const cancelFlag = s.cancelAtPeriodEnd == null ? (existing?.cancel_at_period_end ?? 0) : s.cancelAtPeriodEnd ? 1 : 0;
  if (existing) {
    await db
      .prepare(
        'UPDATE subscriptions SET stripe_subscription_id = ?, stripe_customer_id = ?, status = ?, current_period_end = ?, updated = ?, past_due_since = ?, last_event_created = ?, cancel_at_period_end = ? WHERE user_id = ?'
      )
      .bind(s.stripeSubscriptionId, s.stripeCustomerId, s.status, s.currentPeriodEnd, now, pastDueSince, lastEventCreated, cancelFlag, s.userId)
      .run();
  } else {
    await db
      .prepare(
        'INSERT INTO subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, current_period_end, updated, past_due_since, last_event_created, cancel_at_period_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(s.userId, s.stripeSubscriptionId, s.stripeCustomerId, s.status, s.currentPeriodEnd, now, pastDueSince, lastEventCreated, cancelFlag)
      .run();
  }
}

/** Public billing summary for /api/me (A333) — lets the client render Cancel/Resume without ever
 *  seeing Stripe ids. NULL when the user has no subscription row (e.g. cloud via admin override). */
export function publicSubscription(sub: SubscriptionRow | null) {
  return sub
    ? {
        status: sub.status,
        currentPeriodEnd: sub.current_period_end ?? null,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      }
    : null;
}

/** How long a processed webhook event stays in the dedupe ledger (A265). Dedupe only needs to cover
 *  Stripe's replay/retry window (a few days), so anything older is dead weight — swept on the next
 *  write below to bound the table's growth (Pages Functions can't run a Cron Trigger). */
export const WEBHOOK_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Replay-safe dedupe for subscription-lifecycle webhook events (donations dedupe via their own PK;
 *  these events have no such row, so they are logged here by Stripe event id). */
export async function webhookEventSeen(db: AccountsDb, id: string): Promise<boolean> {
  return !!(await db.prepare('SELECT * FROM webhook_events WHERE id = ?').bind(id).first());
}
export async function markWebhookEvent(db: AccountsDb, id: string, type: string, now = Date.now()): Promise<void> {
  await db.prepare('INSERT INTO webhook_events (id, type, created_at) VALUES (?, ?, ?)').bind(id, type, now).run();
  // A265: sweep-on-write — drop events past the dedupe window so the ledger stays bounded. One extra
  // DELETE on a low-frequency path; never touches an event still inside Stripe's retry window.
  await db
    .prepare('DELETE FROM webhook_events WHERE created_at < ?')
    .bind(now - WEBHOOK_EVENT_TTL_MS)
    .run();
}

/* ---- recovery / verification tokens (Phase 3 — F55; single-use + TTL, S25) ------------------
   The emailed link carries `id.secret`; only SHA-256(secret) is persisted (session posture).
   consume marks used_at on the first VALID presentation (a wrong secret never burns the row). */

export async function createRecoveryToken(
  db: AccountsDb,
  t: { userId: string | null; email: string; purpose: 'verify' | 'recover' | 'reclaim' },
  now = Date.now()
): Promise<string> {
  const id = randomB64u(16);
  const secret = randomB64u(32);
  await db
    .prepare(
      'INSERT INTO recovery_tokens (id, user_id, email, purpose, token_hash, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, t.userId, t.email, t.purpose, await sha256b64u(secret), now, now + RECOVERY_TTL_MS, null)
    .run();
  return `${id}.${secret}`;
}

/** Consume a recovery token: verify purpose + hash, then mark it single-use. Returns the row only
 *  when it is unused, the purpose matches, the secret hash matches, AND it is unexpired. A wrong
 *  secret returns null WITHOUT burning the token; an expired-but-valid token is burned and null. */
export async function consumeRecoveryToken(
  db: AccountsDb,
  token: string,
  purpose: 'verify' | 'recover' | 'reclaim',
  now = Date.now()
): Promise<RecoveryTokenRow | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  const row = await db.prepare('SELECT * FROM recovery_tokens WHERE id = ?').bind(id).first<RecoveryTokenRow>();
  if (!row) return null;
  if (row.used_at != null) return null; // already consumed
  if (row.purpose !== purpose) return null;
  if (!hashesEqual(await sha256b64u(secret), row.token_hash)) return null; // wrong secret — do NOT burn
  await db.prepare('UPDATE recovery_tokens SET used_at = ? WHERE id = ?').bind(now, id).run(); // single-use
  return row.expires_at > now ? row : null; // expired → burned + rejected
}

/* ---- public (client-facing) shapes — never leak internal columns ----------------------------- */

export function publicUser(u: UserRow) {
  return {
    email: u.email,
    emailVerified: !!u.email_verified,
    donated: u.donated_at != null,
    donatedAt: u.donated_at ?? null,
    donationTotalCents: u.donation_total_cents ?? 0,
    createdAt: u.created_at,
  };
}
export function publicPasskey(c: CredentialRow) {
  return {
    id: c.id,
    nickname: c.nickname ?? null,
    createdAt: c.created_at,
    lastUsedAt: c.last_used_at ?? null,
    backedUp: !!c.backed_up,
  };
}
