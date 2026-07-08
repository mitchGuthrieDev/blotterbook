/* Cloudflare Pages Function — GET /api/admin/users
   Admin-only, paginated directory of accounts with their billing + entitlement status (A276). Used by
   the internal admin panel's Users management (src/site/components/Admin.svelte).

   AUTH POSTURE (mirrors /api/status + /api/config + /api/admin-key): the request must carry a valid
   admin credential — the Access-minted short-lived HMAC token, or the raw ADMIN_KEY server-side
   fallback, in the `x-admin-key` header (isAdminAuthorized, constant-time). Fail-closed 401 otherwise.
   Reads REQUIRE the token too (this list exposes account emails + billing state). There is deliberately
   NO Origin check: this endpoint is reached with a bearer credential header, so a cross-site request
   without the token can't succeed — the header IS the CSRF control (same rationale as /api/status). The
   admin page itself should also sit behind Cloudflare Access. Additionally fail-closed 503 when
   ACCOUNTS_DB is unbound. rateLimited() is defense-in-depth only (S22) — never the primary control.

   S25: returns identity + billing/entitlement metadata ONLY — never any stripe_customer_id/
   stripe_subscription_id, session, credential, sync, or workspace field, and never any trade data. */

import { isAdminAuthorized } from '../../_lib/auth.ts';
import { json, rateLimited } from '../../_lib/http.ts';
import type { Ctx } from '../../_lib/types.ts';
import {
  adminUserView,
  dbUnavailable,
  getDb,
  subscriptionForUser,
  subscriptionOverrideForUser,
  type UserRow,
} from '../../_lib/accounts.ts';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// The paginated fetch — two shapes (with/without an email filter). Cursor = keyset on created_at DESC:
// `created_at < ?1` (?1 NULL on the first page returns the newest). The `q` filter is a LIKE with the
// caller's %/_/\ escaped so a search term is treated literally. Both are literal strings so the
// scripts/test-accounts.mjs mock can pattern-match them.
const LIST_SQL = 'SELECT * FROM users WHERE (?1 IS NULL OR created_at < ?1) ORDER BY created_at DESC LIMIT ?2';
const LIST_SQL_Q =
  "SELECT * FROM users WHERE (?1 IS NULL OR created_at < ?1) AND email LIKE ?3 ESCAPE '\\' ORDER BY created_at DESC LIMIT ?2";

/** Escape a user-supplied LIKE search term so %/_ and the escape char itself are matched literally. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, ch => '\\' + ch);
}

export async function onRequestGet(ctx: Ctx) {
  const { request, env } = ctx;
  if (await rateLimited(env, 'admin-users', request)) return json({ error: 'rate limited' }, 429);
  if (!(await isAdminAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);
  const db = getDb(env);
  if (!db) return dbUnavailable();

  const url = new URL(request.url);
  const cursorRaw = url.searchParams.get('cursor');
  const cursor = cursorRaw != null && /^\d+$/.test(cursorRaw) ? Number(cursorRaw) : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
  const q = (url.searchParams.get('q') || '').trim();

  const stmt = q ? db.prepare(LIST_SQL_Q).bind(cursor, limit, '%' + escapeLike(q) + '%') : db.prepare(LIST_SQL).bind(cursor, limit);
  const { results } = await stmt.all<UserRow>();

  const now = Date.now();
  const users = [];
  for (const u of results) {
    const sub = await subscriptionForUser(db, u.id);
    const override = await subscriptionOverrideForUser(db, u.id);
    users.push(adminUserView(u, sub ?? null, override ?? null, now));
  }
  // A full page implies there may be more — hand back the last row's created_at as the next cursor.
  const nextCursor = results.length === limit && results.length > 0 ? results[results.length - 1].created_at : null;
  return json({ users, nextCursor });
}
