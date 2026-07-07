/**
 * POST /api/webhook — receive Stripe webhooks and provision donor status + subscription tier
 * (Accounts Phase 2, F54 donations; Synced Workspaces Step 3, F60 subscription lifecycle).
 *
 * ORDERING IS THE SECURITY BOUNDARY (S11): the Stripe signature is verified over the RAW body
 * BEFORE any provisioning runs — a forged event never credits or entitles anyone. Only after
 * verification do we act.
 *
 * Replay-safe dedupe: donation events are recorded in `donations` keyed by the Stripe EVENT ID (a
 * duplicated/replayed webhook collides on the PK and credits exactly once); subscription-lifecycle
 * events dedupe the same way via the `webhook_events` ledger.
 *
 * Donation linkage — NEVER blindly trust the checkout email:
 *   - `client_reference_id` present + resolves to a user  → credit that user (it came from our own
 *     /api/checkout, set from the logged-in session — trusted).
 *   - else a user exists with a VERIFIED matching email    → credit that user.
 *   - else                                                 → store the donation UNCLAIMED, keyed by
 *     the lowercased checkout email; it is claimed later when that email is verified (F55).
 *
 * Subscription linkage (F60) — trusted resolution only, mirroring donations:
 *   - `client_reference_id` (top-level or in subscription metadata) → that user; else
 *   - an existing subscription row for this Stripe subscription id  → its user; else
 *   - a user already linked to this Stripe customer id.
 * Unresolved → acked (200) so Stripe stops retrying, but nothing is provisioned.
 *
 * Fail closed: 501 until STRIPE_WEBHOOK_SECRET is set; 503 (same shape as the account endpoints)
 * when ACCOUNTS_DB is unbound — a verified event is never dropped silently, it is refused loudly.
 */
import { json } from '../_lib/http.ts';
import { verifyStripeSignature } from '../_lib/auth.ts';
import type { Ctx } from '../_lib/types.ts';
import {
  applyDonationToUser,
  dbUnavailable,
  donationById,
  getDb,
  insertDonation,
  isCreditableDonation,
  linkStripeCustomer,
  markWebhookEvent,
  subscriptionByStripeId,
  subscriptionForUser,
  upsertSubscription,
  userByEmail,
  userById,
  userByStripeCustomerId,
  webhookEventSeen,
  type AccountsDb,
} from '../_lib/accounts.ts';

interface CheckoutSession {
  amount_total?: unknown;
  currency?: unknown;
  customer?: unknown;
  customer_details?: { email?: unknown } | null;
  client_reference_id?: unknown;
}
/** Shape shared by the subscription object (customer.subscription.*) and the invoice object
 *  (invoice.payment_failed) — only the fields F60 reads are declared. */
interface StripeSubObject {
  id?: unknown; // subscription id (on customer.subscription.* objects)
  subscription?: unknown; // subscription id (on the invoice object)
  customer?: unknown;
  status?: unknown;
  current_period_end?: unknown; // Stripe UNIX SECONDS — top-level on older API versions
  // API versions ~2025+ moved the billing period off the top-level subscription object onto the
  // subscription ITEMS (items.data[].current_period_end). Read both so the period survives whichever
  // version the webhook endpoint is pinned to.
  items?: { data?: Array<{ current_period_end?: unknown }> } | null;
  client_reference_id?: unknown;
  metadata?: { client_reference_id?: unknown; user_id?: unknown } | null;
}
interface StripeEvent {
  id?: unknown;
  type?: unknown;
  data?: { object?: unknown } | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

// The subscription-lifecycle events F60 provisions (period-end + grace lapse policy lives in me.ts).
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
]);

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
  const type = String(event.type ?? 'unknown');

  // ── Donations (F54) — the checkout path is unchanged. ──
  if (type === 'checkout.session.completed') return provisionDonation(db, eventId, (event.data?.object ?? {}) as CheckoutSession);

  // ── Subscription lifecycle (F60) — status + current_period_end drive the cloud tier in me.ts. ──
  if (SUBSCRIPTION_EVENTS.has(type)) return provisionSubscription(db, eventId, type, (event.data?.object ?? {}) as StripeSubObject);

  // Ack (200) unrelated events so Stripe stops retrying — we only provision on the events above.
  return json({ received: true, ignored: type });
}

