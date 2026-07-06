/**
 * POST /api/subscribe — sign up for changelog (Blotterlog) release-note emails (F44).
 *
 * Same-origin form on /changelog.html. Double opt-in: writes a `pending` subscriber and emails a
 * confirm link — NOTHING beyond that one confirmation mail is sent until the address is confirmed.
 * Enumeration-safe: every non-error outcome (new signup, already-pending, already-confirmed) returns
 * the SAME generic 200, so the response never reveals whether an address is on the list.
 *
 * Abuse controls are defense-in-depth ONLY (S22): Turnstile (skipped when unconfigured, fails open
 * when the service is down) + a per-address D1 cooldown on confirm-mail re-sends. The real invariants
 * are the double opt-in and the confirmed-only broadcast — never these.
 *
 * Fail closed: 503 (ACCOUNTS_DB shape) when the DB is unbound; 503 { error:'email unavailable' } when
 * RESEND_API_KEY is unbound; 403 cross-origin; 400 on a malformed email.
 */
import { json } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';
import { badOrigin, checkOrigin, dbUnavailable, getDb, readJson } from '../_lib/accounts.ts';
import {
  canResend,
  createSubscriber,
  normalizeEmail,
  purgePending,
  refreshConfirmToken,
  subscriberByEmail,
  verifyTurnstile,
} from '../_lib/subscribers.ts';
import { confirmSubscriptionBody, emailUnavailable, sendEmail } from '../_lib/email.ts';

// One generic body for every non-error outcome (no enumeration).
const GENERIC_OK = { ok: true, message: 'Check your inbox for a confirmation link.' };

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();

  const body = await readJson<{ email?: unknown; turnstileToken?: unknown }>(request);
  const email = normalizeEmail(body?.email);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400);

  // Defense-in-depth (S22): Turnstile is skipped when unconfigured and fails open on a service outage.
  const ip = request.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(env, body?.turnstileToken, ip))) return json({ error: 'Verification failed. Please try again.' }, 400);

  if (!env.RESEND_API_KEY) return emailUnavailable(); // fail closed BEFORE writing/minting anything

  await purgePending(db); // opportunistic sweep of stale unconfirmed signups (no cron)

  const existing = await subscriberByEmail(db, email);
  const origin = new URL(request.url).origin;

  if (existing?.status === 'confirmed') return json(GENERIC_OK); // already subscribed — silent no-op

  let confirmToken: string | null = null;
  if (!existing) {
    ({ confirmToken } = await createSubscriber(db, email));
  } else if (canResend(existing)) {
    confirmToken = await refreshConfirmToken(db, existing); // pending re-signup, past the cooldown
  }
  // else: pending + within cooldown → send nothing, still return the generic body.

  if (confirmToken) {
    const link = `${origin}/api/confirm?token=${encodeURIComponent(confirmToken)}`;
    const r = await sendEmail(env, {
      to: email,
      subject: 'Confirm your Blotterbook updates',
      html: confirmSubscriptionBody(link),
    });
    if (!r.ok) return r.unavailable ? emailUnavailable() : json({ error: 'Could not send the confirmation email.' }, 502);
  }
  return json(GENERIC_OK);
}
