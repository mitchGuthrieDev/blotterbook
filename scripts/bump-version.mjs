#!/usr/bin/env node
/* CH12 — automated two-track versioning.

   Derives a semver bump for the `prod` (main+demo) and `staging` tracks from the
   merge commit's conventional-commit type and its changed file paths, and applies it
   to data/versions.json. Pure functions are exported for testing; the CLI gathers the
   commit message + changed files (from env in CI, or git locally) and writes the file.

   Rules (decided in CH12):
     • level: feat → minor; feat!/BREAKING → major; anything else typed or untyped → patch.
     • surfaces (path-based):
         - a PROD-shipping file changed → bump BOTH prod and staging (shared code ships to both)
         - only the staging-environment page (app/staging.html) → bump staging alone
         - only non-app files → bump nothing
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/* Bump level from the (full) commit message. First line drives the type; the whole
   message is scanned for a BREAKING CHANGE footer. */
export function bumpLevel(message) {
  const msg = String(message || '');
  const subject = msg.split('\n')[0];
  if (/^[a-z]+(\([^)]*\))?!:/i.test(subject) || /(^|\n)BREAKING[ -]CHANGE/i.test(msg)) return 'major';
  const m = subject.match(/^([a-z]+)(\([^)]*\))?:/i);
  return m && m[1].toLowerCase() === 'feat' ? 'minor' : 'patch';
}

// The Svelte SPA (src/app/) is shared by all three surfaces since the A33 cutover, so the only
// staging-EXCLUSIVE file is the staging ENVIRONMENT page itself; everything else under src/app/ ships
// to every surface (see isProdShipping). (A30: paths are now under src/ + static/.)
export const STAGING_ONLY = new Set(['src/app/staging.html']);

