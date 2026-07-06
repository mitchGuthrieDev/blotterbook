/* Changelog (Blotterlog) email subscriptions — helper layer (F44; design: docs/changelog-email-a141.md).
   Schema: functions/schema.sql (`subscribers` + `changelog_sends`, D1, bound as ACCOUNTS_DB — the
   same database the accounts layer uses; this table is single-purpose and never joins to it).

   Double opt-in: a signup writes a `pending` row + emails a confirm link; only `confirmed` rows are
   ever broadcast to. The confirm + unsubscribe links carry an opaque `id.secret` pair and only
   SHA-256(secret) is stored (same posture as sessions/recovery — a D1 leak never yields a usable link).
   Unsubscribe HARD-DELETES the row (the link IS the erasure request); pending rows > 7 days are purged.

   GUARDRAIL (S25/A141): these rows hold an email address + link-token hashes + timestamps ONLY —
   no IP, no user-agent, no analytics, and never anything about trades; raw addresses are never logged.
   The Turnstile check + per-address cooldown are defense-in-depth only (S22) — correctness NEVER
   depends on them; the real invariants are double opt-in + the confirmed-only send.

   This module only exports helpers (no onRequest), so it is never served as a route. */

import type { Env } from './types.ts';
import { type AccountsDb, EMAIL_RE, randomB64u, sha256b64u } from './accounts.ts';

export const PENDING_TTL_MS = 7 * 24 * 3600 * 1000; // unconfirmed signups auto-purge after 7 days
export const RESEND_COOLDOWN_MS = 5 * 60 * 1000; // per-address cooldown on confirm-mail re-sends (S22)

export interface SubscriberRow {
  id: string;
  email: string;
  status: string; // 'pending' | 'confirmed'
  confirm_token_hash: string | null;
  unsub_token_hash: string;
  created_at: number;
  confirmed_at: number | null;
  last_sent_at: number | null;
}
export interface ChangelogSendRow {
  version: string;
  sent_at: number;
  recipient_count: number | null;
}

/** Normalize a submitted address to the stored form: trim + lowercase. Returns null when it doesn't
 *  look like an email (the ONE shape check, shared with the accounts layer via EMAIL_RE). */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/* ---- constant-time compare (fixed-length token hashes) ------------------------------------------ */
function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Constant-time compare for an arbitrary-length secret (the notify-changelog shared secret) that
 *  leaks neither contents nor length — HMAC both sides under a fresh random key and compare digests.
 *  Mirrors the auth.ts pattern so the send trigger's auth is a real control (S22). */
export async function constantTimeEqual(a: unknown, b: unknown): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const ma = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(String(a))));
  const mb = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(String(b))));
  let diff = ma.length ^ mb.length;
  for (let i = 0; i < ma.length; i++) diff |= ma[i] ^ mb[i];
  return diff === 0;
}

/* ---- lookups ------------------------------------------------------------------------------------ */
export async function subscriberByEmail(db: AccountsDb, email: string): Promise<SubscriberRow | null> {
  return db.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first<SubscriberRow>();
}
export async function subscriberById(db: AccountsDb, id: string): Promise<SubscriberRow | null> {
  return db.prepare('SELECT * FROM subscribers WHERE id = ?').bind(id).first<SubscriberRow>();
}

/** Confirmed recipients for a broadcast — ONLY status = 'confirmed' rows are ever returned. */
export async function confirmedSubscribers(db: AccountsDb): Promise<SubscriberRow[]> {
  const { results } = await db.prepare('SELECT * FROM subscribers WHERE status = ?').bind('confirmed').all<SubscriberRow>();
  return results;
}

/** Delete unconfirmed rows older than the pending TTL (called opportunistically on subscribe/notify —
 *  no cron needed). */
export async function purgePending(db: AccountsDb, now = Date.now()): Promise<void> {
  await db
    .prepare('DELETE FROM subscribers WHERE status = ? AND created_at < ?')
    .bind('pending', now - PENDING_TTL_MS)
    .run();
}

