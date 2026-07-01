/* Shared auth helpers for Pages Functions.

   S3 — short-lived signed admin tokens: the Access-authenticated /api/admin-key
   endpoint hands the browser an HMAC-SHA256 token (signed with a server secret)
   instead of the raw ADMIN_KEY, so the key never leaves the server. /api/status,
   /api/config, and the staging gate verify the token; the raw key stays accepted
   as a server-side fallback (handy for scripted calls), but is never sent to a browser.

   S4 — Cloudflare Access JWT verification: validate the Cf-Access-Jwt-Assertion
   signature against the team's JWKS (+ audience + issuer + expiry) before trusting it.

   This module only exports helpers (no onRequest), so it is never served as a route. */

import type { Env } from './types.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: ArrayBuffer | Uint8Array) {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(str: string) {
  const pad = '==='.slice((str.length + 3) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToString(str: string) {
  return dec.decode(b64urlToBytes(str));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/* Constant-time string compare that leaks neither contents nor length: HMAC both
   sides under a fresh random key (fixed 32-byte output) and compare the digests. */
async function timingSafeEqual(a: unknown, b: unknown) {
  const k = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const ma = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(String(a))));
  const mb = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(String(b))));
  let diff = ma.length ^ mb.length;
  for (let i = 0; i < ma.length; i++) diff |= ma[i] ^ mb[i];
  return diff === 0;
}

/* Issue an opaque token `base64url(payload).base64url(hmac)`. ttlSec = lifetime. */
export async function issueToken(secret: string, ttlSec: number) {
  const exp = Date.now() + ttlSec * 1000;
  const payload = b64urlEncode(enc.encode(JSON.stringify({ exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return { token: payload + '.' + b64urlEncode(sig), exp };
}

/* Verify a token: HMAC valid (constant-time via subtle.verify) AND not expired. */
export async function verifyToken(secret: string, token: unknown) {
  if (!secret || typeof token !== 'string' || token.indexOf('.') < 0) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlToBytes(sig), enc.encode(payload));
    if (!ok) return false;
    const data = JSON.parse(b64urlToString(payload));
    return typeof data.exp === 'number' && Date.now() < data.exp;
  } catch (_) {
    return false;
  }
}

/* True if the request is authorized: a valid admin token OR (server-side fallback)
   the raw ADMIN_KEY, carried in the x-admin-key header (or `provided` override). */
export async function isAdminAuthorized(request: Request, env: Env, provided: string | null = null) {
  const val = provided != null ? provided : request.headers.get('x-admin-key');
  if (!val) return false;
  if (env.ADMIN_KEY && (await timingSafeEqual(val, env.ADMIN_KEY))) return true; // raw-key fallback (constant-time)
  const secret = env.TOKEN_SECRET || env.ADMIN_KEY;
  return secret ? verifyToken(secret, val) : false;
}

/* ---- S13: Stripe webhook signature verification (for the future payments wiring) ----
   Stripe sends `Stripe-Signature: t=<unix>,v1=<hexhmac>[,v1=...]`. The signed payload is
   `${t}.${rawBody}` (the RAW request bytes — never the re-serialized JSON), and each v1 is
   HMAC-SHA256(secret, signedPayload) in hex. Verify any v1 in constant time and reject a
   timestamp outside `toleranceSec` (default 5 min) to block replay. Returns true only on a
   valid, fresh signature. The webhook handler MUST call this before acting on any event. */
export async function verifyStripeSignature(rawBody: string, sigHeader: string | null, secret: string, toleranceSec = 300) {
  if (!rawBody || !sigHeader || !secret) return false;
  const items = String(sigHeader)
    .split(',')
    .map(s => s.trim());
  const t = Number((items.find(s => s.startsWith('t=')) || '').slice(2));
  if (!Number.isFinite(t)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false; // replay window
  const v1s = items.filter(s => s.startsWith('v1=')).map(s => s.slice(3));
  if (!v1s.length) return false;
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(t + '.' + rawBody));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  for (const v of v1s) {
    if (await timingSafeEqual(v, expected)) return true;
  }
  return false;
}

/* ---- S4: Cloudflare Access JWT verification ---- */
// A88: type the JWKS cache + the JWT header/payload shapes instead of `any`.
// Cloudflare Access JWKS keys carry a `kid` (key id) the lib's JsonWebKey type omits.
interface Jwk extends JsonWebKey {
  kid?: string;
}
interface JwksCache {
  url: string | null;
  at: number;
  keys: Jwk[] | null;
}
interface JwtHeader {
  alg?: string;
  kid?: string;
}
interface JwtPayload {
  exp?: number;
  nbf?: number;
  iss?: string;
  aud?: string | string[];
  email?: string;
}
// Non-secret diagnostic shape returned by inspectAccessJwt (the /api/admin-key?check debug aid).
interface InspectResult {
  present: boolean;
  decodable?: boolean;
  alg?: string | null;
  kid?: string | null;
  iss?: string | null;
  email?: string | null;
  aud?: string[];
  exp?: number | null;
  expired?: boolean | null;
  issExpected?: string;
  issMatches?: boolean;
  audExpected?: string;
  audMatches?: boolean;
  kidFound?: boolean;
  signatureValid?: boolean;
  jwksError?: string;
  error?: string;
}
let JWKS_CACHE: JwksCache = { url: null, at: 0, keys: null };
const JWKS_TTL = 3600 * 1000;

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  const url = teamDomain.replace(/\/+$/, '') + '/cdn-cgi/access/certs';
  if (JWKS_CACHE.url === url && JWKS_CACHE.keys && Date.now() - JWKS_CACHE.at < JWKS_TTL) return JWKS_CACHE.keys;
  const r = await fetch(url, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw new Error('JWKS fetch failed: ' + r.status);
  const j = (await r.json()) as { keys?: Jwk[] };
  const keys = j.keys || [];
  JWKS_CACHE = { url, at: Date.now(), keys };
  return keys;
}

/* Verify a Cloudflare Access JWT (RS256) against the team JWKS + audience + issuer
   + expiry. Returns the decoded payload on success, or null on any failure. */
export async function verifyAccessJwt(assertion: string, teamDomain: string, aud: string) {
  try {
    if (!assertion || !teamDomain || !aud) return null;
    const parts = assertion.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(b64urlToString(parts[0])) as JwtHeader;
    const payload = JSON.parse(b64urlToString(parts[1])) as JwtPayload;
    if (header.alg !== 'RS256' || !header.kid) return null;

    // A155: exp and iss are REQUIRED — fail closed when absent. (A signed assertion with no exp
    // would otherwise never expire, and one with no iss would skip the issuer check. Cloudflare
    // Access always emits both, so a well-formed token is unaffected.)
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now >= payload.exp) return null;
    if (payload.nbf && now < payload.nbf) return null;
    const iss = teamDomain.replace(/\/+$/, '');
    if (!payload.iss || payload.iss.replace(/\/+$/, '') !== iss) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) return null;

    const jwk = (await getJwks(teamDomain)).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
    return ok ? payload : null;
  } catch (_) {
    return null;
  }
}

