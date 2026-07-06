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
  purpose: string; // 'verify' | 'recover'
  token_hash: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}
export interface SubscriptionRow {
  user_id: string; // PK — the account's single current subscription
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: string | null; // Stripe status: active|trialing|past_due|canceled|unpaid|…
  current_period_end: number | null; // ms epoch (Stripe seconds converted at the webhook boundary)
  updated: number; // ms epoch of the last webhook update (past_due grace counts from here)
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
  if (row.expires_at <= now) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  if (!hashesEqual(await sha256b64u(secret), row.secret_hash)) return null;
  const expiresAt = now + SESSION_TTL_MS; // sliding window
  await db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?').bind(expiresAt, now, id).run();
  return { ...row, expires_at: expiresAt, last_seen_at: now };
}

/** Delete the session row named by the request's cookie (logout). No-op on a bad token. */
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
  ch: { type: 'register' | 'login'; challenge: string; userId?: string | null; email?: string | null },
  now = Date.now()
): Promise<void> {
  await db.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(now).run(); // opportunistic sweep
  await db
    .prepare('INSERT INTO challenges (id, type, user_id, email, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(randomB64u(16), ch.type, ch.userId ?? null, ch.email ?? null, ch.challenge, now + CHALLENGE_TTL_MS)
    .run();
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
export async function createUser(db: AccountsDb, email: string, now = Date.now()): Promise<UserRow> {
  const row: UserRow = {
    id: crypto.randomUUID(),
    email,
    email_verified: 0,
    created_at: now,
    donated_at: null,
    donation_total_cents: 0,
    stripe_customer_id: null,
  };
  await db.prepare('INSERT INTO users (id, email, email_verified, created_at) VALUES (?, ?, ?, ?)').bind(row.id, row.email, 0, now).run();
  return row;
}

export async function credentialById(db: AccountsDb, id: string) {
  return db.prepare('SELECT * FROM credentials WHERE id = ?').bind(id).first<CredentialRow>();
}
export async function credentialsForUser(db: AccountsDb, userId: string): Promise<CredentialRow[]> {
  const { results } = await db.prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at').bind(userId).all<CredentialRow>();
  return results;
}
export async function insertCredential(
  db: AccountsDb,
  c: { id: string; userId: string; publicKey: string; counter: number; transports: string[]; aaguid: string | null; backedUp: boolean },
  now = Date.now()
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO credentials (id, user_id, public_key, counter, transports, aaguid, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(c.id, c.userId, c.publicKey, c.counter, JSON.stringify(c.transports), c.aaguid, c.backedUp ? 1 : 0, now)
    .run();
}
export async function touchCredential(db: AccountsDb, id: string, counter: number, now = Date.now()): Promise<void> {
  await db.prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?').bind(counter, now, id).run();
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
   handlers upsert status + current_period_end here; /api/me reads it to grant the `cloud` tier per
   the locked period-end + grace lapse policy. S25: billing metadata only — never any trade data. */

export async function subscriptionForUser(db: AccountsDb, userId: string) {
  return db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').bind(userId).first<SubscriptionRow>();
}
export async function subscriptionByStripeId(db: AccountsDb, stripeSubscriptionId: string) {
  return db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').bind(stripeSubscriptionId).first<SubscriptionRow>();
}
export async function userByStripeCustomerId(db: AccountsDb, stripeCustomerId: string) {
  return db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').bind(stripeCustomerId).first<UserRow>();
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
  },
  now = Date.now()
): Promise<void> {
  const existing = await subscriptionForUser(db, s.userId);
  if (existing) {
    await db
      .prepare(
        'UPDATE subscriptions SET stripe_subscription_id = ?, stripe_customer_id = ?, status = ?, current_period_end = ?, updated = ? WHERE user_id = ?'
      )
      .bind(s.stripeSubscriptionId, s.stripeCustomerId, s.status, s.currentPeriodEnd, now, s.userId)
      .run();
  } else {
    await db
      .prepare(
        'INSERT INTO subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, current_period_end, updated) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(s.userId, s.stripeSubscriptionId, s.stripeCustomerId, s.status, s.currentPeriodEnd, now)
      .run();
  }
}

/** Replay-safe dedupe for subscription-lifecycle webhook events (donations dedupe via their own PK;
 *  these events have no such row, so they are logged here by Stripe event id). */
export async function webhookEventSeen(db: AccountsDb, id: string): Promise<boolean> {
  return !!(await db.prepare('SELECT * FROM webhook_events WHERE id = ?').bind(id).first());
}
export async function markWebhookEvent(db: AccountsDb, id: string, type: string, now = Date.now()): Promise<void> {
  await db.prepare('INSERT INTO webhook_events (id, type, created_at) VALUES (?, ?, ?)').bind(id, type, now).run();
}

/* ---- recovery / verification tokens (Phase 3 — F55; single-use + TTL, S25) ------------------
   The emailed link carries `id.secret`; only SHA-256(secret) is persisted (session posture).
   consume marks used_at on the first VALID presentation (a wrong secret never burns the row). */

export async function createRecoveryToken(
  db: AccountsDb,
  t: { userId: string | null; email: string; purpose: 'verify' | 'recover' },
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
  purpose: 'verify' | 'recover',
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
