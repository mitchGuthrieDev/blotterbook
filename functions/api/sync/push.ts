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
 *  - ENTITLEMENT (A253/A277): a mutating cloud-tier write → requires hasCloudEntitlement() server-side
 *    (subscription OR admin override — the same choke point /api/me reads; else 402). The client tier
 *    check is advisory; without this a free-tier session could push unbounded blobs.
 *  - QUOTA (A253): per-record ciphertext byte cap + per-workspace record-count cap (else 413).
 *  - AUTHORIZATION: the workspace must exist AND be owned by the caller (ownedWorkspace → else 404),
 *    so user B can never push into user A's workspace.
 *  - seq ATOMICITY (A261): each written row's seq is assigned as MAX(seq)+1 inside the write statement,
 *    so concurrent pushes cannot collide on a seq; it stays monotonic and is never reused.
 *  - LWW: a record whose `updated` is not strictly newer than the stored row is DROPPED — a stale
 *    device cannot clobber a fresher row.
 *  - A15 subrequest cap: batches over MAX_PUSH_RECORDS (12) are rejected 413 so the client chunks
 *    (6 fixed + 3 per record ⇒ ≤ 42 < 50 subrequests; the A265 tombstone sweep below adds ≤ 3 more).
 * S25: the server only ever handles blinded ids + opaque ciphertext + timestamps — never a symbol,
 * P&L, note, tag, or name. No response field carries a trade value.
 */
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { badOrigin, checkOrigin, dbUnavailable, getDb, readJson, sessionFromRequest } from '../../_lib/accounts.ts';
import {
  MAX_PUSH_RECORDS,
  MAX_RECORDS_PER_WORKSPACE,
  MAX_RECORD_BYTES,
  authRequired,
  bucketUnavailable,
  callerHasCloud,
  cloudRequired,
  compactTombstones,
  countRecords,
  getBucket,
  maxSeq,
  ownedWorkspace,
  quotaExceeded,
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

  // ENTITLEMENT (A253): pushing is a cloud-tier write — gate it server-side. The client tier check is
  // advisory; without this, any authed free-tier session could push unbounded blobs (paywall bypass +
  // storage DoS). GET/pull stays ungated so a lapsed account can still reconcile/read (see sync.ts).
  if (!(await callerHasCloud(db, session.user_id))) return cloudRequired();

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
    // Per-record ciphertext byte cap (A253 quota). Ciphertext is base64 ASCII → 1 char = 1 byte.
    if ((r as IncomingRecord).ciphertext.length > MAX_RECORD_BYTES) return quotaExceeded(`record exceeds ${MAX_RECORD_BYTES} bytes`);
  }

  // AUTHORIZATION: reject a workspace the caller does not own (404 — does not leak existence). S25.
  const ws = await ownedWorkspace(db, workspaceId, session.user_id);
  if (!ws) return json({ error: 'workspace not found.' }, 404);

  // Per-workspace record-count quota (A253). One COUNT subrequest; upper-bound the post-push count by
  // the batch size (some may be LWW updates, so this only ever over-estimates → never lets it exceed).
  if ((await countRecords(db, workspaceId)) + body.records.length > MAX_RECORDS_PER_WORKSPACE) {
    return quotaExceeded(`workspace exceeds ${MAX_RECORDS_PER_WORKSPACE} records`);
  }

  let seq = await maxSeq(db, workspaceId); // response-cursor base — the persisted seq is assigned atomically per record
  const records = body.records as IncomingRecord[];
  for (const rec of records) {
    seq = await upsertRecord(db, bucket, workspaceId, rec, seq); // LWW inside; bumps seq iff written
  }
  // A265: piggyback a bounded sweep of this workspace's stale tombstones so the change-index stays
  // bounded (Pages has no cron). Best-effort — a hiccup here must never fail the user's push.
  try {
    await compactTombstones(db, bucket, workspaceId);
  } catch {
    /* maintenance only — ignore */
  }
  // S25: cursor + count only — no record contents echoed back.
  return json({ ok: true, cursor: seq, count: records.length });
}
