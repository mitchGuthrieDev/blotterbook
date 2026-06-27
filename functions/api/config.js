/* Cloudflare Pages Function — /api/config
   Admin-managed feature flags, stored in the `STATUS_KV` namespace under the `config` key.

   GET  → returns the current config (no secrets). Public-readable so the app consumes flags
          at boot (app/data.js loadFlags()).
   POST → admin only (x-admin-key must match the ADMIN_KEY secret). Body is a partial config to
          merge: { flags?: {...} }. Flag keys are allow-listed to DEFAULTS.flags (S19).

   Defaults: { flags: { showBetaAdapters:true, maintenanceBanner:false, betaRibbon:false } }
   (R9: the reference-data "cache version" field was removed — nothing consumed it; reference
   data is cache-busted by per-file hashes in data/manifest.json, not a KV timestamp.) */

import { isAdminAuthorized } from '../_lib/auth.js';
import { json, rateLimited } from '../_lib/http.js';

const KEY = 'config';
const DEFAULTS = {
  flags: { showBetaAdapters: true, maintenanceBanner: false, betaRibbon: false }
};

async function read(kv) {
  if (!kv) return { ...DEFAULTS };
  try { const raw = await kv.get(KEY); return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }; }
  catch (_) { return { ...DEFAULTS }; }
}

// CH12: versions are NOT admin-editable anymore — they're derived from the automated
// source of truth (data/versions.json). The admin panel reads that file DIRECTLY in the
// browser; this Function must NOT self-fetch it. (An earlier version fetched the admin
// origin's own /data/versions.json from inside the Worker, which — because the admin host
// is behind Cloudflare Access — got redirected to the Access login and hung GET /api/config,
// freezing the admin panel's version + cache rows on "loading…".)

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.STATUS_KV;

  if (request.method === 'GET') return json(await read(kv));

  if (request.method === 'POST') {
    if (await rateLimited(env, 'config', request)) return json({ error: 'rate limited' }, 429);
    if (!(await isAdminAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);
    if (!kv) return json({ error: 'STATUS_KV namespace is not bound' }, 500);
    let body; try { body = await request.json(); } catch (_) { return json({ error: 'invalid JSON body' }, 400); }
    const cur = await read(kv);
    // S19: allow-list flag keys to the declared schema (DEFAULTS.flags) and coerce to boolean, so a
    // client can't write arbitrary keys or oversized values into the world-readable config record.
    if (body && body.flags && typeof body.flags === 'object') {
      for (const k of Object.keys(DEFAULTS.flags)) {
        if (k in body.flags) cur.flags[k] = !!body.flags[k];
      }
    }
    // versions are no longer writable (automated); any versions field in the body is ignored.
    cur.updatedAt = new Date().toISOString();
    await kv.put(KEY, JSON.stringify(cur));
    return json(cur);
  }

  return json({ error: 'method not allowed' }, 405);
}
