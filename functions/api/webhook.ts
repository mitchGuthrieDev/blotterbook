/**
 * POST /api/webhook — receive Stripe webhooks and provision donor status (Accounts Phase 2, F54).
 *
 * ORDERING IS THE SECURITY BOUNDARY (S11): the Stripe signature is verified over the RAW body
 * BEFORE any provisioning runs — a forged `checkout.session.completed` never credits anyone.
 * Only after verification do we act, and only on `checkout.session.completed`.
 *
 * Replay-safe dedupe: each event is recorded in `donations` keyed by the Stripe EVENT ID, so a
 * duplicated/replayed webhook (Stripe retries) collides on the PK and credits exactly once.
 *
 * Linkage — NEVER blindly trust the checkout email:
 *   - `client_reference_id` present + resolves to a user  → credit that user (it came from our own
 *     /api/checkout, set from the logged-in session — trusted).
 *   - else a user exists with a VERIFIED matching email    → credit that user.
 *   - else                                                 → store the donation UNCLAIMED, keyed by
 *     the lowercased checkout email; it is claimed later when that email is verified (F55).
 *
 * Fail closed: 501 until STRIPE_WEBHOOK_SECRET is set; 503 (same shape as the account endpoints)
 * when ACCOUNTS_DB is unbound — a verified event is never dropped silently, it is refused loudly.
 */
import { json } from '../_lib/http.ts';
import { verifyStripeSignature } from '../_lib/auth.ts';
import type { Ctx } from '../_lib/types.ts';
import { applyDonationToUser, dbUnavailable, donationById, getDb, insertDonation, userByEmail, userById } from '../_lib/accounts.ts';

interface CheckoutSession {
  amount_total?: unknown;
  currency?: unknown;
  customer?: unknown;
  customer_details?: { email?: unknown } | null;
  client_reference_id?: unknown;
}
interface StripeEvent {
  id?: unknown;
  type?: unknown;
  data?: { object?: CheckoutSession } | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export async function onRequestPost({ request, env }: Ctx) {
  // Read the RAW body first — the signature is computed over the exact bytes, not re-parsed JSON.
  const raw = await request.text();
  // Fail closed (S13): without the signing secret we cannot prove the event came from Stripe.
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: 'not_configured', message: 'Webhook secret not set.' }, 501);
  }
  const sig = request.headers.get('stripe-signature');
  if (!(await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: 'invalid_signature' }, 400);
  }

  // ── Signature verified — everything below is provisioning (S11 ordering preserved). ──
  const db = getDb(env);
  if (!db) return dbUnavailable(); // accounts DB unbound → refuse loudly, don't drop a real event

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch (_) {
    return json({ error: 'invalid_payload' }, 400);
  }

  const eventId = str(event.id);
  if (!eventId) return json({ error: 'invalid_payload', message: 'Missing event id.' }, 400);
  // Ack (200) unrelated events so Stripe stops retrying — we only provision on completed checkouts.
  if (event.type !== 'checkout.session.completed') {
    return json({ received: true, ignored: String(event.type ?? 'unknown') });
  }

  // Replay-safe dedupe: already processed this event id → no-op success.
  if (await donationById(db, eventId)) return json({ received: true, deduped: true });

  const obj = event.data?.object ?? {};
  const amountCents = typeof obj.amount_total === 'number' && Number.isFinite(obj.amount_total) ? obj.amount_total : 0;
  const currency = str(obj.currency);
  const customerId = str(obj.customer);
  const email = str(obj.customer_details?.email)?.toLowerCase() ?? null;
  const ref = str(obj.client_reference_id);

  // Resolve the account to credit — trusted linkage only.
  let creditUser = ref ? await userById(db, ref) : null;
  if (!creditUser && email) {
    const u = await userByEmail(db, email);
    if (u && u.email_verified) creditUser = u; // ONLY a verified email auto-credits
  }

  const now = Date.now();
  await insertDonation(
    db,
    {
      id: eventId,
      userId: creditUser?.id ?? null,
      email,
      amountCents,
      currency,
      stripeCustomerId: customerId,
      claimedAt: creditUser ? now : null,
    },
    now
  );
  if (creditUser) await applyDonationToUser(db, creditUser, amountCents, customerId, now);

  return json({ received: true, credited: !!creditUser });
}
