/**
 * POST /api/sync/delete — erase a caller-owned workspace's synced copy (A254).
 *
 * Body: { workspace_id }. Deletes one bounded page of the workspace's change-index rows AND their R2
 * ciphertext blobs; once the last page is gone it also drops the wrapped-DEK + registry rows, so no
 * opaque blob or ownership row survives. The response carries `{ deleted, done }` — the client loops
 * (calling again) while `done` is false so an arbitrarily large workspace pages within the A15
 * subrequest cap. This is what makes "erase all data" clear the CLOUD copy too, not just the local one
 * (the client already disables sync + resets the cursor on purge; without this the E2E ciphertext
 * lingered server-side).
 *
 * SECURITY:
 *  - session-gated + Origin-checked; fail-closed 503 without ACCOUNTS_DB or SYNC_BUCKET.
 *  - AUTHORIZATION: the workspace must exist AND be owned by the caller (ownedWorkspace → else 404), so
 *    one user can never erase another's workspace and a nonexistent id never leaks existence. S25.
 *  - NO cloud-tier gate (unlike push/register): a lapsed/downgraded account must always be able to
 *    DELETE its own data — erase is never paywalled.
 * S25: only blinded ids + opaque ciphertext are ever touched; no response field carries a trade value.
 */
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { badOrigin, checkOrigin, dbUnavailable, getDb, readJson, sessionFromRequest } from '../../_lib/accounts.ts';
import { authRequired, bucketUnavailable, deleteWorkspacePage, deleteWorkspaceShell, getBucket, ownedWorkspace } from '../../_lib/sync.ts';

interface DeleteBody {
  workspace_id?: unknown;
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

  const body = (await readJson<DeleteBody>(request)) ?? {};
  const workspaceId = body.workspace_id;
  if (typeof workspaceId !== 'string' || !workspaceId) return json({ error: 'workspace_id is required.' }, 400);

  // AUTHORIZATION: only the owner erases; a nonexistent/cross-user id → 404 (no existence leak). S25.
  const ws = await ownedWorkspace(db, workspaceId, session.user_id);
  if (!ws) return json({ error: 'workspace not found.' }, 404);

  const { deleted, done } = await deleteWorkspacePage(db, bucket, workspaceId);
  if (done) await deleteWorkspaceShell(db, workspaceId); // records gone → drop the key + registry rows too
  return json({ workspace_id: workspaceId, deleted, done });
}
