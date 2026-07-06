/**
 * GET /api/sync/pull?workspace_id=<id>&since=<seq> — incremental pull from a caller-owned workspace (F62).
 *
 * Returns every change-index row with seq > since (ordered by seq), each with its ciphertext fetched
 * from R2, plus a `nextSince` cursor and `more` flag so a device pages until caught up. The client
 * decrypts locally (server holds no key) and merges through the existing importAll trust boundary.
 *
 * SECURITY:
 *  - session-gated; fail-closed 503 without ACCOUNTS_DB or SYNC_BUCKET. (Read-only GET → no Origin check.)
 *  - AUTHORIZATION: the workspace must exist AND be owned by the caller (ownedWorkspace → else 404),
 *    so user B can never read user A's records.
 *  - A15 subrequest cap: at most PULL_PAGE (25) rows per response ⇒ ≤ 27 subrequests; the cursor pages.
 * S25: every returned record is { blinded_id, seq, type, updated, deleted, ciphertext } — blinded ids +
 * opaque ciphertext + timestamps ONLY. There is no path that returns a symbol, P&L, note, tag, or name.
 */
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { dbUnavailable, getDb, sessionFromRequest } from '../../_lib/accounts.ts';
import { PULL_PAGE, authRequired, bucketUnavailable, getBucket, ownedWorkspace, type SyncRecordRow } from '../../_lib/sync.ts';

export async function onRequestGet(ctx: Ctx) {
  const { request, env } = ctx;
  const db = getDb(env);
  if (!db) return dbUnavailable();
  const bucket = getBucket(env);
  if (!bucket) return bucketUnavailable();

  const session = await sessionFromRequest(request, db);
  if (!session) return authRequired();

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id') ?? '';
  if (!workspaceId) return json({ error: 'workspace_id is required.' }, 400);
  const since = Number(url.searchParams.get('since') ?? '0');
  const cursor = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0;

  // AUTHORIZATION: reject a workspace the caller does not own (404 — does not leak existence). S25.
  const ws = await ownedWorkspace(db, workspaceId, session.user_id);
  if (!ws) return json({ error: 'workspace not found.' }, 404);

  // Fetch one extra row than the page to know whether more remain (LIMIT is a fixed server constant).
  const { results } = await db
    .prepare(`SELECT * FROM sync_records WHERE workspace_id = ? AND seq > ? ORDER BY seq LIMIT ${PULL_PAGE + 1}`)
    .bind(workspaceId, cursor)
    .all<SyncRecordRow>();

  const more = results.length > PULL_PAGE;
  const page = more ? results.slice(0, PULL_PAGE) : results;

  const records = [];
  for (const row of page) {
    const obj = await bucket.get(row.ciphertext_ref);
    const ciphertext = obj ? await obj.text() : '';
    // S25: blinded id + opaque ciphertext + index metadata only — never a decrypted trade field.
    records.push({
      blinded_id: row.blinded_id,
      seq: row.seq,
      type: row.type,
      updated: row.updated,
      deleted: !!row.deleted,
      ciphertext,
    });
  }
  const nextSince = page.length ? page[page.length - 1].seq : cursor;
  return json({ records, nextSince, more });
}
