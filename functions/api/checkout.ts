/**
 * POST /api/checkout — create a Stripe Checkout session (Accounts Phase 2, F54).
 *
 * Body: { plan?: 'one_time' | 'subscription' }. The price is resolved ONLY from env.STRIPE_PRICE_*
 * server-side (S13) — a client can never choose what it's charged. When the caller has a valid
 * session cookie we pass `client_reference_id = <user id>` so the webhook can credit the donation
 * to that exact account (the trusted linkage path — no email guessing). Anonymous callers still get
 * a session; their donation is claimed later by verified email (F55).
 *
 * Fail closed: 501 when STRIPE_SECRET_KEY or the matching price is unset; Origin-checked (mutating).
 * Stripe is called over the REST API via fetch() — no SDK on Workers.
 */
import { json } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';
import { badOrigin, checkOrigin, getDb, readJson, sessionFromRequest } from '../_lib/accounts.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (!checkOrigin(request)) return badOrigin();
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'not_configured', message: 'Payments are not configured.' }, 501);

  const body = await readJson<{ plan?: unknown }>(request);
  const plan = body?.plan === 'subscription' ? 'subscription' : 'one_time';
  const price = plan === 'subscription' ? env.STRIPE_PRICE_SUBSCRIPTION : env.STRIPE_PRICE_ONE_TIME;
  if (!price) return json({ error: 'not_configured', message: 'No price is configured for that plan.' }, 501);

  // Link to a logged-in account when there's a session (donations DB is optional here).
  let clientRef = '';
  const db = getDb(env);
  if (db) {
    const session = await sessionFromRequest(request, db);
    if (session) clientRef = session.user_id;
  }

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams();
  form.set('mode', plan === 'subscription' ? 'subscription' : 'payment');
  form.set('line_items[0][price]', price);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', `${origin}/app/app.html?donated=1#account`);
  form.set('cancel_url', `${origin}/#pricing`);
  if (clientRef) form.set('client_reference_id', clientRef);
  // For a SUBSCRIPTION, also stamp the user id into the subscription's OWN metadata: client_reference_id
  // rides only on the checkout SESSION, but the cloud grant is driven by the customer.subscription.*
  // events, whose objects don't carry it. Putting it in subscription_data.metadata lets the webhook
  // resolve the account directly from those events — order-independent, and works for $0/trial signups
  // where the donation-credit linkage (which needs a positive USD charge) never fires.
  if (plan === 'subscription' && clientRef) form.set('subscription_data[metadata][client_reference_id]', clientRef);

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = (await res.json().catch(() => null)) as { url?: string } | null;
    if (!res.ok || !data?.url) return json({ error: 'checkout_failed', message: 'Could not create a checkout session.' }, 502);
    return json({ url: data.url });
  } catch (_) {
    return json({ error: 'checkout_failed', message: 'Could not reach the payment provider.' }, 502);
  }
}
