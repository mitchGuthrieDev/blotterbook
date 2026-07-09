/**
 * POST /api/account/reclaim-send — start a proven-ownership email RECLAIM (A316).
 *
 * The squatting problem: anonymous registration binds any email with no proof of ownership, so an
 * account that never verifies its address blocks the REAL inbox owner from both signup (409) and
 * recovery (recover-send only emails verified addresses). This endpoint is the pre-TTL escape hatch:
 * the visitor who hit the reclaimable 409 asks for a magic link, and clicking it (reclaim-confirm)
 * proves inbox ownership.
 *
 * UNAUTHED. Takes { email } and ALWAYS responds with the same generic 200 { ok:true } — like
 * recover-send, this path must not become an enumeration oracle (the reclaim link is emailed ONLY
 * when a NEVER-VERIFIED account holds the address; a verified holder or a free email sends nothing).
 * Fail closed: 503 when RESEND_API_KEY is unbound (a config fact, not an account fact). Origin-checked
 * (mutating). Rate limiting is defense-in-depth only — enumeration-safety and single-use tokens are
 * the real controls, never the fail-open limiter (S22/S25).
 */
import { ARCHIVED, archivedResponse } from '../../_lib/archive.ts';
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { EMAIL_RE, badOrigin, checkOrigin, createRecoveryToken, dbUnavailable, getDb, readJson, userByEmail } from '../../_lib/accounts.ts';
import { emailUnavailable, reclaimEmailBody, sendEmail } from '../../_lib/email.ts';

export async function onRequestPost(ctx: Ctx) {
  // ARCHIVE FREEZE (docs/archive-freeze.md): reclaim exists only to seed a NEW account, so it's
  // frozen unconditionally; reclaim-confirm is left alone (any in-flight token just fails naturally).
  if (ARCHIVED) return archivedResponse();
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (!env.RESEND_API_KEY) return emailUnavailable(); // config-level, identical for any email
  if (await rateLimited(env, 'acct-reclaim-send', request, 5, 300)) return json({ error: 'Too many attempts — try again shortly.' }, 429);

  const body = await readJson<{ email?: unknown }>(request);
  const email = String(body?.email ?? '')
    .trim()
    .toLowerCase();

  // Send only when a never-verified account holds the address — the RESPONSE is identical either way.
  if (EMAIL_RE.test(email) && email.length <= 254) {
    const holder = await userByEmail(db, email);
    if (holder && !holder.email_verified) {
      const token = await createRecoveryToken(db, { userId: holder.id, email: holder.email, purpose: 'reclaim' });
      const origin = new URL(request.url).origin;
      const link = `${origin}/app/app.html?reclaim=${encodeURIComponent(token)}#account`;
      await sendEmail(env, { to: holder.email, subject: 'Reclaim your email for Blotterbook', html: reclaimEmailBody(link) });
    }
  }
  return json({ ok: true }); // generic — never reveals whether/how the address is held
}