/* ---- link tokens (id.secret; only the hash persists) -------------------------------------------- */
function splitToken(token: unknown): { id: string; secret: string } | null {
  if (typeof token !== 'string' || !token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  return { id: token.slice(0, dot), secret: token.slice(dot + 1) };
}

/* ---- signup / re-send --------------------------------------------------------------------------- */

/** Insert a fresh pending subscriber and return the two link tokens. Only the SHA-256 of each
 *  secret is stored; the returned `id.secret` strings are what the emailed links carry. */
export async function createSubscriber(
  db: AccountsDb,
  email: string,
  now = Date.now()
): Promise<{ confirmToken: string; unsubToken: string }> {
  const id = randomB64u(16);
  const confirmSecret = randomB64u(32);
  const unsubSecret = randomB64u(32);
  await db
    .prepare(
      'INSERT INTO subscribers (id, email, status, confirm_token_hash, unsub_token_hash, created_at, confirmed_at, last_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, email, 'pending', await sha256b64u(confirmSecret), await sha256b64u(unsubSecret), now, null, now)
    .run();
  return { confirmToken: `${id}.${confirmSecret}`, unsubToken: `${id}.${unsubSecret}` };
}

/** Mint a NEW confirm token for an existing pending row (re-sending the confirm mail) and stamp
 *  last_sent_at. Returns the fresh `id.secret`. Callers gate this behind canResend() (cooldown). */
export async function refreshConfirmToken(db: AccountsDb, row: SubscriberRow, now = Date.now()): Promise<string> {
  const secret = randomB64u(32);
  await db
    .prepare('UPDATE subscribers SET confirm_token_hash = ?, last_sent_at = ? WHERE id = ?')
    .bind(await sha256b64u(secret), now, row.id)
    .run();
  return `${row.id}.${secret}`;
}

/** True when enough time has elapsed since the last confirm-mail send to send another (S22 cooldown). */
export function canResend(row: SubscriberRow, now = Date.now()): boolean {
  return !row.last_sent_at || now - row.last_sent_at >= RESEND_COOLDOWN_MS;
}

/* Build the per-recipient unsubscribe token from an existing row's stored unsub hash?  No — the
   secret is only known at creation, so unsubscribe links are minted at send time from a fresh secret
   the row is rotated to. See rotateUnsubToken(). */

/** Rotate the row's unsubscribe secret and return the fresh `id.secret` link (used when a broadcast
 *  needs a working one-click link for a recipient whose original secret we never stored). */
export async function rotateUnsubToken(db: AccountsDb, row: SubscriberRow): Promise<string> {
  const secret = randomB64u(32);
  await db
    .prepare('UPDATE subscribers SET unsub_token_hash = ? WHERE id = ?')
    .bind(await sha256b64u(secret), row.id)
    .run();
  return `${row.id}.${secret}`;
}

/* ---- confirm (pending → confirmed) -------------------------------------------------------------- */

/** Consume a confirm link. Verifies the secret hash, flips pending → confirmed, clears the confirm
 *  hash (single-use). Already-confirmed rows are idempotent successes. Returns the row on success,
 *  null on a bad/expired/unknown token. */
export async function confirmSubscriber(db: AccountsDb, token: unknown, now = Date.now()): Promise<SubscriberRow | null> {
  const parts = splitToken(token);
  if (!parts) return null;
  const row = await subscriberById(db, parts.id);
  if (!row) return null;
  if (row.status === 'confirmed') return row; // idempotent (link clicked twice / prefetched)
  if (!row.confirm_token_hash) return null;
  if (!hashesEqual(await sha256b64u(parts.secret), row.confirm_token_hash)) return null;
  await db
    .prepare('UPDATE subscribers SET status = ?, confirmed_at = ?, confirm_token_hash = ? WHERE id = ?')
    .bind('confirmed', now, null, row.id)
    .run();
  return { ...row, status: 'confirmed', confirmed_at: now, confirm_token_hash: null };
}

/* ---- unsubscribe (hard delete) ------------------------------------------------------------------ */

/** Consume an unsubscribe link: verify the secret hash and HARD-DELETE the row. Returns true when a
 *  row was deleted. A bad/unknown token returns false — callers still answer 200 (idempotent, no
 *  enumeration: an already-removed address and a bad token are indistinguishable to the caller). */
export async function unsubscribeByToken(db: AccountsDb, token: unknown): Promise<boolean> {
  const parts = splitToken(token);
  if (!parts) return false;
  const row = await subscriberById(db, parts.id);
  if (!row) return false;
  if (!hashesEqual(await sha256b64u(parts.secret), row.unsub_token_hash)) return false;
  await db.prepare('DELETE FROM subscribers WHERE id = ?').bind(row.id).run();
  return true;
}

/* ---- send ledger (idempotency) ------------------------------------------------------------------ */
export async function sendLedgerFor(db: AccountsDb, version: string): Promise<ChangelogSendRow | null> {
  return db.prepare('SELECT * FROM changelog_sends WHERE version = ?').bind(version).first<ChangelogSendRow>();
}
export async function recordSend(db: AccountsDb, version: string, recipientCount: number, now = Date.now()): Promise<void> {
  await db
    .prepare('INSERT INTO changelog_sends (version, sent_at, recipient_count) VALUES (?, ?, ?)')
    .bind(version, now, recipientCount)
    .run();
}

/* ---- Turnstile (defense-in-depth only — S22) ---------------------------------------------------- */

/** Verify a Cloudflare Turnstile token. Posture (S22 — this is NEVER the security boundary):
 *   - TURNSTILE_SECRET unbound  → skip (return true): the deployment isn't using Turnstile.
 *   - configured, token present → siteverify; return its success verdict.
 *   - configured, token MISSING → false (a real widget would have produced one).
 *   - configured, network error → true (fail OPEN — never lock out real users when the service is
 *     down; double opt-in still gates every actual email). */
export async function verifyTurnstile(env: Env, token: unknown, remoteIp?: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true; // not configured — skip
  if (typeof token !== 'string' || !token) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (_) {
    return true; // service unreachable — fail open (defense-in-depth only)
  }
}
