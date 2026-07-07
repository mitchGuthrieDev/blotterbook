/**
 * POST /api/account/delete — permanently delete the caller's account + ALL their data (A305, GDPR).
 *
 * Session-authed (server-side resolution), Origin-checked (mutating), fail-closed 503 without
 * ACCOUNTS_DB or SYNC_BUCKET. Two-phase, RESUMABLE:
 *   1. Clear each owned sync workspace — page its change-index rows + their R2 ciphertext blobs via
 *      deleteWorkspacePage (a D1 cascade can NEVER reach R2), then drop the workspace shell. Bounded by
 *      MAX_PAGES_PER_CALL so an arbitrarily large account can't blow the Cloudflare subrequest cap; if
 *      the budget runs out with data still remaining the response is `{ done: false }` and the client
 *      re-invokes to continue (mirrors /api/sync/delete's pager).
 *   2. Once no owned workspace remains, delete every D1 row keyed to the user (deleteUserAccount —
 *      credentials/sessions/subscriptions/donations/recovery_tokens/challenges/sync_wrapped_ik + the
 *      user row) via EXPLICIT deletes (never relying on a DB cascade), clear the session cookie, and
 *      return `{ done: true, deleted: true }`.
 *
 * S25: only blinded ids + opaque ciphertext are ever touched in R2; no response field carries a trade
 * value. No cloud-tier gate — a user must always be able to delete their own account + data.
 */
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  badOrigin,
  checkOrigin,
  dbUnavailable,
  deleteUserAccount,
  getDb,
  sessionClearCookie,
  sessionFromRequest,
} from '../../_lib/accounts.ts';
import { authRequired, bucketUnavailable, deleteWorkspacePage, deleteWorkspaceShell, getBucket, type SyncWorkspaceRow } from '../../_lib/sync.ts';

// Each cleared page costs ~3 subrequests (SELECT + R2 batch delete + D1 delete); cap the per-invocation
// budget well under Cloudflare's 50-subrequest limit, leaving headroom for the final user-row deletes.
const MAX_PAGES_PER_CALL = 10;

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  const bucket = getBucket(env);
  if (!bucket) return bucketUnavailable();

  const session = await sessionFromRequest(request, db);
  if (!session) return authRequired();
  const userId = session.user_id;

  // Phase 1 — clear owned workspaces (R2 blobs + sync_records), bounded per call.
  let pages = 0;
  const { results: workspaces } = await db
    .prepare('SELECT * FROM sync_workspaces WHERE owner_user_id = ? ORDER BY created_at')
    .bind(userId)
    .all<SyncWorkspaceRow>();
  for (const ws of workspaces) {
    for (;;) {
      if (pages >= MAX_PAGES_PER_CALL) return json({ ok: true, done: false }); // budget spent → client re-invokes
      const { done } = await deleteWorkspacePage(db, bucket, ws.workspace_id);
      pages++;
      if (done) break;
    }
    await deleteWorkspaceShell(db, ws.workspace_id); // records gone → drop key + registry rows
  }

  // Phase 2 — everything owned is cleared: delete all remaining D1 rows + the user, and clear the cookie.
  await deleteUserAccount(db, userId);
  return json({ ok: true, done: true, deleted: true }, 200, { 'Set-Cookie': sessionClearCookie() });
}
