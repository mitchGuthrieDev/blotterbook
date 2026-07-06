/**
 * POST /api/sync/push — push a batch of encrypted records into a caller-owned workspace (F62).
 *
 * Body: { workspace_id, records: [{ blinded_id, type, ciphertext, updated, deleted? }] }. Each
 * ciphertext is an opaque AES-GCM blob (F61a EncryptedRecord) stored verbatim in R2; the D1 change-
 * index row (blinded_id / seq / type / updated / deleted → ciphertext_ref) is upserted under a
 * monotonic per-workspace `seq` so pull's cursor surfaces it. Tombstones ride through as deleted:true.
 *
 * SECURITY:
 *  - session-gated + Origin-checked; fail-closed 503 without ACCOUNTS_DB or SYNC_BUCKET.
 *  - AUTHORIZATION: the workspace must exist AND be owned by the caller (ownedWorkspace → else 404),
 *    so user B can never push into user A's workspace.
 *  - seq MONOTONICITY: seq starts at the workspace's current max and only advances (never reused).
 *  - LWW: a record whose `updated` is not strictly newer than the stored row is DROPPED — a stale
 *    device cannot clobber a fresher row.
 *  - A15 subrequest cap: batches over MAX_PUSH_RECORDS (15) are rejected 413 so the client chunks
 *    (2 fixed + 3 per record ⇒ ≤ 47 < 50 subrequests).
 * S25: the server only ever handles blinded ids + opaque ciphertext + timestamps — never a symbol,
 * P&L, note, tag, or name. No response field carries a trade value.
 */
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { badOrigin, checkOrigin, dbUnavailable, getDb, readJson, sessionFromRequest } from '../../_lib/accounts.ts';
import {
  MAX_PUSH_RECORDS,
  authRequired,
  bucketUnavailable,
  getBucket,
  maxSeq,
  ownedWorkspace,
  upsertRecord,
  validRecord,
  type IncomingRecord,
} from '../../_lib/sync.ts';

interface PushBody {
  workspace_id?: unknown;
  records?: unknown;
}

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  const bucket = getBucket(env);
  if (!bucket) return bucketUnavailable();

  const session = await sessionFromRequest(request, db);
  if (!session) return authRequired();

  const body = (await readJson<PushBody>(request)) ?? {};
  const workspaceId = body.workspace_id;
  if (typeof workspaceId !== 'string' || !workspaceId) return json({ error: 'workspace_id is required.' }, 400);
  if (!Array.isArray(body.records)) return json({ error: 'records must be an array.' }, 400);
  if (body.records.length > MAX_PUSH_RECORDS) {
    // Bound the batch to stay under the A15 subrequest cap — the client chunks and retries.
    return json({ error: `Too many records in one push (max ${MAX_PUSH_RECORDS}); chunk the batch.`, max: MAX_PUSH_RECORDS }, 413);
  }
  for (const r of body.records) {
    if (!validRecord(r)) return json({ error: 'Each record needs blinded_id, type, ciphertext, updated.' }, 400);
  }

  // AUTHORIZATION: reject a workspace the caller does not own (404 — does not leak existence). S25.
  const ws = await ownedWorkspace(db, workspaceId, session.user_id);
  if (!ws) return json({ error: 'workspace not found.' }, 404);

  let seq = await maxSeq(db, workspaceId); // monotonic base — only ever advances below
  const records = body.records as IncomingRecord[];
  for (const rec of records) {
    seq = await upsertRecord(db, bucket, workspaceId, rec, seq); // LWW inside; bumps seq iff written
  }
  // S25: cursor + count only — no record contents echoed back.
  return json({ ok: true, cursor: seq, count: records.length });
}
