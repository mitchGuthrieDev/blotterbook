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

/* Bump level from the (full) commit message. First line drives the type; the whole
   message is scanned for a BREAKING CHANGE footer. */
export function bumpLevel(message) {
  const msg = String(message || '');
  const subject = msg.split('\n')[0];
  if (/^[a-z]+(\([^)]*\))?!:/i.test(subject) || /(^|\n)BREAKING[ -]CHANGE/i.test(msg)) return 'major';
  const m = subject.match(/^([a-z]+)(\([^)]*\))?:/i);
  return m && m[1].toLowerCase() === 'feat' ? 'minor' : 'patch';
}

// After CH16 the staging FEATURES were promoted to all surfaces (the old app/staging.js became
// app/widgets.js, shared). Only the staging ENVIRONMENT page itself is staging-exclusive now.
const STAGING_ONLY = new Set(['app/staging.html']);

// Production-only surfaces: the public marketing homepage + info pages + their CSS ship to
// prod (main+demo deployment) but are NOT part of the staging sandbox, so they bump PROD only
// (B16 — previously these were classified as nothing, so homepage changes never bumped).
const PROD_ONLY = new Set(['index.html', 'site.css', 'howto.html', 'roadmap.html', 'legal.html', 'changelog.html']);

/* A file shared across the app surfaces (main + demo + staging). Shared app JS/CSS, the app+demo
   shells, partials, assets, tokens, and reference data — but NOT versions.json, the admin-only
   backlog.json / backlog_archive.json, or the curated changelog.json. (CH31: release notes
   DOCUMENT a prod version; they must not bump one — otherwise the changelog would perpetually
   trail by a release and every notes edit would fire another, undocumented, release.) */
const NON_SHIPPING_DATA = new Set(['data/versions.json', 'data/backlog.json', 'data/backlog_archive.json', 'data/changelog.json']);
export function isProdShipping(f) {
  if (f === 'app/app.html' || f === 'app/demo.html' || f === 'app/app.css' || f === 'tokens.css') return true;
  if (/^app\/[^/]+\.js$/.test(f)) return true; // shared app modules (all app JS ships to every surface)
  if (/^partials\//.test(f) || /^assets\//.test(f)) return true;
  if (/^data\//.test(f) && !NON_SHIPPING_DATA.has(f)) return true;
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
    else if (PROD_ONLY.has(f)) {
      prod = true;
    } // homepage/info pages → prod only
    // anything else (admin.html, README, .github, scripts, functions, versions/backlog/backlog_archive/changelog json) → no bump
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
  const file = root + 'data/versions.json';
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
