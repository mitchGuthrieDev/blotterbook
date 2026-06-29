/* Cloudflare Pages Function — /api/status
   The homepage "Live" indicator's source of truth, set from the admin page.

   GET  → public. Returns { mode, label, updatedAt }. mode ∈
          auto | live | offline | maintenance. Default { mode:'auto' } (the
          homepage then auto-detects by pinging /app/).
   POST → admin only. Body { mode, label? }. Requires the `x-admin-key` header to
          match the `ADMIN_KEY` secret (set in the Cloudflare dashboard). Protect
          the admin page itself with Cloudflare Access for a second layer.

   Persisted in a KV namespace bound as `STATUS_KV`. If KV isn't bound, GET falls
   back to auto and POST returns an error explaining the missing binding. */

import { isAdminAuthorized } from '../_lib/auth.ts';
import { json, rateLimited, cachedJson, purgeCached } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';

const KEY = 'live';
const MODES = ['auto', 'live', 'offline', 'maintenance'];
const cacheUrl = (request: Request) => new URL(request.url).origin + '/api/status';

export async function onRequest(context: Ctx) {
  const { request, env } = context;
  const kv = env.STATUS_KV;

  if (request.method === 'GET') {
    // CH27: the homepage Live pill pings this on every visit; edge-cache it for a short TTL so the
    // per-visitor Function invocation + KV read drops. Stale by ≤30s is harmless (and a POST purges).
    return cachedJson(context, cacheUrl(request), 30, async () => {
      let v = { mode: 'auto' };
      if (kv) {
        try {
          const raw = await kv.get(KEY);
          if (raw) v = JSON.parse(raw);
        } catch (_) {}
      }
      return v;
    });
  }

  if (request.method === 'POST') {
    if (await rateLimited(env, 'status', request)) return json({ error: 'rate limited' }, 429);
    if (!(await isAdminAuthorized(request, env))) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (!kv) return json({ error: 'STATUS_KV namespace is not bound to this Pages project' }, 500);
    let body: any;
    try {
      body = await request.json();
    } catch (_) {
      return json({ error: 'invalid JSON body' }, 400);
    }
    const mode = MODES.includes(body && body.mode) ? body.mode : 'auto';
    const rec = {
      mode,
      label: body && typeof body.label === 'string' ? body.label.slice(0, 40) : '',
      updatedAt: new Date().toISOString(),
    };
    await kv.put(KEY, JSON.stringify(rec));
    purgeCached(context, cacheUrl(request)); // CH27: admin change takes effect immediately
    return json(rec);
  }

  return json({ error: 'method not allowed' }, 405);
}
