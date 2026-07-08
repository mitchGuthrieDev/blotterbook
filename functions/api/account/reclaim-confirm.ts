/**
 * POST /api/account/reclaim-confirm — finish a proven-ownership email reclaim (A316).
 *
 * Body: { token }. Consumes a single-use `reclaim` recovery token (hash-compared, TTL'd — S25).
 * Clicking the emailed link proves the caller controls the inbox, so — provided the squatting
 * account is STILL never-verified — the squatter shell is deleted (explicit child cleanup; refused
 * for a workspace owner, whose R2 ciphertext needs the A305 pager) and a FRESH account is created
 * for the address with email_verified already set (the click IS the verification). The response is
 * fresh WebAuthn REGISTRATION options bound to that new user via a `register` challenge row, so the
 * client runs startRegistration() and posts to /api/account/register-verify — the standard
 * add-passkey path — which enrolls the first passkey and starts the session (mirrors recover-verify).
 *
 * If the caller abandons the passkey step, the pre-created account is not a dead end: its email is
 * verified, so the normal recovery flow (recover-send) can always reach it.
 *
 * Origin-checked (mutating); 503 without ACCOUNTS_DB; rate limiting defense-in-depth only (S22).
 */
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  badOrigin,
  checkOrigin,
  claimDonationsForUser,
  consumeRecoveryToken,
  createUser,
  dbUnavailable,
  deleteUserAccount,
  getDb,
  ownsSyncWorkspaces,
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
  if (await rateLimited(env, 'acct-reclaim-confirm', request, 5, 300))
    return json({ error: 'Too many attempts — try again shortly.' }, 429);

  const body = await readJson<{ token?: unknown }>(request);
  const token = typeof body?.token === 'string' ? body.token : '';
  const row = await consumeRecoveryToken(db, token, 'reclaim');
  if (!row || !row.user_id) return json({ error: 'This reclaim link has expired or was already used — request a new one.' }, 400);

  const squatter = await userById(db, row.user_id);
  // The squatter verified (or deleted) their account between send and confirm — the address is no
  // longer reclaimable; the legitimate-holder protections win.
  if (!squatter || squatter.email_verified) return json({ error: 'This email is no longer eligible for reclaim.' }, 400);
  // A workspace-owning holder's R2 data can't be cleaned by a bare D1 delete (A305) — refuse the
  // automatic path (this state requires a cloud subscription on a never-verified account; contact).
  if (await ownsSyncWorkspaces(db, squatter.id)) {
    return json({ error: 'This email cannot be reclaimed automatically — contact support.' }, 409);
  }

  await deleteUserAccount(db, squatter.id);

  // The clicked link proves inbox ownership → the fresh account starts verified, and any unclaimed
  // donations sent under this email sweep in (mirrors recover-verify's post-proof steps).
  const user = await createUser(db, row.email);
  if (!user) return json({ error: 'An account with that email already exists — log in instead.' }, 409); // lost a re-register race
  await setEmailVerified(db, user.id);
  await claimDonationsForUser(db, user, Date.now());

  const { rpID, rpName } = rpFrom(request, env);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    attestationType: 'none',
    // A310: UV required — every Blotterbook passkey doubles as a cloud-sync PRF key (UV-capable).
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  // Bind the first-passkey challenge to the new user → register-verify enrolls it + starts a session.
  await putChallenge(db, { type: 'register', challenge: options.challenge, userId: user.id, email: user.email });
  return json({ options });
}
