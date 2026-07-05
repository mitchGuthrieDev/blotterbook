/**
 * POST /api/account/register-verify — finish a passkey REGISTRATION ceremony (F53).
 *
 * Body: { response } — the RegistrationResponseJSON from startRegistration(). The pending
 * challenge is located via the response's own clientDataJSON and consumed SINGLE-USE (S25);
 * the attestation is then verified against it. New-account challenges (user_id NULL) insert
 * the user (email held server-side on the challenge row) + credential and start a session;
 * add-passkey challenges (user_id set) just attach the credential to that user.
 *
 * Fail-closed 503 without ACCOUNTS_DB; Origin-checked; rate limiting defense-in-depth only.
 */
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  b64u,
  badOrigin,
  challengeFromClientData,
  checkOrigin,
  consumeChallenge,
  createSession,
  createUser,
  credentialById,
  dbUnavailable,
  getDb,
  insertCredential,
  publicUser,
  readJson,
  rpFrom,
  sessionSetCookie,
  userByEmail,
  userById,
} from '../../_lib/accounts.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (await rateLimited(env, 'acct-reg-ver', request, 10, 60)) return json({ error: 'Too many attempts — try again shortly.' }, 429);

  const body = await readJson<{ response?: RegistrationResponseJSON }>(request);
  const response = body?.response;
  if (!response || typeof response !== 'object') return json({ error: 'Missing WebAuthn response.' }, 400);

  const challenge = challengeFromClientData(response.response?.clientDataJSON);
  if (!challenge) return json({ error: 'Malformed WebAuthn response.' }, 400);
  const pending = await consumeChallenge(db, challenge, 'register'); // single-use — gone after this line
  if (!pending) return json({ error: 'This registration attempt expired or was already used — start over.' }, 400);

  const { rpID, origin } = rpFrom(request, env);
  let info: Awaited<ReturnType<typeof verifyRegistrationResponse>>['registrationInfo'];
  try {
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false, // UV 'preferred' at options time — presence is still required
    });
    if (v.verified) info = v.registrationInfo;
  } catch (_) {
    /* malformed/forged attestation — fall through to the rejection below */
  }
  if (!info) return json({ error: 'Passkey verification failed.' }, 400);

  if (await credentialById(db, info.credential.id)) return json({ error: 'That passkey is already registered.' }, 409);

  // Resolve the account: an authed add-passkey challenge carries user_id; a new-account
  // challenge carries the (server-held) email.
  let user = pending.user_id ? await userById(db, pending.user_id) : null;
  if (!user) {
    const email = (pending.email ?? '').toLowerCase();
    if (!email) return json({ error: 'This registration attempt is no longer valid — start over.' }, 400);
    if (await userByEmail(db, email)) return json({ error: 'An account with that email already exists — log in instead.' }, 409);
    user = await createUser(db, email);
  }

  await insertCredential(db, {
    id: info.credential.id,
    userId: user.id,
    publicKey: b64u(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    aaguid: info.aaguid || null,
    backedUp: info.credentialBackedUp,
  });

  const { token } = await createSession(db, user.id);
  return json({ ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': sessionSetCookie(token) });
}