/** F54 donation provisioning — records the checkout event (dedupe-keyed by event id) and credits
 *  the resolved account when the linkage is trusted and the amount+currency are creditable. */
async function provisionDonation(db: AccountsDb, eventId: string, obj: CheckoutSession) {
  // Replay-safe dedupe: already processed this event id → no-op success.
  if (await donationById(db, eventId)) return json({ received: true, deduped: true });

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
  // S26(3): the row above is recorded (and dedupe-keyed) regardless — but only actually credit the
  // user's donor tally (donated_at / donation_total_cents) when the amount is positive AND the
  // currency is USD (we only ever configure USD Stripe prices, so a non-USD/zero-amount line item
  // here would be unexpected/anomalous and should not silently inflate donor status).
  const credited = !!creditUser && isCreditableDonation(amountCents, currency);
  if (creditUser && credited) await applyDonationToUser(db, creditUser, amountCents, currency, customerId, now);

  return json({ received: true, credited });
}

/** F60 subscription-lifecycle provisioning — upserts the user's current subscription (status +
 *  current_period_end), keyed to the account by trusted linkage. Dedupes replays by event id. */
async function provisionSubscription(db: AccountsDb, eventId: string, type: string, obj: StripeSubObject) {
  // Replay-safe dedupe (mirrors the donation PK): already processed this event id → no-op success.
  if (await webhookEventSeen(db, eventId)) return json({ received: true, deduped: true });

  const isInvoice = type === 'invoice.payment_failed';
  const subId = isInvoice ? str(obj.subscription) : str(obj.id);
  const customerId = str(obj.customer);
  // status: a delete is a hard cancel; a failed payment is dunning (past_due); else trust the object.
  const status = type === 'customer.subscription.deleted' ? 'canceled' : isInvoice ? 'past_due' : (str(obj.status) ?? 'active');

  // Resolve the user — trusted linkage only, mirroring the donation path.
  const ref = str(obj.client_reference_id) ?? str(obj.metadata?.client_reference_id) ?? str(obj.metadata?.user_id);
  let user = ref ? await userById(db, ref) : null;
  if (!user && subId) {
    const existingBySub = await subscriptionByStripeId(db, subId);
    if (existingBySub) user = await userById(db, existingBySub.user_id);
  }
  if (!user && customerId) user = await userByStripeCustomerId(db, customerId);
  // Can't attribute this event to a known account → ack (200), provision nothing (don't mark seen so
  // a later linked delivery can still land).
  if (!user) return json({ received: true, unresolved: true });

  const now = Date.now();
  const existing = await subscriptionForUser(db, user.id);
  // Stripe sends current_period_end in SECONDS → store ms. Read the top-level field (older API
  // versions) OR the subscription-item field (newer versions moved it there). The invoice object
  // (payment_failed) carries neither, so keep whatever the last subscription event recorded.
  const finiteSec = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const periodEndSec = finiteSec(obj.current_period_end) ?? finiteSec(obj.items?.data?.[0]?.current_period_end);
  const currentPeriodEnd = periodEndSec != null ? periodEndSec * 1000 : (existing?.current_period_end ?? null);

  if (customerId) await linkStripeCustomer(db, user, customerId); // future events resolve by customer id
  await upsertSubscription(
    db,
    {
      userId: user.id,
      stripeSubscriptionId: subId ?? existing?.stripe_subscription_id ?? null,
      stripeCustomerId: customerId ?? existing?.stripe_customer_id ?? null,
      status,
      currentPeriodEnd,
    },
    now
  );
  await markWebhookEvent(db, eventId, type, now);
  return json({ received: true, status });
}
