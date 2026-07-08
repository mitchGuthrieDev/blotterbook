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
 * derived server-side from D1 only — the subscription row the signature-verified webhook wrote, OR a
 * live admin entitlement override (A276) — via hasCloudEntitlement (A277). Identity +
 * entitlements only — trade data never appears in this response (S25). Read-only GET → no Origin
 * check needed.
 */
import { json } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';
import {
  credentialsForUser,
  getDb,
  hasCloudEntitlement,
  publicPasskey,
  publicSubscription,
  publicUser,
  readSessionToken,
  sessionFromRequest,
  sessionSetCookie,
  subscriptionForUser,
  userById,
} from '../_lib/accounts.ts';

// The cloud-entitlement resolver + its grace window live in _lib/accounts.ts (A253/A277 — hasCloudEntitlement
// is the ONE choke point shared by /api/me AND the /api/sync/* mutating routes, so the server is the single
// source of truth: a paid subscription OR a live admin override grants `cloud`). Re-exported here so existing
// importers (scripts/test-accounts.mjs) keep resolving the grace window from this module unchanged.
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
    const cloud = await hasCloudEntitlement(db, user.id); // A277 — subscription OR live admin override, one choke point
    // A333: billing summary (status/period-end/cancel-scheduled — no Stripe ids) so the client can
    // render Cancel/Resume. NULL for override-comped users, so the cancel UI never shows for them.
    const subscription = publicSubscription(await subscriptionForUser(db, user.id));
    const token = readSessionToken(ctx.request); // the caller's own token, re-issued with a fresh Max-Age
    return json(
      { tier: cloud ? 'cloud' : 'local', cloudSync: cloud, user: publicUser(user), passkeys, subscription },
      200,
      token ? { 'Set-Cookie': sessionSetCookie(token) } : {}
    );
  } catch (_) {
    return json(ANON); // a D1 hiccup must never break the entitlements probe
  }
}
