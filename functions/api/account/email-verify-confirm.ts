/**
 * GET|POST /api/account/email-verify-confirm?token=... — confirm an email address (F55).
 *
 * Consumes a single-use `verify` recovery token (hash-compared, TTL'd — S25), sets
 * users.email_verified = 1, and claims any UNCLAIMED donations keyed by that email (F54 claim path).
 *
 * Two entry shapes so the emailed link works with or without JS:
 *   - GET (the clickable email link): redirects (302) back to the app Account screen with a flag.
 *   - POST (client-driven, e.g. same-origin fetch): returns JSON { ok:true }.
 * The single-use capability token IS the auth here, so no session/Origin check is required (the
 * GET arrives cross-site from the mail client and carries no Origin).
 *
 * Fail closed: 503 when ACCOUNTS_DB is unbound.
 */
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  claimDonationsForUser,
  consumeRecoveryToken,
  dbUnavailable,
  getDb,
  readJson,
  setEmailVerified,
  userById,
} from '../../_lib/accounts.ts';

const APP_ACCOUNT = '/app/app.html';

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

  const row = await consumeRecoveryToken(db, token, 'verify');
  if (!row || !row.user_id) {
    return isGet
      ? redirect(`${url.origin}${APP_ACCOUNT}?verify=expired#account`)
      : json({ error: 'This verification link has expired or was already used.' }, 400);
  }

  const now = Date.now();
  await setEmailVerified(db, row.user_id);
  const user = await userById(db, row.user_id);
  if (user) await claimDonationsForUser(db, user, now); // F54: pull in donations that waited on verification

  return isGet ? redirect(`${url.origin}${APP_ACCOUNT}?verified=1#account`) : json({ ok: true });
}

export const onRequestGet = (ctx: Ctx) => confirm(ctx, true);
export const onRequestPost = (ctx: Ctx) => confirm(ctx, false);
