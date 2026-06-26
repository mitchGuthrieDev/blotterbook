"use strict";
/* Shared tiny utilities, loaded as a classic global script before any page's own scripts.
   Single source for HTML escaping across the app, the info pages, and the admin panel (A7). */

/* S14: the staging-launch link may carry a short-lived admin token as ?k=<token>. Strip it
   from the URL on load so it doesn't linger in the address bar or browser history. (The
   middleware already consumed it on the initial request; staging.html also sends no Referer.) */
(function(){
  if (typeof location === 'undefined' || !/[?&]k=/.test(location.search)) return;
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
})();

/* Escape text for safe interpolation into HTML — including BOTH quote characters, so a value
   placed inside a "double-" or 'single-quoted' attribute can't break out of it. */
function esc(s){
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* CH12 — populate the version badge(s) at runtime from data/versions.json, so all surfaces
   read one source of truth without a rebuild. The baked `.ver` literal stays as the offline
   fallback. Two tracks: staging page → `staging`, app + demo → `prod`. Exposes
   window.__versionsReady (a promise) so app/staging.js can read the badge after it's set. */
(function(){
  if (typeof window !== 'undefined') window.__versionsReady = Promise.resolve(null);  // always a promise (CH14)
  if (typeof document === 'undefined') return;
  const badges = document.querySelectorAll('.ver');
  if (!badges.length) return;                              // info/admin pages have no badge
  const mode = (document.body && document.body.dataset.mode) || 'app';   // app | demo | staging
  window.__versionsReady = fetch('/data/versions.json', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(v => {
      if (v) {
        const ver = mode === 'staging' ? v.staging : v.prod;   // demo + app share the prod track
        if (ver) badges.forEach(b => { b.textContent = 'v' + ver; });
      }
      return v;
    })
    .catch(() => null);
})();
