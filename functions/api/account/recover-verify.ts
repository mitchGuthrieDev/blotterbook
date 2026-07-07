/**
 * POST /api/account/recover-verify — consume a recovery token and start passkey re-enrollment (F55).
 *
 * Body: { token }. Consumes a single-use `recover` recovery token (hash-compared, TTL'd — S25),
 * then returns fresh WebAuthn REGISTRATION options BOUND to the recovered user via a new `register`
 * challenge row carrying that user's id. The client runs startRegistration() and posts the result to
 * /api/account/register-verify, which (seeing a user_id-bound challenge) enrolls the new passkey and
 * starts a session — the standard add-passkey path, reused for recovery. Existing credentials are
 * excluded so the same authenticator can't double-enroll.
 *
 * Recovery proves control of the (already-verified) email, so we (re)assert email_verified and claim
 * any unclaimed donations (F54). Origin-checked (mutating); 503 without ACCOUNTS_DB.
 */
import { generateRegistrationOptions } from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  badOrigin,
  checkOrigin,
  claimDonationsForUser,
  consumeRecoveryToken,
  credentialsForUser,
  dbUnavailable,
  getDb,
  parseTransports,
  putChallenge,
  readJson,
  rpFrom,
  setEmailVerified,
  userById,
} from '../../_lib/accounts.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (await rateLimited(env, 'acct-recover-verify', request, 5, 300)) return json({ error: 'Too many attempts — try again shortly.' }, 429);

  const body = await readJson<{ token?: unknown }>(request);
  const token = typeof body?.token === 'string' ? body.token : '';
  const row = await consumeRecoveryToken(db, token, 'recover');
  if (!row || !row.user_id) return json({ error: 'This recovery link has expired or was already used — request a new one.' }, 400);

  const user = await userById(db, row.user_id);
  if (!user) return json({ error: 'This recovery link is no longer valid.' }, 400);

  // Recovery reaches a verified inbox → (re)assert verification + pull in any unclaimed donations.
  await setEmailVerified(db, user.id);
  await claimDonationsForUser(db, user, Date.now());

  const existing = await credentialsForUser(db, user.id);
  const { rpID, rpName } = rpFrom(request, env);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    attestationType: 'none',
    excludeCredentials: existing.map(c => ({ id: c.id, transports: parseTransports(c.transports) as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  // Bind the new-passkey challenge to the recovered user → register-verify enrolls it + starts a session.
  await putChallenge(db, { type: 'register', challenge: options.challenge, userId: user.id, email: user.email });
  return json({ options });
}
