'use strict';
/* Shared tiny utilities — a native ES module (A20) imported by both the app modules and the
   info-page scripts (changelog/admin). Single source for HTML escaping across the app, the info
   pages, and the admin panel (A7). */

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
export function esc(s: unknown) {
  const M: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => M[c]);
}

/* Platform phase label derived from the prod major: 0.x → "Beta x", ≥1 → just the version.
   Browser-shared single source for the admin panel (A11) and the App topbar beta badge; MIRROR of
   platformLabel() in scripts/bump-version.mjs (the Node/CI side — keep in sync if the rule changes). */
export function isBetaPhase(prod: string | number) {
  return (parseInt(String(prod).split('.')[0], 10) || 0) < 1;
}
export function platformLabel(prod: string | number) {
  return (isBetaPhase(prod) ? 'Beta ' : '') + prod;
}

/* CH12 — populate the version badge(s) at runtime from data/versions.json, so all surfaces
   read one source of truth without a rebuild. The baked `.ver` literal stays as the offline
   fallback. Two tracks: staging page → `staging`, app + demo → `prod`. Fire-and-forget: nothing
   awaits this fetch (the former exported `versionsReady` promise had zero external readers and was
   removed in A314 — the badge is populated by the direct DOM writes below, not by an importer). */
(function () {
  if (typeof document === 'undefined') return;
  const badges = document.querySelectorAll('.ver');
  if (!badges.length) return; // info/admin pages have no badge
  const mode = (document.body && document.body.dataset.mode) || 'app'; // app | demo | staging
  fetch('/data/versions.json', { cache: 'no-store' })
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
