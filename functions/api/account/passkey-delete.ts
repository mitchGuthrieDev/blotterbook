/**
 * POST /api/account/passkey-delete — remove one of the caller's passkeys (A302).
 *
 * Body: { id } — the base64url credential id to delete. Session-authed (server-side session
 * resolution), Origin-checked (mutating route), fail-closed 503 without ACCOUNTS_DB. The delete is
 * SCOPED to the caller (deleteCredentialForUser filters by user_id), so a request can never remove
 * another account's passkey; an id the caller doesn't own returns 404 (no cross-account enumeration).
 *
 * LOCKOUT GUARD: refuse to delete the user's LAST credential — passwordless login has no fallback, so
 * removing the only passkey would strand the account (recovery is a separate, email-gated path). The
 * user must enroll a replacement first. Deleting a stolen device's passkey while a good one remains is
 * exactly the stolen-device remediation this endpoint exists for.
 */
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  badOrigin,
  checkOrigin,
  credentialsForUser,
  dbUnavailable,
  deleteCredentialForUser,
  getDb,
  readJson,
  sessionFromRequest,
} from '../../_lib/accounts.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (await rateLimited(env, 'acct-passkey-del', request, 20, 60)) return json({ error: 'Too many attempts — try again shortly.' }, 429);

  const session = await sessionFromRequest(request, db);
  if (!session) return json({ error: 'Not signed in.' }, 401);

  const body = await readJson<{ id?: unknown }>(request);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return json({ error: 'A credential id is required.' }, 400);

  const creds = await credentialsForUser(db, session.user_id);
  if (!creds.some(c => c.id === id)) return json({ error: 'That passkey is not registered to this account.' }, 404);
  // Lockout guard: never remove the last passkey (would strand the account — recovery is separate).
  if (creds.length <= 1) return json({ error: 'You can’t remove your only passkey — add another first.' }, 400);

  const deleted = await deleteCredentialForUser(db, session.user_id, id);
  if (!deleted) return json({ error: 'That passkey is not registered to this account.' }, 404); // lost a race — still scoped
  return json({ ok: true });
}
