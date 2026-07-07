/**
 * POST /api/account/email-verify-send — email the signed-in user a single-use verification link (F55).
 *
 * Authed (session cookie) + Origin-checked (mutating route). Creates a `verify` recovery_token
 * (SHA-256(secret) stored, ~15 min TTL, single-use) and emails a link to the account's own email.
 * Confirming it (GET/POST /api/account/email-verify-confirm) sets users.email_verified = 1 and
 * claims any unclaimed donations keyed by that email (F54).
 *
 * Fail closed: 503 { error:'email unavailable' } when RESEND_API_KEY is unbound; 503 (ACCOUNTS_DB
 * shape) when the DB is unbound; 401 when not signed in. Rate limiting is defense-in-depth only —
 * security never depends on the fail-open limiter (S22/S25).
 */
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { badOrigin, checkOrigin, createRecoveryToken, dbUnavailable, getDb, sessionFromRequest, userById } from '../../_lib/accounts.ts';
import { emailUnavailable, sendEmail, verifyEmailBody } from '../../_lib/email.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (await rateLimited(env, 'acct-verify-send', request, 5, 300)) return json({ error: 'Too many attempts — try again shortly.' }, 429);

  const session = await sessionFromRequest(request, db);
  const user = session ? await userById(db, session.user_id) : null;
  if (!user) return json({ error: 'Not signed in.' }, 401);
  if (user.email_verified) return json({ ok: true, alreadyVerified: true });

  if (!env.RESEND_API_KEY) return emailUnavailable(); // fail closed BEFORE minting a token

  const token = await createRecoveryToken(db, { userId: user.id, email: user.email, purpose: 'verify' });
  const origin = new URL(request.url).origin;
  const link = `${origin}/api/account/email-verify-confirm?token=${encodeURIComponent(token)}`;
  const r = await sendEmail(env, { to: user.email, subject: 'Verify your Blotterbook email', html: verifyEmailBody(link) });
  if (!r.ok) return r.unavailable ? emailUnavailable() : json({ error: 'Could not send the verification email.' }, 502);
  return json({ ok: true });
}
