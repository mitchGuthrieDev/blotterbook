/**
 * POST /api/account/logout — revoke the current session (F53).
 *
 * Deletes the session row named by the cookie (DB sessions are revocable — the whole point of
 * not using JWTs) and expires the cookie. Idempotent: a missing/garbage cookie still returns
 * ok + a cleared cookie. Fail-closed 503 without ACCOUNTS_DB; Origin-checked (mutating route).
 */
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { badOrigin, checkOrigin, dbUnavailable, destroySession, getDb, sessionClearCookie } from '../../_lib/accounts.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (await rateLimited(env, 'acct-logout', request, 30, 60)) return json({ error: 'Too many attempts — try again shortly.' }, 429);

  await destroySession(request, db);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionClearCookie() });
}