/* Non-secret diagnostic for the /api/admin-key?check debug aid. Decodes the Access
   assertion (no verification needed to read it — it's the caller's own token) and
   reports, separately, the signature validity and the iss/aud/exp claim checks so a
   misconfigured ACCESS_TEAM_DOMAIN/ACCESS_AUD is obvious. Returns NO secrets — only
   the token's own claims and the configured (public) team domain / AUD identifier. */
export async function inspectAccessJwt(assertion: string | null, teamDomain?: string, aud?: string): Promise<InspectResult> {
  const out: InspectResult = { present: !!assertion };
  if (!assertion) return out;
  try {
    const parts = assertion.split('.');
    out.decodable = parts.length === 3;
    if (parts.length !== 3) return out;
    const header = JSON.parse(b64urlToString(parts[0])) as JwtHeader;
    const payload = JSON.parse(b64urlToString(parts[1])) as JwtPayload;
    const norm = (s: unknown) => String(s || '').replace(/\/+$/, '');
    out.alg = header.alg || null;
    out.kid = header.kid || null;
    out.iss = payload.iss || null;
    out.email = payload.email || null;
    out.aud = Array.isArray(payload.aud) ? payload.aud : payload.aud != null ? [payload.aud] : [];
    const now = Math.floor(Date.now() / 1000);
    out.exp = payload.exp || null;
    out.expired = payload.exp ? now >= payload.exp : null;
    if (teamDomain) {
      out.issExpected = norm(teamDomain);
      out.issMatches = norm(out.iss) === norm(teamDomain);
    }
    if (aud) {
      out.audExpected = aud;
      out.audMatches = (out.aud ?? []).includes(aud);
    }
    // signature check, independent of the claim checks above
    if (teamDomain && header.alg === 'RS256' && header.kid) {
      try {
        const jwk = (await getJwks(teamDomain)).find(k => k.kid === header.kid);
        out.kidFound = !!jwk;
        if (jwk) {
          const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
          out.signatureValid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            key,
            b64urlToBytes(parts[2]),
            enc.encode(parts[0] + '.' + parts[1])
          );
        }
      } catch (e) {
        out.jwksError = String((e as Error)?.message || e).slice(0, 100);
      }
    }
  } catch (e) {
    out.error = String((e as Error)?.message || e).slice(0, 100);
  }
  return out;
}
