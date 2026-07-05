/**
 * POST /api/account/login-verify — finish a passkey LOGIN (assertion) ceremony (F53).
 *
 * Body: { response } — the AuthenticationResponseJSON from startAuthentication(). The pending
 * challenge is located via the response's clientDataJSON and consumed SINGLE-USE (S25) before
 * any signature work; the assertion is verified against the stored credential's public key,
 * the signature counter is bumped, and a fresh session cookie is set.
 *
 * Fail-closed 503 without ACCOUNTS_DB; Origin-checked; rate limiting defense-in-depth only.
 */
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  b64uToBytes,
  badOrigin,
  challengeFromClientData,
  checkOrigin,
  consumeChallenge,
  createSession,
  credentialById,
  dbUnavailable,
  getDb,
  parseTransports,
  publicUser,
  readJson,
  rpFrom,
  sessionSetCookie,
  touchCredential,
  userById,
} from '../../_lib/accounts.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (await rateLimited(env, 'acct-login-ver', request, 20, 60)) return json({ error: 'Too many attempts — try again shortly.' }, 429);

  const body = await readJson<{ response?: AuthenticationResponseJSON }>(request);
  const response = body?.response;
  if (!response || typeof response !== 'object' || typeof response.id !== 'string')
    return json({ error: 'Missing WebAuthn response.' }, 400);

  const challenge = challengeFromClientData(response.response?.clientDataJSON);
  if (!challenge) return json({ error: 'Malformed WebAuthn response.' }, 400);
  const pending = await consumeChallenge(db, challenge, 'login'); // single-use — gone after this line
  if (!pending) return json({ error: 'This login attempt expired or was already used — try again.' }, 400);

  const cred = await credentialById(db, response.id);
  if (!cred) return json({ error: 'That passkey is not registered here.' }, 401);

  const { rpID, origin } = rpFrom(request, env);
  let newCounter: number | null = null;
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.id,
        publicKey: b64uToBytes(cred.public_key),
        counter: cred.counter,
        transports: parseTransports(cred.transports) as AuthenticatorTransportFuture[],
      },
      requireUserVerification: false,
    });
    if (v.verified) newCounter = v.authenticationInfo.newCounter;
  } catch (_) {
    /* malformed/forged assertion — fall through to the rejection below */
  }
  if (newCounter == null) return json({ error: 'Passkey verification failed.' }, 401);

  const user = await userById(db, cred.user_id);
  if (!user) return json({ error: 'That passkey is not registered here.' }, 401);

  await touchCredential(db, cred.id, newCounter);
  const { token } = await createSession(db, user.id);
  return json({ ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': sessionSetCookie(token) });
}
