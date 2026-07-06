/**
 * POST /api/account/recover-send — start "lost your passkey?" recovery (F55).
 *
 * UNAUTHED (the caller has no passkey to sign in with). Takes { email } and ALWAYS responds with the
 * same generic 200 { ok:true } regardless of whether an account exists — no account enumeration. A
 * recovery link is emailed ONLY when a user with that VERIFIED email exists; the link carries a
 * single-use `recover` token that /api/account/recover-verify consumes.
 *
 * Fail closed: 503 { error:'email unavailable' } when RESEND_API_KEY is unbound (a config fact, not
 * an account fact — so it leaks nothing). Origin-checked (mutating). Rate limiting is defense-in-depth
 * only — enumeration-safety and single-use tokens are the real controls, never the fail-open limiter
 * (S22/S25).
 */
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { EMAIL_RE, badOrigin, checkOrigin, createRecoveryToken, dbUnavailable, getDb, readJson, userByEmail } from '../../_lib/accounts.ts';
import { emailUnavailable, recoverEmailBody, sendEmail } from '../../_lib/email.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (!env.RESEND_API_KEY) return emailUnavailable(); // config-level, identical for any email
  await rateLimited(env, 'acct-recover-send', request, 5, 300);

  const body = await readJson<{ email?: unknown }>(request);
  const email = String(body?.email ?? '')
    .trim()
    .toLowerCase();

  // Send only for a real, verified account — but the RESPONSE is identical either way.
  if (EMAIL_RE.test(email) && email.length <= 254) {
    const user = await userByEmail(db, email);
    if (user && user.email_verified) {
      const token = await createRecoveryToken(db, { userId: user.id, email: user.email, purpose: 'recover' });
      const origin = new URL(request.url).origin;
      const link = `${origin}/app/app.html?recover=${encodeURIComponent(token)}#account`;
      await sendEmail(env, { to: user.email, subject: 'Recover your Blotterbook account', html: recoverEmailBody(link) });
    }
  }
  return json({ ok: true }); // generic — never reveals whether the account exists
}
