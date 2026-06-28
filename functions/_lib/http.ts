/* Shared HTTP helper for Pages Functions — one consistent JSON response shape.
   Defaults to `no-store` (API responses are dynamic/uncacheable); pass extra
   headers to override (e.g. an endpoint that wants its own Cache-Control).
   Exports only a helper (no onRequest), so it is never served as a route. */
import type { Env } from './types.ts';

export function json(obj: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/* Lightweight fixed-window rate limiter backed by STATUS_KV (defense-in-depth on the
   admin endpoints — they're already behind Access + a token). Keyed by Access email or
   client IP. Best-effort: KV isn't atomic and is eventually consistent, so this throttles
   abuse rather than enforcing an exact quota. Fails OPEN if KV isn't bound (returns false)
   so a missing binding can't lock the admin out. Returns true when the caller is over the
   limit and should be rejected with 429.

   GUARDRAIL (S22): because this fails OPEN and is best-effort, an endpoint's security must
   NEVER depend on it — auth (Cloudflare Access JWT + constant-time token/key compare) is the
   real control; rate-limiting is only defense-in-depth. Do not add a public/high-traffic
   endpoint that relies on rateLimited() as its primary protection, and keep STATUS_KV bound
   in prod so the throttle is actually active (it silently disappears when KV is unbound). */
export async function rateLimited(env: Env, bucket: string, request: Request, limit = 30, windowSec = 60) {
  const kv = env.STATUS_KV;
  if (!kv) return false;
  const who = request.headers.get('Cf-Access-Authenticated-User-Email') || request.headers.get('CF-Connecting-IP') || 'anon';
  const key = `rl:${bucket}:${who}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  let n = 0;
  try {
    n = parseInt((await kv.get(key)) ?? '', 10) || 0;
  } catch (_) {}
  if (n >= limit) return true;
  try {
    await kv.put(key, String(n + 1), { expirationTtl: Math.max(60, windowSec * 2) });
  } catch (_) {}
  return false;
}
