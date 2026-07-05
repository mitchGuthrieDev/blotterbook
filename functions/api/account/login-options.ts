/**
 * POST /api/account/login-options — start a passkey LOGIN (assertion) ceremony (F53).
 *
 * Usernameless/discoverable-credential flow: no email prompt — allowCredentials is omitted so
 * the browser offers whichever Blotterbook passkeys it holds. The generated challenge is stored
 * single-use + TTL'd (S25) and matched at verify time via the response's clientDataJSON.
 *
 * Returns { options } for @simplewebauthn/browser's startAuthentication({ optionsJSON }).
 * Fail-closed 503 without ACCOUNTS_DB; Origin-checked; rate limiting defense-in-depth only.
 */
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import { badOrigin, checkOrigin, dbUnavailable, getDb, putChallenge, rpFrom } from '../../_lib/accounts.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (await rateLimited(env, 'acct-login-opt', request, 20, 60)) return json({ error: 'Too many attempts — try again shortly.' }, 429);

  const { rpID } = rpFrom(request, env);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
  await putChallenge(db, { type: 'login', challenge: options.challenge });
  return json({ options });
}
