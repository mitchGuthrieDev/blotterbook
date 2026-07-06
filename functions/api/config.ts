/* Cloudflare Pages Function — /api/config
   Admin-managed feature flags, stored in the `STATUS_KV` namespace under the `config` key.

   GET  → returns the current config (no secrets). Public-readable so the app can consume flags
          at boot. (The client mirror is src/app/lib/flags.ts — see A89.)
   POST → admin only (x-admin-key must match the ADMIN_KEY secret). Body is a partial config to
          merge: { flags?: {...} }. Flag keys are allow-listed to DEFAULTS.flags (S19).

   Defaults: { flags: { maintenanceBanner:false } }
   (R9: the reference-data "cache version" field was removed — nothing consumed it; reference
   data is cache-busted by per-file hashes in data/manifest.json, not a KV timestamp.)
   (A245: showBetaAdapters and betaRibbon were retired — dead flags no app code ever read.) */

import { isAdminAuthorized } from '../_lib/auth.ts';
import { json, rateLimited, cachedJson, purgeCached } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';

const KEY = 'config';
const cacheUrl = (request: Request) => new URL(request.url).origin + '/api/config';
// A88: the stored config shape (flags + an admin-write timestamp), instead of `any`.
interface Config {
  flags: Record<string, boolean>;
  updatedAt?: string;
}
const DEFAULTS: Config = {
  flags: { maintenanceBanner: false },
};

async function read(kv: KVNamespace | undefined): Promise<Config> {
  if (!kv) return { ...DEFAULTS, flags: { ...DEFAULTS.flags } };
  try {
    const raw = await kv.get(KEY);
    if (!raw) return { ...DEFAULTS, flags: { ...DEFAULTS.flags } };
    const stored = JSON.parse(raw) as Partial<Config>;
    return { ...DEFAULTS, ...stored, flags: { ...DEFAULTS.flags, ...(stored.flags || {}) } };
  } catch (_) {
    return { ...DEFAULTS, flags: { ...DEFAULTS.flags } };
  }
}

// CH12: versions are NOT admin-editable anymore — they're derived from the automated
// source of truth (data/versions.json). The admin panel reads that file DIRECTLY in the
// browser; this Function must NOT self-fetch it. (An earlier version fetched the admin
// origin's own /data/versions.json from inside the Worker, which — because the admin host
// is behind Cloudflare Access — got redirected to the Access login and hung GET /api/config,
// freezing the admin panel's version + cache rows on "loading…".)

export async function onRequest(context: Ctx) {
  const { request, env } = context;
  const kv = env.STATUS_KV;

  // CH27: read by the app at every boot; edge-cache for a short TTL (a briefly-stale read is harmless
  // — config mirrors the client-side APP_FLAGS defaults). An admin write purges the entry below.
  if (request.method === 'GET') return cachedJson(context, cacheUrl(request), 60, () => read(kv));

  if (request.method === 'POST') {
    if (await rateLimited(env, 'config', request)) return json({ error: 'rate limited' }, 429);
    if (!(await isAdminAuthorized(request, env))) return json({ error: 'unauthorized' }, 401);
    if (!kv) return json({ error: 'STATUS_KV namespace is not bound' }, 500);
    let body: { flags?: Record<string, unknown> } | null;
    try {
      body = (await request.json()) as { flags?: Record<string, unknown> };
    } catch (_) {
      return json({ error: 'invalid JSON body' }, 400);
    }
    const cur = await read(kv);
    // S19: allow-list flag keys to the declared schema (DEFAULTS.flags) and coerce to boolean, so a
    // client can't write arbitrary keys or oversized values into the world-readable config record.
    if (body && body.flags && typeof body.flags === 'object') {
      const bf = body.flags;
      for (const k of Object.keys(DEFAULTS.flags)) {
        if (k in bf) cur.flags[k] = !!bf[k];
      }
    }
    // versions are no longer writable (automated); any versions field in the body is ignored.
    cur.updatedAt = new Date().toISOString();
    await kv.put(KEY, JSON.stringify(cur));
    purgeCached(context, cacheUrl(request)); // CH27: flag change takes effect immediately
    return json(cur);
  }

  return json({ error: 'method not allowed' }, 405);
}
