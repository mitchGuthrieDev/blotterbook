/* Cloudflare Pages middleware — runs for every request.
   Makes admin.blotterbook.com the ONLY entry point for the admin panel:
   the /admin path and the admin-only API writes are blocked on the apex
   (blotterbook.com) and anywhere that isn't the admin subdomain.

   Dev hosts (localhost, *.pages.dev preview) are allowed so previews work. */

const ADMIN_HOST = 'admin.blotterbook.com';

function isAllowedAdminHost(host) {
  return host === ADMIN_HOST || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.pages.dev');
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const host = url.hostname;
  const path = url.pathname;
  const adminHost = isAllowedAdminHost(host);

  // The admin page only resolves on the admin subdomain (404 elsewhere, incl. the apex).
  if (path === '/admin' || path === '/admin.html' || path.startsWith('/admin/')) {
    if (!adminHost) return new Response('Not found', { status: 404 });
  }

  // The key endpoint only exists on the admin subdomain.
  if (path === '/api/admin-key' && !adminHost) return new Response('Not found', { status: 404 });

  // Admin-only writes (config/status changes) must originate from the admin subdomain.
  if (request.method !== 'GET' && (path === '/api/status' || path === '/api/config')) {
    if (!adminHost) return new Response('Forbidden', { status: 403 });
  }

  return next();
}
