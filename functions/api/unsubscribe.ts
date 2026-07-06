/**
 * GET|POST /api/unsubscribe?token=... — one-click unsubscribe from changelog emails (F44).
 *
 * The per-recipient token is the auth (no login, no confirmation-page friction). Consuming a valid
 * token HARD-DELETES the row — the link IS the erasure request (A141 privacy posture). Idempotent and
 * enumeration-safe: an unknown/bad/already-removed token still answers success, so nothing is revealed.
 *   - GET (footer link + the mailto/link in every send): redirects (302) to the Blotterlog with a flag.
 *   - POST (RFC 8058 List-Unsubscribe-Post one-click): returns 200 — this is the shape Gmail/Yahoo POST.
 *
 * Fail closed: 503 when ACCOUNTS_DB is unbound.
 */
import { json } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';
import { dbUnavailable, getDb, readJson } from '../_lib/accounts.ts';
import { unsubscribeByToken } from '../_lib/subscribers.ts';

const CHANGELOG = '/changelog.html';

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

async function unsubscribe(ctx: Ctx, isGet: boolean) {
  const { request, env } = ctx;
  const db = getDb(env);
  if (!db) return dbUnavailable();

  const url = new URL(request.url);
  let token = url.searchParams.get('token') ?? '';
  if (!token && !isGet) {
    // List-Unsubscribe-Post carries `List-Unsubscribe=One-Click` (form-encoded), not the token — so
    // the token always rides in the URL; accept a JSON `{token}` too for same-origin fetch callers.
    const body = await readJson<{ token?: unknown }>(request);
    token = typeof body?.token === 'string' ? body.token : '';
  }

  await unsubscribeByToken(db, token); // idempotent — success regardless (no enumeration)
  return isGet ? redirect(`${url.origin}${CHANGELOG}?unsubscribed=1`) : json({ ok: true });
}

export const onRequestGet = (ctx: Ctx) => unsubscribe(ctx, true);
export const onRequestPost = (ctx: Ctx) => unsubscribe(ctx, false);
