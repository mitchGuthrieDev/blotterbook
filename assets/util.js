'use strict';
/* Shared tiny utilities — a native ES module (A20) imported by both the app modules and the
   info-page scripts (changelog/admin). Single source for HTML escaping across the app, the info
   pages, and the admin panel (A7). */

/* CH14: a real module export, not a global. Starts as a resolved promise so every importer
   can `await versionsReady` even on pages with no badge; the badge IIFE reassigns it below. */
export let versionsReady = Promise.resolve(null);

/* S14: defensively strip any legacy `?k=<token>` from the URL on load so a token can't linger
   in the address bar or browser history. NOTE (S19): `?k=` is NO LONGER an accepted auth path —
   the staging token travels only in the path-scoped `bb_staging` cookie — so this is just
   belt-and-suspenders cleanup for any old link; it is not part of the auth flow. */
(function () {
  if (typeof location === 'undefined' || !/[?&]k=/.test(location.search)) return;
  try {
    history.replaceState(null, '', location.pathname + location.hash);
  } catch (e) {}
})();

/* Escape text for safe interpolation into HTML — including BOTH quote characters, so a value
   placed inside a "double-" or 'single-quoted' attribute can't break out of it. */
export function esc(s) {
  return String(s == null ? '' : s).replace(
    /[<>&"']/g,
    c =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );
}

/* Platform phase label derived from the prod major: 0.x → "Beta x", ≥1 → just the version.
   Browser-shared single source for the admin panel (A11); MIRROR of platformLabel() in
   scripts/bump-version.mjs (the Node/CI side — keep the two in sync if the rule changes). */
export function platformLabel(prod) {
  var major = parseInt(String(prod).split('.')[0], 10) || 0;
  return (major < 1 ? 'Beta ' : '') + prod;
}

/* CH12 — populate the version badge(s) at runtime from data/versions.json, so all surfaces
   read one source of truth without a rebuild. The baked `.ver` literal stays as the offline
   fallback. Two tracks: staging page → `staging`, app + demo → `prod`. Reassigns the exported
   versionsReady promise so app/widgets.js can read the badge after it's set. */
(function () {
  if (typeof document === 'undefined') return;
  const badges = document.querySelectorAll('.ver');
  if (!badges.length) return; // info/admin pages have no badge
  const mode = (document.body && document.body.dataset.mode) || 'app'; // app | demo | staging
  versionsReady = fetch('/data/versions.json', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(v => {
      if (v) {
        const ver = mode === 'staging' ? v.staging : v.prod; // demo + app share the prod track
        if (ver)
          badges.forEach(b => {
            b.textContent = 'v' + ver;
          });
      }
      return v;
    })
    .catch(() => null);
})();
