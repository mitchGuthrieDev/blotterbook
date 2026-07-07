/**
 * POST /api/account/register-options — start a passkey REGISTRATION ceremony (F53).
 *
 * Two modes:
 *  - anonymous + { email }: new-account flow — validates the email, rejects an already-registered
 *    address (409), and holds the email server-side on the challenge row (never re-trusted from
 *    the client at verify time).
 *  - authed (session cookie): add-another-passkey flow — no email needed; existing credentials
 *    are excluded so the same authenticator can't be enrolled twice.
 *
 * Returns { options } for @simplewebauthn/browser's startRegistration({ optionsJSON }).
 * Fail-closed 503 without ACCOUNTS_DB; Origin-checked (mutating route); rate limiting is
 * defense-in-depth only (S22 — correctness never depends on it).
 */
import { generateRegistrationOptions } from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  badOrigin,
  checkOrigin,
  credentialsForUser,
  dbUnavailable,
  getDb,
  parseTransports,
  putChallenge,
  readJson,
  rpFrom,
  sessionFromRequest,
  userByEmail,
  userById,
} from '../../_lib/accounts.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (await rateLimited(env, 'acct-reg-opt', request, 10, 60)) return json({ error: 'Too many attempts — try again shortly.' }, 429);

  const session = await sessionFromRequest(request, db);
  const user = session ? await userById(db, session.user_id) : null;

  let email: string;
  if (user) {
    email = user.email; // add-another-passkey: identity comes from the session, not the body
  } else {
    const body = await readJson<{ email?: unknown }>(request);
    email = String(body?.email ?? '')
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'A valid email address is required.' }, 400);
    // S26(1): this 409 ACCEPTS account-existence enumeration on the signup path — a by-design
    // tradeoff for standard passwordless-signup UX (tell the visitor immediately to log in instead
    // of silently proceeding into a dead-end registration). recover-send stays deliberately
    // enumeration-safe (always 200) since THAT path is the one an attacker would use to probe emails
    // at scale; this one requires attempting a real registration per guess.
    if (await userByEmail(db, email)) return json({ error: 'An account with that email already exists — log in instead.' }, 409);
  }

  const existing = user ? await credentialsForUser(db, user.id) : [];
  const { rpID, rpName } = rpFrom(request, env);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: email,
    attestationType: 'none',
    excludeCredentials: existing.map(c => ({ id: c.id, transports: parseTransports(c.transports) as AuthenticatorTransportFuture[] })),
    // Discoverable credential required — login is usernameless (no email prompt on login).
    // A310: user verification required — every passkey doubles as the cloud-sync PRF key (UV-capable).
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await putChallenge(db, { type: 'register', challenge: options.challenge, userId: user?.id ?? null, email });
  return json({ options });
}
