/**
 * /api/sync/workspaces — register + list the caller's synced workspaces (F62).
 *
 *  - POST: idempotently create (or re-own-check) a sync_workspaces row owned by the caller, store its
 *    per-workspace wrapped DEK (F61a WrappedDek, AES-KW under the account IK), and optionally upsert the
 *    encrypted workspace-NAME record (the name travels as ciphertext — NEVER as plaintext in D1, S25).
 *    A repeat with the same workspace_id owned by the caller is a no-op/upsert; owned by another user →
 *    409 (never silently re-owned).
 *  - GET: list the caller's workspaces (ids + wrapped DEKs + created_at) so a device can enumerate what
 *    it can decrypt.
 *
 * SECURITY: session-gated (server-side session resolution), Origin-checked on POST, fail-closed 503
 * without ACCOUNTS_DB or SYNC_BUCKET. S25: the response carries only { workspace_id, created_at,
 * wrapped_dek } — an opaque key blob + ids + a timestamp; never a workspace name or any trade field.
 */
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { badOrigin, checkOrigin, dbUnavailable, getDb, readJson, sessionFromRequest } from '../../_lib/accounts.ts';
import {
  authRequired,
  bucketUnavailable,
  getBucket,
  maxSeq,
  upsertRecord,
  validRecord,
  type IncomingRecord,
  type SyncWorkspaceKeyRow,
  type SyncWorkspaceRow,
} from '../../_lib/sync.ts';

interface RegisterBody {
  workspace_id?: unknown;
  wrapped_dek?: unknown;
  name?: unknown; // optional encrypted workspace-name record (IncomingRecord shape)
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

  const body = (await readJson<RegisterBody>(request)) ?? {};
  const workspaceId = body.workspace_id;
  const wrappedDek = body.wrapped_dek;
  if (typeof workspaceId !== 'string' || !workspaceId) return json({ error: 'workspace_id is required.' }, 400);
  if (typeof wrappedDek !== 'string' || !wrappedDek) return json({ error: 'wrapped_dek is required.' }, 400);

  const now = Date.now();
  const existing = await db.prepare('SELECT * FROM sync_workspaces WHERE workspace_id = ?').bind(workspaceId).first<SyncWorkspaceRow>();
  if (existing && existing.owner_user_id !== session.user_id) {
    return json({ error: 'workspace_id already registered to another account.' }, 409); // never re-own cross-user
  }
  const createdAt = existing ? existing.created_at : now;
  if (!existing) {
    await db
      .prepare('INSERT INTO sync_workspaces (workspace_id, owner_user_id, created_at) VALUES (?, ?, ?)')
      .bind(workspaceId, session.user_id, createdAt)
      .run();
  }

  // Upsert the per-workspace wrapped DEK (idempotent create → keep it current on re-register).
  const key = await db.prepare('SELECT * FROM sync_workspace_keys WHERE workspace_id = ?').bind(workspaceId).first<SyncWorkspaceKeyRow>();
  if (key) {
    await db
      .prepare('UPDATE sync_workspace_keys SET wrapped_dek = ?, updated = ? WHERE workspace_id = ?')
      .bind(wrappedDek, now, workspaceId)
      .run();
  } else {
    await db
      .prepare('INSERT INTO sync_workspace_keys (workspace_id, owner_user_id, wrapped_dek, updated) VALUES (?, ?, ?, ?)')
      .bind(workspaceId, session.user_id, wrappedDek, now)
      .run();
  }

  // Optional encrypted workspace-name record — stored like any other record (ciphertext only, S25).
  if (body.name !== undefined) {
    if (!validRecord(body.name)) return json({ error: 'name must be an encrypted record.' }, 400);
    await upsertRecord(db, bucket, workspaceId, body.name as IncomingRecord, await maxSeq(db, workspaceId));
  }

  // S25: identity/ownership metadata only — no name, no trade field.
  return json({ workspace_id: workspaceId, created_at: createdAt });
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
    .prepare('SELECT * FROM sync_workspaces WHERE owner_user_id = ? ORDER BY created_at')
    .bind(session.user_id)
    .all<SyncWorkspaceRow>();
  const workspaces = [];
  for (const w of results) {
    const key = await db
      .prepare('SELECT * FROM sync_workspace_keys WHERE workspace_id = ?')
      .bind(w.workspace_id)
      .first<SyncWorkspaceKeyRow>();
    // S25: ids + created_at + the opaque wrapped DEK blob only — never a workspace name.
    workspaces.push({ workspace_id: w.workspace_id, created_at: w.created_at, wrapped_dek: key?.wrapped_dek ?? null });
  }
  return json({ workspaces });
}
