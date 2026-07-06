/* Shared helpers for the synced-workspaces transport (F62 — Step 5 of docs/synced-workspaces.md).
   The server is a DELIBERATELY DUMB encrypted-blob store: it stores/returns ONLY ciphertext + blinded
   ids + timestamps/sizes/seq cursors + opaque wrapped-key blobs. It can NEVER read a symbol, P&L,
   note, tag, screenshot, or workspace name — it holds no key and never decrypts (crypto lives entirely
   client-side in src/lib/core/crypto.ts, F61a). This is the S25 moat, strengthened: "we literally
   cannot read your data."

   Posture (identical to F53–F55): SESSION-GATED (resolve the user server-side via sessionFromRequest),
   ORIGIN-checked on every mutation, and FAIL-CLOSED (503) when ACCOUNTS_DB or SYNC_BUCKET is unbound.
   Every workspace access is authorized to the caller — a user can only touch workspaces whose
   owner_user_id is their own id (ownedWorkspace() returns null otherwise → the route answers 404,
   which does not leak whether the workspace exists for another user).

   Row shapes mirror functions/schema.sql. This module only exports helpers (no onRequest), so it is
   never served as a route. */

import type { Env } from './types.ts';
import { json } from './http.ts';
import type { AccountsDb } from './accounts.ts';

/* ---- narrow R2 seam ------------------------------------------------------------------------------
   The subset of R2Bucket the sync endpoints use. R2Bucket satisfies it structurally; the sync test
   suite substitutes an in-memory mock implementing the same shape (mirrors the AccountsDb pattern). */
export interface SyncBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export function getBucket(env: Env): SyncBucket | null {
  const b = env.SYNC_BUCKET;
  return b ? (b as unknown as SyncBucket) : null;
}

/** 503 body for an unbound SYNC_BUCKET — sync fails CLOSED, with a clear reason (mirrors the
 *  ACCOUNTS_DB dbUnavailable() shape). */
export function bucketUnavailable() {
  return json({ error: 'Sync is not available: the SYNC_BUCKET R2 binding is not configured on this deployment.' }, 503);
}

/** 401 body for a request without a live session — every /api/sync/* route is session-gated. */
export function authRequired() {
  return json({ error: 'Authentication required.' }, 401);
}

/* ---- row shapes (mirror functions/schema.sql) ---------------------------------------------------- */
export interface SyncWorkspaceRow {
  workspace_id: string; // the client's F59 UUID
  owner_user_id: string;
  created_at: number;
}
export interface SyncWorkspaceKeyRow {
  workspace_id: string;
  owner_user_id: string;
  wrapped_dek: string; // F61a WrappedDek JSON — DEK wrapped (AES-KW) under the account IK. Opaque.
  updated: number;
}
export interface SyncWrappedIkRow {
  user_id: string;
  method: string; // 'passkey' | 'passphrase' | 'recovery' — opaque to the server
  key_id: string;
  wrapped_ik: string; // F61a WrappedIK JSON — IK wrapped (AES-KW) under a per-method KEK. Opaque.
  updated: number;
}
export interface SyncRecordRow {
  workspace_id: string;
  blinded_id: string; // HMAC(workspaceKey, tradeId) — NEVER the raw content hash (S25)
  seq: number; // monotonic per-workspace cursor
  type: string; // 'trade' | 'journal' | 'trademeta' | … — opaque label, never inspected
  ciphertext_ref: string; // R2 object key holding the EncryptedRecord blob
  updated: number; // LWW clock (wall-clock ms from the writing client)
  deleted: number; // 0 | 1 tombstone flag
}

/* ---- A15 subrequest budget (Cloudflare 50-subrequest cap) ----------------------------------------
   PUSH costs 2 fixed subrequests (ownership lookup + max-seq lookup) + 3 per record (existing-row
   SELECT + R2 put + upsert) ⇒ 2 + 3·15 = 47 < 50. Batches over MAX_PUSH_RECORDS are rejected (413) so
   the client chunks. PULL costs 2 fixed + 1 R2 get per returned record ⇒ 2 + 25 = 27 < 50; the page is
   capped and a nextSince cursor lets the client page. */
export const MAX_PUSH_RECORDS = 15;
export const PULL_PAGE = 25;

