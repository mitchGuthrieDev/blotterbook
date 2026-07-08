/**
 * POST /api/subscription/cancel — schedule (or undo) a cancellation of the caller's cloud
 * subscription (A333 self-serve cancel).
 *
 * Body: { resume?: boolean }. Default schedules the cancel: sets `cancel_at_period_end = true` on
 * the caller's Stripe subscription, so the paid period runs out naturally and Stripe emits
 * `customer.subscription.updated` now + `customer.subscription.deleted` at period end. With
 * `resume: true` it clears the flag while the subscription is still in-period. Either way the
 * response returns `{ cancelAtPeriodEnd, currentPeriodEnd }` for immediate UI feedback.
 *
 * Safety rails (mirrors subscription/create.ts):
 *  - session-authed + Origin-checked; fail closed — 503 without ACCOUNTS_DB, 501 without
 *    STRIPE_SECRET_KEY;
 *  - NEVER writes tier/status directly: the signature-verified webhook stays the only lifecycle
 *    writer (S11/F60). The one local write is the `cancel_at_period_end` display flag, updated
 *    optimistically so the UI reflects the change before the webhook round-trips (the
 *    subscription.updated event then confirms the same value; grantsCloud never reads the flag,
 *    so entitlement cannot drift from it);
 *  - errors follow the A326 convention: human sentence in `error`, machine code in `code`.
 */
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  badOrigin,
  checkOrigin,
  dbUnavailable,
  getDb,
  readJson,
  sessionFromRequest,
  subscriptionForUser,
  upsertSubscription,
  userById,
} from '../../_lib/accounts.ts';

/** Statuses a user can meaningfully schedule a cancel (or resume) on — an already-`canceled` or
 *  `incomplete` subscription has nothing to toggle. */
const CANCELABLE = new Set(['active', 'trialing', 'past_due']);

interface StripeSubResponse {
  cancel_at_period_end?: unknown;
  current_period_end?: unknown; // SECONDS (older API versions)
  items?: { data?: Array<{ current_period_end?: unknown }> } | null; // newer versions (mirrors webhook.ts)
}

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Subscription management is not configured.', code: 'not_configured' }, 501);

  const session = await sessionFromRequest(request, db);
  if (!session) return json({ error: 'Sign in to manage your subscription.', code: 'auth_required' }, 401);
  const user = await userById(db, session.user_id);
  if (!user) return json({ error: 'Sign in to manage your subscription.', code: 'auth_required' }, 401);

  const body = await readJson<{ resume?: unknown }>(request);
  const resume = body?.resume === true;

  const sub = await subscriptionForUser(db, user.id);
  if (!sub?.stripe_subscription_id || !CANCELABLE.has(sub.status ?? '')) {
    return json({ error: 'No active subscription to change.', code: 'no_subscription' }, 404);
  }

  try {
    const form = new URLSearchParams();
    form.set('cancel_at_period_end', resume ? 'false' : 'true');
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = (await res.json().catch(() => null)) as StripeSubResponse | null;
    if (!res.ok || typeof data?.cancel_at_period_end !== 'boolean') {
      return json({ error: 'Could not update the subscription — try again.', code: 'cancel_failed' }, 502);
    }
    // Optimistic display-flag update (see the header note — never tier/status). Keep the stored
    // period end fresh when Stripe returned one (same seconds→ms + API-shape tolerance as webhook.ts).
    const finiteSec = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const periodEndSec = finiteSec(data.current_period_end) ?? finiteSec(data.items?.data?.[0]?.current_period_end);
    const currentPeriodEnd = periodEndSec != null ? periodEndSec * 1000 : (sub.current_period_end ?? null);
    await upsertSubscription(db, {
      userId: user.id,
      stripeSubscriptionId: sub.stripe_subscription_id,
      stripeCustomerId: sub.stripe_customer_id,
      status: sub.status,
      currentPeriodEnd,
      cancelAtPeriodEnd: data.cancel_at_period_end,
    });
    return json({ cancelAtPeriodEnd: data.cancel_at_period_end, currentPeriodEnd });
  } catch (_) {
    return json({ error: 'Could not reach the payment provider.', code: 'cancel_failed' }, 502);
  }
}
