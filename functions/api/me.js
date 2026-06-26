/**
 * GET /api/me — return the current user's storage tier.
 *
 * SCAFFOLD: there are no accounts yet, so this always reports the free/local
 * tier. When auth lands, resolve the session (cookie/JWT) and look up the
 * entitlement provisioned by the Stripe webhook (D1/KV), returning
 * { tier: "local" | "cloud", ... }.
 *
 * SECURITY (S13) when implementing: resolve and AUTHORIZE the session before returning
 * any non-local tier — never infer "cloud" from a client-supplied id/cookie value alone.
 */
import { json } from '../_lib/http.js';

export function onRequestGet() {
  return json({ tier: 'local', cloudSync: false });
}
