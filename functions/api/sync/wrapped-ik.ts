/**
 * /api/sync/wrapped-ik — store + fetch the caller's per-method wrapped-IK blobs (F62).
 *
 * The account IDENTITY KEY (IK) is wrapped once per UNLOCK METHOD (passkey PRF / passphrase / escrow
 * recovery key — F61a). Each blob is opaque ciphertext of a key the server cannot unwrap.
 *
 *  - PUT: add or rotate one method's wrapped-IK blob (upsert by method + key_id).
 *  - GET: return every wrapped-IK blob for the caller (a fresh device reads them all to unlock).
 *
 * SECURITY: session-gated, Origin-checked on PUT, fail-closed 503 without ACCOUNTS_DB or SYNC_BUCKET.
 * S25: stores/returns ONLY { method, key_id, wrapped_ik, updated } — an opaque wrapped-key blob and
 * its selector; NEVER a plaintext key and never any trade field.
 */
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { badOrigin, checkOrigin, dbUnavailable, getDb, readJson, sessionFromRequest } from '../../_lib/accounts.ts';
import { authRequired, bucketUnavailable, getBucket, type SyncWrappedIkRow } from '../../_lib/sync.ts';

interface WrappedIkBody {
  method?: unknown;
  key_id?: unknown;
  wrapped_ik?: unknown;
}

export async function onRequestPut(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  const bucket = getBucket(env);
  if (!bucket) return bucketUnavailable();

  const session = await sessionFromRequest(request, db);
  if (!session) return authRequired();

  const body = (await readJson<WrappedIkBody>(request)) ?? {};
  const { method, key_id: keyId, wrapped_ik: wrappedIk } = body;
  if (typeof method !== 'string' || !method) return json({ error: 'method is required.' }, 400);
  if (typeof keyId !== 'string' || !keyId) return json({ error: 'key_id is required.' }, 400);
  if (typeof wrappedIk !== 'string' || !wrappedIk) return json({ error: 'wrapped_ik is required.' }, 400);

  const now = Date.now();
  const existing = await db
    .prepare('SELECT * FROM sync_wrapped_ik WHERE user_id = ? AND method = ? AND key_id = ?')
    .bind(session.user_id, method, keyId)
    .first<SyncWrappedIkRow>();
  if (existing) {
    await db
      .prepare('UPDATE sync_wrapped_ik SET wrapped_ik = ?, updated = ? WHERE user_id = ? AND method = ? AND key_id = ?')
      .bind(wrappedIk, now, session.user_id, method, keyId)
      .run();
  } else {
    await db
      .prepare('INSERT INTO sync_wrapped_ik (user_id, method, key_id, wrapped_ik, updated) VALUES (?, ?, ?, ?, ?)')
      .bind(session.user_id, method, keyId, wrappedIk, now)
      .run();
  }
  // S25: never echo any key material beyond the caller's own opaque blob metadata.
  return json({ ok: true, method, key_id: keyId, updated: now });
}

export async function onRequestGet(ctx: Ctx) {
  const { request, env } = ctx;
  const db = getDb(env);
  if (!db) return dbUnavailable();
  const bucket = getBucket(env);
  if (!bucket) return bucketUnavailable();

  const session = await sessionFromRequest(request, db);
  if (!session) return authRequired();

  const { results } = await db
    .prepare('SELECT * FROM sync_wrapped_ik WHERE user_id = ? ORDER BY updated')
    .bind(session.user_id)
    .all<SyncWrappedIkRow>();
  // S25: opaque wrapped-IK blobs + their selectors only — no plaintext key, no trade field.
  const blobs = results.map(r => ({ method: r.method, key_id: r.key_id, wrapped_ik: r.wrapped_ik, updated: r.updated }));
  return json({ wrappedIks: blobs });
}