// Production-only surfaces: the public marketing homepage + info pages ship to prod (main+demo
// deployment) but are NOT part of the staging sandbox, so they bump PROD only (B16). admin.* is
// internal (Cloudflare Access–gated) → neither track. (A69: the marketing/info site is now Svelte
// under src/site/ — page components + shared chrome + client entries — and the page CSS lives in
// those scoped <style> blocks, so the old home.css/site.css/*.js entries are gone.)
const PROD_ONLY_HTML = new Set([
  'src/index.html',
  'src/howto.html',
  'src/roadmap.html',
  'src/legal.html',
  'src/changelog.html',
  'src/account.html', // A293 — the standalone Account Dashboard page (noindex, but prod-served)
]);
export function isProdOnly(f) {
  if (PROD_ONLY_HTML.has(f)) return true;
  // src/site/** Svelte components + shared chrome + client entries (A69) ship to prod — EXCEPT the
  // internal admin page (Admin.svelte / admin.ts), which is Access-gated and bumps neither track.
  if (/^src\/site\/.*\.(?:js|ts|svelte)$/.test(f)) return !/admin\.(?:ts|svelte)$/i.test(f);
  // A161: SEO/site chrome served verbatim from static/ (robots/sitemap/og image) is prod-facing.
  if (f === 'static/robots.txt' || f === 'static/sitemap.xml' || /^static\/assets\//.test(f)) return true;
  return false;
}

/* A file shared across the app surfaces (main + demo + staging): the pure-logic core (src/lib/),
   the Svelte SPA + app glue (src/app/), bundled chrome (src/assets/), design tokens, the app+demo
   shells, and reference data — but NOT versions.json, the admin-only backlog.json /
   backlog_archive.json, or the curated changelog.json. (CH31: release notes DOCUMENT a prod
   version; they must not bump one — otherwise the changelog would perpetually trail by a release
   and every notes edit would fire another, undocumented, release.) */
export const NON_SHIPPING_DATA = new Set([
  'static/data/versions.json',
  'static/data/backlog.json',
  'static/data/backlog_archive.json',
  'static/data/changelog.json',
]);
export function isProdShipping(f) {
  if (f === 'src/app/app.html' || f === 'src/app/demo.html') return true;
  // A59/A30: every JS/TS/Svelte module under src/app/ (the SPA + glue, shared by all surfaces since
  // A33) and every module of the pure-logic core under src/lib/ ships to every surface.
  if (/^src\/app\/.*\.(?:js|ts|svelte)$/.test(f)) return true;
  // src/lib = the pure-logic core ($lib/core/*.ts) + the shadcn-svelte design system
  // ($lib/components/ui/*.svelte, $lib/utils.ts cn()); all ship in the app + site bundles.
  if (/^src\/lib\/.*\.(?:ts|svelte)$/.test(f) && !/\.d\.ts$/.test(f)) return true;
  // The Tailwind entry CSS (src/styles/tailwind.css — the single token source) ships everywhere.
  if (/^src\/styles\/.*\.css$/.test(f)) return true;
  if (/^src\/assets\//.test(f)) return true; // bundled chrome (favicon/banner/icons), shared
  if (/^static\/data\//.test(f) && !NON_SHIPPING_DATA.has(f)) return true;
  // A161: the Pages infra files served verbatim from static/ (security headers + rewrites) apply
  // to EVERY surface — a change there ships live and must bump like shared app code.
  if (f === 'static/_headers' || f === 'static/_redirects') return true;
  return false;
}

/* Which tracks a changeset bumps. */
export function classifySurfaces(files) {
  let prod = false,
    staging = false;
  for (const f of files) {
    if (isProdShipping(f)) {
      prod = true;
      staging = true;
    } // shared app code → both
    else if (STAGING_ONLY.has(f)) {
      staging = true;
    } // staging-only → staging
    else if (isProdOnly(f)) {
      prod = true;
    } // homepage/info pages + site Svelte (non-admin) → prod only
    // anything else (admin.html/Admin.svelte/admin.ts, README, .github, scripts, functions, versions/backlog/backlog_archive/changelog json) → no bump
  }
  return { prod, staging };
}

function applyBump(ver, level) {
  let [maj, min, pat] = String(ver)
    .split('.')
    .map(n => parseInt(n, 10) || 0);
  if (level === 'major') {
    maj++;
    min = 0;
    pat = 0;
  } else if (level === 'minor') {
    min++;
    pat = 0;
  } else {
    pat++;
  }
  return `${maj}.${min}.${pat}`;
}

/* Pure: given the commit message, changed files, and current versions, return the next
   versions plus what was decided. `versions` is { prod, staging }. */
export function computeBump({ message, files, versions }) {
  const level = bumpLevel(message);
  const { prod, staging } = classifySurfaces(files || []);
  const next = { prod: versions.prod, staging: versions.staging };
  if (prod) next.prod = applyBump(versions.prod, level);
  if (staging) next.staging = applyBump(versions.staging, level);
  return { next, level, bumpedProd: prod, bumpedStaging: staging };
}

/* Phase derived from the prod major: 0.x → Beta, ≥1 → stable. */
export function platformLabel(prod) {
  const major = parseInt(String(prod).split('.')[0], 10) || 0;
  return (major < 1 ? 'Beta ' : '') + prod;
}

/* A33: version badges are no longer baked into the markup. The app surfaces are Svelte mounts that
   read the live versions from /data/versions.json at runtime (the old `.ver` literals in the deleted
   app-topbar partial are gone), so data/versions.json is the single source — no badge sync step. */

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const file = join(root, 'static/data/versions.json');
  const cur = JSON.parse(readFileSync(file, 'utf8'));

  const message = process.env.COMMIT_MSG || execSync('git log -1 --format=%B').toString();
  let rawFiles = process.env.CHANGED_FILES;
  if (rawFiles == null) {
    // Local convenience: diff against the parent. Guard the first-commit / shallow-clone case
    // where HEAD~1 doesn't exist (CH14) so the script doesn't throw — treat as no changes.
    try {
      rawFiles = execSync('git diff --name-only HEAD~1 HEAD').toString();
    } catch (_) {
      console.warn('No HEAD~1 (first commit / shallow clone) — treating as no changes.');
      rawFiles = '';
    }
  }
  const files = rawFiles
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const { next, level, bumpedProd, bumpedStaging } = computeBump({
    message,
    files,
    versions: { prod: cur.prod, staging: cur.staging },
  });

  if (!bumpedProd && !bumpedStaging) {
    console.log('No app surfaces changed — no version bump.');
    return;
  }
  const updated = { ...cur, prod: next.prod, staging: next.staging };
  writeFileSync(file, JSON.stringify(updated, null, 2) + '\n');
  console.log(
    `Bumped (${level}): prod ${cur.prod}->${next.prod}${bumpedProd ? '' : ' (unchanged)'}, ` +
      `staging ${cur.staging}->${next.staging}${bumpedStaging ? '' : ' (unchanged)'}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
