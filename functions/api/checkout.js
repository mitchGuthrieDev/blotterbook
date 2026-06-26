/**
 * POST /api/checkout — create a Stripe Checkout session.
 *
 * SCAFFOLD: not implemented. Sketch of the intended flow:
 *
 *   export async function onRequestPost({ request, env }) {
 *     const { plan } = await request.json(); // "one_time" | "subscription"
 *     const price = plan === 'subscription'
 *       ? env.STRIPE_PRICE_SUBSCRIPTION
 *       : env.STRIPE_PRICE_ONE_TIME;
 *     // call Stripe (REST via fetch — no SDK needed on Workers) to create a
 *     // Checkout Session for `price`, then return { url } to redirect to.
 *   }
 *
 * Needs env: STRIPE_SECRET_KEY, STRIPE_PRICE_ONE_TIME, STRIPE_PRICE_SUBSCRIPTION.
 *
 * SECURITY (S13) when implementing: authenticate the caller first, and resolve the price
 * ID ONLY from env.STRIPE_PRICE_* server-side (map the client's plan name to it) — never
 * accept a client-supplied price/amount, so a caller can't choose what they're charged.
 */
import { json } from '../_lib/http.js';

export function onRequestPost() {
  return json({ error: 'not_implemented', message: 'Checkout is not wired up yet.' }, 501);
}
