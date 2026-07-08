/* Cloudflare Pages Function — GET /api/admin-key
   Issues a SHORT-LIVED signed admin token to an already-authenticated admin so the
   admin page can act without the raw ADMIN_KEY ever reaching the browser (S3).

   It only responds when the request arrived through Cloudflare Access — i.e. it
   carries the `Cf-Access-Jwt-Assertion` header Cloudflare injects on Access-protected
   hostnames. When ACCESS_TEAM_DOMAIN + ACCESS_AUD are configured, the assertion's
   signature is verified against the team JWKS before anything is issued (S4); when
   they're not set, it FAILS CLOSED with a 503 (S12) — a spoofed assertion header must
   never mint a token — unless ALLOW_PRESENCE_AUTH=1 is set (local/preview only), which
   re-enables the presence-only fallback. Off-Access it returns 401 and the admin page
   falls back to manual key entry. */

import { issueToken, verifyAccessJwt, inspectAccessJwt } from '../_lib/auth.ts';
import { json, rateLimited } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';

export async function onRequest(context: Ctx) {
  const { request, env } = context;
  if (await rateLimited(env, 'admin-key', request, 20, 60)) return json({ error: 'rate limited' }, 429);
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  let email = request.headers.get('Cf-Access-Authenticated-User-Email') || null;

  // Debug aid: GET /api/admin-key?check reports whether S4 (Access-JWT verification) is
  // active and exactly why a JWT would pass/fail — WITHOUT issuing a token or returning
  // any secret. It discloses (non-secret) Access config + the caller's own email, so it
  // is gated behind ADMIN_DEBUG and OFF by default — set ADMIN_DEBUG=1 only while
  // diagnosing setup, so anonymous callers can't fingerprint the infra (S12). Kept ahead
  // of the auth checks on purpose so it can still diagnose an absent/invalid assertion.
  // GUARDRAIL (S21): ADMIN_DEBUG must stay unset (never '1') in PRODUCTION — scripts/test-auth.mjs
  // asserts ?check returns 404 whenever ADMIN_DEBUG is unset.
  if (new URL(request.url).searchParams.has('check')) {
    if (env.ADMIN_DEBUG !== '1') return json({ error: 'not_found' }, 404);
    return json({
      check: true,
      s4Active: !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD), // verification is enforced only when both are set
      accessTeamDomain: env.ACCESS_TEAM_DOMAIN || null, // not a secret
      accessAud: env.ACCESS_AUD || null, // app identifier, not a secret
      adminKeySet: !!env.ADMIN_KEY,
      tokenSecretSet: !!env.TOKEN_SECRET,
      tokenTtlSec: Number(env.ADMIN_TOKEN_TTL_SEC) || 7200,
      jwt: await inspectAccessJwt(assertion, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD),
    });
  }

  if (!assertion) return json({ error: 'not authenticated' }, 401);

  // S4: verify the Access JWT signature + audience when Access is configured.
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const payload = await verifyAccessJwt(assertion, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
    if (!payload) return json({ error: 'invalid Access token' }, 401);
    email = payload.email || email;
  } else if (env.ALLOW_PRESENCE_AUTH !== '1') {
    // Fail closed (S12): without ACCESS_TEAM_DOMAIN + ACCESS_AUD we cannot verify the
    // assertion's signature, so a spoofed Cf-Access-Jwt-Assertion header would otherwise
    // mint a real admin token off-Access. Refuse to issue one. Set ALLOW_PRESENCE_AUTH=1
    // only for local/preview where the route is gated some other way.
    return json({ error: 'Access verification not configured' }, 503);
  }

  const secret = env.TOKEN_SECRET || env.ADMIN_KEY;
  if (!secret) return json({ error: 'ADMIN_KEY not set' }, 500);

  // S3: hand back a short-lived signed token, never the raw key.
  const ttl = Number(env.ADMIN_TOKEN_TTL_SEC) || 7200; // 2h default
  const { token, exp } = await issueToken(secret, ttl);
  return json({ token, exp, email });
}
