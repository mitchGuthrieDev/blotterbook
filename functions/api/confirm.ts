/**
 * GET|POST /api/confirm?token=... — confirm a changelog-email subscription (double opt-in, F44).
 *
 * Consumes the single-use confirm link (hash-compared; pending → confirmed) minted by /api/subscribe.
 * Two entry shapes so the emailed link works with or without JS:
 *   - GET (the clickable email link): redirects (302) to the Blotterlog page with a flag banner.
 *   - POST (same-origin fetch): returns JSON { ok:true }.
 * The single-use capability token IS the auth here (the GET arrives cross-site from the mail client
 * and carries no Origin), so no session/Origin check. Already-confirmed links are idempotent successes.
 *
 * Fail closed: 503 when ACCOUNTS_DB is unbound.
 */
import { json } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';
import { dbUnavailable, getDb, readJson } from '../_lib/accounts.ts';
import { confirmSubscriber } from '../_lib/subscribers.ts';

const CHANGELOG = '/changelog.html';

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

async function confirm(ctx: Ctx, isGet: boolean) {
  const { request, env } = ctx;
  const db = getDb(env);
  if (!db) return dbUnavailable();

  const url = new URL(request.url);
  let token = url.searchParams.get('token') ?? '';
  if (!token && !isGet) {
    const body = await readJson<{ token?: unknown }>(request);
    token = typeof body?.token === 'string' ? body.token : '';
  }

  const row = await confirmSubscriber(db, token);
  if (!row) {
    return isGet
      ? redirect(`${url.origin}${CHANGELOG}?subscribe=error`)
      : json({ error: 'This confirmation link has expired or was already used.' }, 400);
  }
  return isGet ? redirect(`${url.origin}${CHANGELOG}?subscribed=1`) : json({ ok: true });
}

export const onRequestGet = (ctx: Ctx) => confirm(ctx, true);
export const onRequestPost = (ctx: Ctx) => confirm(ctx, false);
