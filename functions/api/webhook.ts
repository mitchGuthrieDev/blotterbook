/**
 * POST /api/webhook — receive Stripe webhooks and provision accounts.
 *
 * SCAFFOLD: signature verification is wired (S13); account provisioning is not.
 * Remaining flow to implement on a verified `checkout.session.completed`:
 *   - one-time     -> entitlement "local"
 *   - subscription -> entitlement "cloud"
 *   - persist { email, tier } in D1/KV so /api/me can read it back.
 *
 * Needs env: STRIPE_WEBHOOK_SECRET (+ a D1 or KV binding for accounts).
 */
import { json } from '../_lib/http.ts';
import { verifyStripeSignature } from '../_lib/auth.ts';
import type { Ctx } from '../_lib/types.ts';

export async function onRequestPost({ request, env }: Ctx) {
  // Read the RAW body first — the signature is computed over the exact bytes, not re-parsed JSON.
  const raw = await request.text();
  // Fail closed (S13): without the signing secret we cannot prove the event came from
  // Stripe, so we never act on it — a forged checkout.session.completed must not grant a tier.
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: 'not_configured', message: 'Webhook secret not set.' }, 501);
  }
  const sig = request.headers.get('stripe-signature');
  if (!(await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: 'invalid_signature' }, 400);
  }
  // Signature verified — entitlement provisioning is still a scaffold.
  return json({ error: 'not_implemented', message: 'Webhook verified; provisioning is not wired up yet.' }, 501);
}
