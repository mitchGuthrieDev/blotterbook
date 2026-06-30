/* A99 — deploy-contract + version-classification guard (dev-only, A28-clean). Two checks the repo
   previously relied on humans to keep in lockstep, with nothing failing CI on drift:

   1. DEPLOY CONTRACT (needs a built dist/): every static/_redirects target, every sitemap.xml <loc>,
      every page <link rel="canonical">, and the robots.txt Sitemap: line must resolve to a real file
      in dist/. Catches a renamed/moved served file that left a dangling redirect/canonical/sitemap.
   2. VERSION CLASSIFICATION (no dist needed): every git-tracked file under src/ and static/data/ must
      be recognized by scripts/bump-version.mjs's prod/staging/non-shipping rules. A new path that no
      rule matches would silently bump nothing (CH12) — this fails loudly so the rule gets updated.

   Run AFTER `npm run build` (it reads dist/). Run: node scripts/check-deploy-contract.mjs */
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProdShipping, isProdOnly, STAGING_ONLY, NON_SHIPPING_DATA } from './bump-version.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const r = p => join(ROOT, p);

let pass = 0,
  fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ok  ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '  → ' + extra : ''));
  }
}

// URL path (or absolute https URL) → the dist file it must map to. '/' → index.html.
const distFileFor = u => {
  const path = u.startsWith('http') ? new URL(u).pathname : u;
  const rel = path === '/' ? 'index.html' : path.replace(/^\//, '');
  return join(DIST, rel);
};

console.log('A99 — deploy-contract + version-classification guard');

// ── 2. Version classification coverage (always runs) ───────────────────────────────────────────
const tracked = execSync('git ls-files src static/data', { cwd: ROOT })
  .toString()
  .split('\n')
  .map(s => s.trim())
  .filter(Boolean);

// Files that legitimately bump NEITHER track (admin is Cloudflare Access–gated; these data files are
// admin/meta/generated). isProdShipping already covers ref data + manifest; isProdOnly covers the
// marketing/info site; STAGING_ONLY covers the staging env page.
const isAdmin = f => f === 'src/admin.html' || /^src\/site\/.*admin\.(?:ts|svelte)$/i.test(f);
// Ambient type declarations (A128: src/vite-env.d.ts) are build-time-only — they emit no deploy
// artifact, so they bump neither track. Recognized here as accounted-for (not a missing classification).
const isAmbientTypes = f => /\.d\.ts$/.test(f);
const classified = f =>
  isProdShipping(f) || isProdOnly(f) || STAGING_ONLY.has(f) || NON_SHIPPING_DATA.has(f) || isAdmin(f) || isAmbientTypes(f);

const unclassified = tracked.filter(f => !classified(f));
ok(
  `every tracked src/ + static/data/ file is classified by bump-version (${tracked.length} files)`,
  unclassified.length === 0,
  unclassified.length ? `unclassified: ${unclassified.join(', ')}` : ''
);

// ── 1. Deploy contract (needs dist/) ────────────────────────────────────────────────────────────
if (!existsSync(DIST)) {
  console.error(`\ncheck-deploy-contract: ${DIST} not found — run \`npm run build\` first.`);
  process.exit(1);
}

// _redirects: the 2nd token on each non-comment line is the destination path.
for (const line of readFileSync(r('static/_redirects'), 'utf8').split('\n')) {
  const s = line.trim();
  if (!s || s.startsWith('#')) continue;
  const dest = s.split(/\s+/)[1];
  if (!dest || !dest.startsWith('/')) continue;
  ok(`_redirects target exists in dist: ${dest}`, existsSync(distFileFor(dest)));
}

// sitemap.xml <loc> entries.
for (const m of readFileSync(r('static/sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
  ok(`sitemap loc exists in dist: ${m[1]}`, existsSync(distFileFor(m[1])));
}

// page <link rel="canonical"> across the served HTML entries.
for (const f of execSync('git ls-files src/*.html', { cwd: ROOT })
  .toString()
  .split('\n')
  .map(s => s.trim())
  .filter(Boolean)) {
  const m = readFileSync(r(f), 'utf8').match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
  if (m) ok(`canonical of ${f} exists in dist: ${m[1]}`, existsSync(distFileFor(m[1])));
}

// robots.txt Sitemap: line.
const sm = readFileSync(r('static/robots.txt'), 'utf8').match(/^Sitemap:\s*(\S+)/m);
if (sm) ok(`robots Sitemap target exists in dist: ${sm[1]}`, existsSync(distFileFor(sm[1])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