/** Resolve a workspace ONLY when it exists AND is owned by this user. Returns null for a
 *  nonexistent OR cross-user workspace — callers answer 404 uniformly so existence never leaks
 *  across accounts (S25 authorization boundary). */
export async function ownedWorkspace(db: AccountsDb, workspaceId: string, userId: string): Promise<SyncWorkspaceRow | null> {
  if (!workspaceId) return null;
  const row = await db.prepare('SELECT * FROM sync_workspaces WHERE workspace_id = ?').bind(workspaceId).first<SyncWorkspaceRow>();
  if (!row || row.owner_user_id !== userId) return null;
  return row;
}

/** R2 object key for a record's ciphertext blob. Namespaced by workspace so a delete/list stays
 *  scoped; overwritten in place on update (no orphan accumulation). Contains only opaque ciphertext. */
export function recordKey(workspaceId: string, blindedId: string): string {
  return `records/${workspaceId}/${blindedId}`;
}

/** Highest existing seq for a workspace (0 when empty) — the base for assigning the next monotonic
 *  seq on a push. One SELECT (ORDER BY seq DESC LIMIT 1). */
export async function maxSeq(db: AccountsDb, workspaceId: string): Promise<number> {
  const row = await db
    .prepare('SELECT * FROM sync_records WHERE workspace_id = ? ORDER BY seq DESC LIMIT 1')
    .bind(workspaceId)
    .first<SyncRecordRow>();
  return row ? row.seq : 0;
}

/** One incoming encrypted record from the client. `ciphertext` is an opaque base64 AES-GCM blob
 *  (F61a EncryptedRecord) the server stores verbatim and never decodes; the rest is index metadata. */
export interface IncomingRecord {
  blinded_id: string;
  type: string;
  ciphertext: string;
  updated: number;
  deleted?: boolean;
}

/** Validate one incoming record's shape (no key content is ever inspected — only presence/types). */
export function validRecord(r: unknown): r is IncomingRecord {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.blinded_id === 'string' &&
    x.blinded_id.length > 0 &&
    typeof x.type === 'string' &&
    x.type.length > 0 &&
    typeof x.ciphertext === 'string' &&
    typeof x.updated === 'number' &&
    Number.isFinite(x.updated) &&
    (x.deleted === undefined || typeof x.deleted === 'boolean')
  );
}

/** Upsert one record under LAST-WRITER-WINS: a push whose `updated` is not strictly newer than the
 *  stored row is DROPPED (a stale device can never clobber a fresher row — same-clock re-push is a
 *  no-op). A written record gets `seq = prevSeq + 1` so pull's `seq > cursor` always surfaces it. The
 *  ciphertext blob is stored in R2 (large records like encrypted screenshots never sit in a D1 row).
 *  Returns the seq to carry forward (bumped iff the record was written). Subrequests per call: 1
 *  SELECT + 1 R2 put + 1 upsert = 3 (only when written; a stale drop costs just the SELECT). */
export async function upsertRecord(
  db: AccountsDb,
  bucket: SyncBucket,
  workspaceId: string,
  rec: IncomingRecord,
  prevSeq: number
): Promise<number> {
  const existing = await db
    .prepare('SELECT * FROM sync_records WHERE workspace_id = ? AND blinded_id = ?')
    .bind(workspaceId, rec.blinded_id)
    .first<SyncRecordRow>();
  if (existing && existing.updated >= rec.updated) return prevSeq; // LWW: stale/equal push does not clobber
  const seq = prevSeq + 1;
  const ref = recordKey(workspaceId, rec.blinded_id);
  await bucket.put(ref, rec.ciphertext); // opaque ciphertext only — S25
  const deleted = rec.deleted ? 1 : 0;
  if (existing) {
    await db
      .prepare(
        'UPDATE sync_records SET seq = ?, type = ?, ciphertext_ref = ?, updated = ?, deleted = ? WHERE workspace_id = ? AND blinded_id = ?'
      )
      .bind(seq, rec.type, ref, rec.updated, deleted, workspaceId, rec.blinded_id)
      .run();
  } else {
    await db
      .prepare(
        'INSERT INTO sync_records (workspace_id, blinded_id, seq, type, ciphertext_ref, updated, deleted) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(workspaceId, rec.blinded_id, seq, rec.type, ref, rec.updated, deleted)
      .run();
  }
  return seq;
}
