/* A14 — guard the client↔Worker feature-flag default drift. The app's APP_FLAGS (app/data.js) and
   the Worker's DEFAULTS.flags (functions/api/config.ts) are duplicated literals coupled only by a
   "MUST mirror" comment; if they diverge, the static/offline client silently defaults a flag wrong.
   This test fails if the two flag key-sets or their default values don't match.
   Run: node scripts/test-flags.mjs */
import { readFileSync } from 'node:fs';

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

// Extract a flat { key: true/false, ... } object literal from source via the given regex (group 1 = body).
function flagsFrom(src, re, label) {
  const m = src.match(re);
  if (!m) throw new Error('could not find the flags literal in ' + label);
  const obj = {};
  for (const pair of m[1].split(',')) {
    const t = pair.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    if (i < 0) continue;
    const k = t.slice(0, i).trim().replace(/['"]/g, '');
    obj[k] = t.slice(i + 1).trim() === 'true';
  }
  return obj;
}

const app = flagsFrom(readFileSync('app/data.js', 'utf8'), /APP_FLAGS\s*=\s*\{([^}]*)\}/, 'app/data.js');
const def = flagsFrom(
  readFileSync('functions/api/config.ts', 'utf8'),
  /DEFAULTS\s*=\s*\{\s*flags:\s*\{([^}]*)\}/,
  'functions/api/config.ts'
);

console.log('A14 — feature-flag defaults: app/data.js APP_FLAGS vs functions/api/config.ts DEFAULTS.flags');
const ak = Object.keys(app).sort(),
  dk = Object.keys(def).sort();
ok('non-empty flag set parsed', ak.length > 0 && dk.length > 0, `app=${ak.length} server=${dk.length}`);
ok('same flag keys', JSON.stringify(ak) === JSON.stringify(dk), `app=[${ak}] server=[${dk}]`);
for (const k of [...new Set([...ak, ...dk])].sort()) {
  ok(`default value matches: ${k}`, app[k] === def[k], `app=${app[k]} server=${def[k]}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
