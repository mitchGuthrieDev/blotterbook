/* A19 — guard the state-tax MODEL default drift. app/core.js hardcodes a TAXMODEL fallback
   ({fedOrdinary, ltcg, ltcgWeight, ordinaryWeight}) identical to data/state-tax.json `model`;
   the fetched JSON is overlaid via Object.assign, so the literal is only the offline / static /
   pre-deploy fallback — the same failure mode A14's test-flags.mjs guards for APP_FLAGS. If the
   JSON model is edited without updating the literal, the offline fallback silently mis-prices tax.
   This test fails if the two diverge. Run: node scripts/test-tax.mjs */
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

// Parse a flat { key: <number>, ... } object literal from source (group 1 = body).
function numModelFrom(src, re, label) {
  const m = src.match(re);
  if (!m) throw new Error('could not find the TAXMODEL literal in ' + label);
  const obj = {};
  for (const pair of m[1].split(',')) {
    const t = pair.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    if (i < 0) continue;
    const k = t.slice(0, i).trim().replace(/['"]/g, '');
    obj[k] = Number(t.slice(i + 1).trim());
  }
  return obj;
}

// Tolerate an optional TS type annotation on the export (`TAXMODEL: TaxModel = {…}`) — A61.
const lit = numModelFrom(readFileSync('src/lib/core.ts', 'utf8'), /TAXMODEL\s*(?::\s*\w+)?\s*=\s*\{([^}]*)\}/, 'src/lib/core.ts');
const json = JSON.parse(readFileSync('static/data/state-tax.json', 'utf8')).model || {};

console.log('A19 — state-tax model default: src/lib/core.ts TAXMODEL vs static/data/state-tax.json model');
const lk = Object.keys(lit).sort(),
  jk = Object.keys(json).sort();
ok('non-empty model parsed', lk.length > 0 && jk.length > 0, `core=${lk.length} json=${jk.length}`);
ok('same model keys', JSON.stringify(lk) === JSON.stringify(jk), `core=[${lk}] json=[${jk}]`);
for (const k of [...new Set([...lk, ...jk])].sort()) {
  ok(`value matches: ${k}`, lit[k] === Number(json[k]), `core=${lit[k]} json=${json[k]}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
