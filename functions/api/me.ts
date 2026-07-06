/**
 * GET /api/me — the current user's storage tier + (F53) account/session state.
 *
 * Contract (backwards-compatible with the pre-accounts stub):
 *  - anonymous / no ACCOUNTS_DB / bad or expired session →  { tier:'local', cloudSync:false }
 *    (exactly the old shape — Entitlements.current() keeps working unchanged)
 *  - valid session → tier is the REAL entitlement (F60): `cloud`/cloudSync:true when the user has an
 *    active/grace/within-period subscription, else `local`. Adds { user:{ email, emailVerified,
 *    donated, donatedAt, donationTotalCents, createdAt }, passkeys:[…] } and re-issues the caller's
 *    own cookie so the browser Max-Age tracks the slid (30-day sliding) expiry.
 *
 * SECURITY (S13/S25): the session is resolved server-side (hashed-secret compare in D1) before ANY
 * account data is returned — nothing is inferred from client-supplied values alone. The tier is
 * derived ONLY from the D1 subscription row the signature-verified webhook wrote. Identity +
 * entitlements only — trade data never appears in this response (S25). Read-only GET → no Origin
 * check needed.
 */
import { json } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';
import {
  credentialsForUser,
  getDb,
  grantsCloud,
  publicPasskey,
  publicUser,
  readSessionToken,
  sessionFromRequest,
  sessionSetCookie,
  subscriptionForUser,
  userById,
} from '../_lib/accounts.ts';

// The cloud-entitlement predicate + its grace window live in _lib/accounts.ts (A253 — shared by
// /api/me AND the /api/sync/* mutating routes so the server is the single source of truth). Re-exported
// here so existing importers (scripts/test-accounts.mjs) keep resolving it from this module unchanged.
export { SUBSCRIPTION_GRACE_MS } from '../_lib/accounts.ts';

const ANON = { tier: 'local', cloudSync: false } as const;

export async function onRequestGet(ctx: Ctx) {
  const db = getDb(ctx.env);
  if (!db) return json(ANON); // accounts not configured → same shape as logged-out (fail quiet, not crash)
  try {
    const session = await sessionFromRequest(ctx.request, db);
    if (!session) return json(ANON);
    const user = await userById(db, session.user_id);
    if (!user) return json(ANON);
    const passkeys = (await credentialsForUser(db, user.id)).map(publicPasskey);
    const cloud = grantsCloud(await subscriptionForUser(db, user.id), Date.now());
    const token = readSessionToken(ctx.request); // the caller's own token, re-issued with a fresh Max-Age
    return json(
      { tier: cloud ? 'cloud' : 'local', cloudSync: cloud, user: publicUser(user), passkeys },
      200,
      token ? { 'Set-Cookie': sessionSetCookie(token) } : {}
    );
  } catch (_) {
    return json(ANON); // a D1 hiccup must never break the entitlements probe
  }
}
