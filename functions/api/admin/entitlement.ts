/* Cloudflare Pages Function — POST /api/admin/entitlement
   Admin-only grant/revoke of a manual cloud-tier entitlement override (A276). Backs the Users panel's
   "Grant CLOUD" / "Revoke" controls (src/site/components/Admin.svelte).

   AUTH POSTURE (identical to GET /api/admin/users + /api/status): a valid admin credential in the
   `x-admin-key` header (Access-minted HMAC token OR the raw ADMIN_KEY server-side fallback,
   isAdminAuthorized, constant-time). Fail-closed 401 otherwise, and 503 when ACCOUNTS_DB is unbound.
   NO Origin check — the bearer header IS the CSRF control (the request cannot be forged cross-site
   without the token); the admin page also sits behind Cloudflare Access. rateLimited() is
   defense-in-depth only (S22).

   Body: { userId, action: 'grant'|'revoke', expiresAt?: number|null, reason?: string }. grant upserts a
   live override (expiresAt NULL = permanent); revoke stamps revoked_at/revoked_by, KEEPING the row as
   the audit trail. granted_by/revoked_by come from the Cf-Access-Authenticated-User-Email header, with a
   '(token)' fallback when the call authenticated via the raw key rather than Access.

   S25: entitlement metadata only — never any trade data. Returns the updated per-user admin view. */

import { isAdminAuthorized } from '../../_lib/auth.ts';
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  adminUserView,
  dbUnavailable,
  getDb,
  grantEntitlementOverride,
  readJson,
  revokeEntitlementOverride,
  subscriptionForUser,
  subscriptionOverrideForUser,
  userById,
} from '../../_lib/accounts.ts';

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;
  if (await rateLimited(env, 'admin-entitlement', request)) return json({ error: 'rate limited' }, 429);
  if (!(await isAdminAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);
  const db = getDb(env);
  if (!db) return dbUnavailable();

  const body = await readJson<{ userId?: unknown; action?: unknown; expiresAt?: unknown; reason?: unknown }>(request);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  const action = body?.action === 'grant' || body?.action === 'revoke' ? body.action : '';
  if (!userId || !action) return json({ error: 'userId and a valid action (grant|revoke) are required.' }, 400);

  const user = await userById(db, userId);
  if (!user) return json({ error: 'No such user.' }, 404);

  // The acting admin's identity for the audit trail — the Access email, or '(token)' when the caller
  // authenticated with the raw ADMIN_KEY (off-Access / scripted) so the column is never empty.
  const actor = request.headers.get('Cf-Access-Authenticated-User-Email') || '(token)';

  if (action === 'grant') {
    const expiresAt = typeof body?.expiresAt === 'number' && Number.isFinite(body.expiresAt) ? body.expiresAt : null;
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
    await grantEntitlementOverride(db, { userId, expiresAt, reason, grantedBy: actor });
  } else {
    await revokeEntitlementOverride(db, userId, actor);
  }

  const sub = await subscriptionForUser(db, userId);
  const override = await subscriptionOverrideForUser(db, userId);
  return json(adminUserView(user, sub ?? null, override ?? null));
}
