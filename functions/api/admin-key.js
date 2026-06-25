/* Cloudflare Pages Function — GET /api/admin-key
   Returns the ADMIN_KEY to an *already-authenticated* admin so the admin page can
   pre-fill the key field (no more typing it each visit).

   It only responds when the request arrived through Cloudflare Access — i.e. it
   carries the `Cf-Access-Jwt-Assertion` header that Cloudflare injects on
   Access-protected hostnames (clients can't forge it). The `_middleware.js` also
   restricts this route to the admin subdomain. Off-Access (local/preview) it
   returns 401 and the admin page falls back to manual entry. */

export async function onRequest(context) {
  const { request, env } = context;
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  const email = request.headers.get('Cf-Access-Authenticated-User-Email') || null;
  if (!assertion) return new Response(JSON.stringify({ error: 'not authenticated' }), {
    status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  if (!env.ADMIN_KEY) return new Response(JSON.stringify({ error: 'ADMIN_KEY not set' }), {
    status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  return new Response(JSON.stringify({ key: env.ADMIN_KEY, email }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
