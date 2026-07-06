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
  publicPasskey,
  publicUser,
  readSessionToken,
  sessionFromRequest,
  sessionSetCookie,
  subscriptionForUser,
  userById,
  type SubscriptionRow,
} from '../_lib/accounts.ts';

const ANON = { tier: 'local', cloudSync: false } as const;

// Dunning grace (F60): a past_due subscription keeps the cloud tier for this long after the
// failed-payment event (measured from the subscription row's `updated`) before cutoff. A few days
// covers Stripe's retry cadence so a transient card decline doesn't strand a paying user.
export const SUBSCRIPTION_GRACE_MS = 3 * 24 * 3600 * 1000;

/**
 * The LOCKED lapse policy (docs/synced-workspaces.md — period-end + grace): grant `cloud` while the
 * subscription is active/trialing, OR past_due inside the dunning grace window, OR still inside the
 * paid period after a cancel (now < current_period_end). Otherwise the tier is `local` — the local
 * IndexedDB data always remains, only cloud sync stops.
 */
function grantsCloud(sub: SubscriptionRow | null, now: number): boolean {
  if (!sub) return false;
  if (sub.status === 'active' || sub.status === 'trialing') return true;
  if (sub.status === 'past_due' && now < sub.updated + SUBSCRIPTION_GRACE_MS) return true;
  if (sub.current_period_end != null && now < sub.current_period_end) return true;
  return false;
}

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
