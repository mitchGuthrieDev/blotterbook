/**
 * POST /api/subscription/create — start an IN-APP cloud-tier subscription (A278).
 *
 * Replaces the hosted-Checkout redirect for the common path: creates (or resumes) an INCOMPLETE
 * Stripe subscription for the logged-in caller and returns `{ clientSecret, publishableKey }` so
 * the client mounts the Payment Element and confirms the first invoice's PaymentIntent in place
 * (3DS included, `redirect: 'if_required'`). This endpoint NEVER grants the tier — the
 * signature-verified webhook (customer.subscription.updated → active) remains the only writer of
 * the `subscriptions` row (S11/F60), and the client just polls /api/me until it flips.
 *
 * Safety rails:
 *  - session-authed (a subscription always belongs to an account — unlike anonymous donations);
 *  - price resolved ONLY from env.STRIPE_PRICE_SUBSCRIPTION (S13 — the client never picks a price);
 *  - customer reuse-before-create (users.stripe_customer_id) + a Stripe Idempotency-Key keyed by
 *    user id, so double-submits can't mint duplicate customers/subscriptions;
 *  - an existing INCOMPLETE subscription is resumed (its PaymentIntent secret is returned) rather
 *    than creating a second one; an already-active subscriber gets `{ alreadySubscribed: true }`;
 *  - fail closed: 503 without ACCOUNTS_DB, 501 without the Stripe env trio, Origin-checked.
 *
 * Hosted Checkout (/api/checkout) stays as the fallback for iframe/script-blocked clients.
 */
import { ARCHIVED, archivedResponse } from '../../_lib/archive.ts';
import { json } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  badOrigin,
  checkOrigin,
  dbUnavailable,
  getDb,
  grantsCloud,
  sessionFromRequest,
  subscriptionForUser,
  userById,
} from '../../_lib/accounts.ts';

interface StripePaymentIntent {
  client_secret?: string;
}
interface StripeInvoice {
  payment_intent?: StripePaymentIntent | string | null;
  /** 2025+ Stripe API versions expose the confirmable secret here instead (invoice→PI decoupling). */
  confirmation_secret?: { client_secret?: string } | null;
}
interface StripeSubscription {
  id: string;
  status?: string;
  latest_invoice?: StripeInvoice | string | null;
}

/** Pull the confirmable client secret out of a subscription's expanded latest invoice, tolerating
 *  both the classic `latest_invoice.payment_intent.client_secret` shape and the newer
 *  `latest_invoice.confirmation_secret.client_secret` (API-version drift — mirrors the
 *  current_period_end note in webhook.ts). */
function clientSecretOf(sub: StripeSubscription | null): string | null {
  const inv = sub?.latest_invoice;
  if (!inv || typeof inv === 'string') return null;
  const pi = inv.payment_intent;
  if (pi && typeof pi === 'object' && typeof pi.client_secret === 'string') return pi.client_secret;
  const cs = inv.confirmation_secret;
  if (cs && typeof cs.client_secret === 'string') return cs.client_secret;
  return null;
}

const STRIPE = 'https://api.stripe.com/v1';

async function stripeReq(
  env: { STRIPE_SECRET_KEY?: string },
  path: string,
  init: { method?: string; body?: URLSearchParams; idem?: string }
) {
  const res = await fetch(`${STRIPE}${path}`, {
    method: init.method ?? 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(init.idem ? { 'Idempotency-Key': init.idem } : {}),
    },
    body: init.body?.toString(),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, data };
}

export async function onRequestPost(ctx: Ctx) {
  // ARCHIVE FREEZE (docs/archive-freeze.md): starting a NEW subscription is frozen unconditionally;
  // subscription/cancel.ts + webhook.ts stay live for existing subscribers.
  if (ARCHIVED) return archivedResponse();
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_SUBSCRIPTION || !env.STRIPE_PUBLISHABLE_KEY) {
    return json({ error: 'In-app subscription is not configured.', code: 'not_configured' }, 501);
  }

  const session = await sessionFromRequest(request, db);
  if (!session) return json({ error: 'Sign in to subscribe.', code: 'auth_required' }, 401);
  const user = await userById(db, session.user_id);
  if (!user) return json({ error: 'Sign in to subscribe.', code: 'auth_required' }, 401);

  // Already entitled via a qualifying subscription → nothing to create.
  const existing = await subscriptionForUser(db, user.id);
  if (grantsCloud(existing, Date.now())) return json({ alreadySubscribed: true });

  // Resume an in-flight INCOMPLETE subscription instead of minting a second one (Stripe expires an
  // unpaid incomplete subscription after ~23h, so this window is short and safe to resume).
  if (existing?.status === 'incomplete' && existing.stripe_subscription_id) {
    const { ok, data } = await stripeReq(
      env,
      `/subscriptions/${existing.stripe_subscription_id}?expand[]=latest_invoice.payment_intent&expand[]=latest_invoice.confirmation_secret`,
      { method: 'GET' }
    );
    const secret = ok ? clientSecretOf(data as StripeSubscription | null) : null;
    if (secret) return json({ clientSecret: secret, publishableKey: env.STRIPE_PUBLISHABLE_KEY });
    // fall through — expired/unusable; create fresh below
  }

  try {
    // Customer: reuse-before-create, persisted for the webhook's three-way account resolution.
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const form = new URLSearchParams();
      if (user.email) form.set('email', user.email);
      form.set('metadata[client_reference_id]', user.id);
      const { ok, data } = await stripeReq(env, '/customers', { body: form, idem: `cust-create:${user.id}` });
      customerId = ok && typeof data?.id === 'string' ? (data.id as string) : null;
      if (!customerId) return json({ error: 'Could not start the subscription.', code: 'subscription_failed' }, 502);
      // Inline persist (accounts.ts owns no setter for this yet; applyDonationToUser writes the same column).
      await db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(customerId, user.id).run();
    }

    const form = new URLSearchParams();
    form.set('customer', customerId);
    form.set('items[0][price]', env.STRIPE_PRICE_SUBSCRIPTION);
    form.set('payment_behavior', 'default_incomplete');
    form.set('payment_settings[save_default_payment_method]', 'on_subscription');
    form.set('expand[]', 'latest_invoice.payment_intent');
    form.append('expand[]', 'latest_invoice.confirmation_secret');
    // The webhook resolves the account from the subscription's OWN metadata (order-independent —
    // same rationale as checkout.ts's subscription_data.metadata stamp).
    form.set('metadata[client_reference_id]', user.id);
    const { ok, data } = await stripeReq(env, '/subscriptions', { body: form, idem: `sub-create:${user.id}` });
    const secret = ok ? clientSecretOf(data as StripeSubscription | null) : null;
    if (!secret) return json({ error: 'Could not start the subscription.', code: 'subscription_failed' }, 502);
    return json({ clientSecret: secret, publishableKey: env.STRIPE_PUBLISHABLE_KEY });
  } catch (_) {
    return json({ error: 'Could not reach the payment provider.', code: 'subscription_failed' }, 502);
  }
}
