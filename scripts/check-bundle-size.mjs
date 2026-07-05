// Bundle size budget for the /app/ surface (A96). Dev-only, zero-dependency (A28): after a build,
// it sums the byte size of every JS chunk the app can load — the boot scripts referenced by
// app.html PLUS every chunk reachable from them through static/dynamic imports (A190: the #94
// code-split moved the screens to import() chunks, which the old static-only sum missed) — and
// fails loudly if the total crosses a ceiling, so a stray heavy import can't bloat the download
// silently. Run AFTER `vite build` (it reads dist/) — wired into CI right after the build step.
// The /app/, /demo/, /staging/ surfaces share the same main bundle, so app.html is the proxy.
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const ENTRY = resolve(DIST, 'app/app.html');

// Ceiling for the sum of the app shell's JS (uncompressed bytes). Baseline at introduction was
// ~167 KiB across three chunks (main + the disclose-version/svelte runtime + format); raise
// deliberately (with a commit message saying why) when a real feature legitimately grows the bundle.
//
// A128: raised 200 → 400 KiB for the deliberate adoption of bits-ui as the accessible-component
// foundation (Dialog/Select/DropdownMenu/Popover + Floating UI positioning, which lands once and is
// shared across the menu/popover/select primitives). This is an approved architectural reversal of
// the R22 "keep it lean" decline — the shipped JS grows in exchange for a consistent, accessible
// primitive system. The ceiling keeps headroom over the full-primitive total to still catch an
// *accidental* regression on top of the intentional growth.
// Raised 400 → 480 KiB for the canonical shadcn-svelte components (the full bits-ui primitive
// source — Dialog/Select/DropdownMenu/Popover with portals, scroll buttons, etc. — is heavier than
// the trimmed in-house wrappers it replaced). Headroom restored to catch accidental regressions.
// CH16 cutover: raised 480 → 600 KiB. The redesigned sidebar-shell app (7 screens + parts) now IS the
// /app bundle on every surface — before the cutover it was a staging-only dynamic chunk EXCLUDED from
// this measurement, so the ~529 KiB it lands is the intentional cost of shipping the redesign to prod,
// not a regression. Headroom (~71 KiB) still catches an accidental heavy import on top of it.
// A213 (2026-07-04): raised 600 → 640 KiB. The CSV/data-management feature day (intake gates,
// per-file provenance + the CSV Library manager, real commissions, effective-dated rates, the
// TradingView order-history adapter, analytics interactivity, per-file broker overrides) landed
// ~35 KiB of intentional product code, eating the CH16 headroom to ~20 KiB. Boot payload was
// trimmed first (the report builders moved into the lazy Reports chunk — boot ~427 KiB); the
// remaining growth is feature code, not accidental imports, so the ceiling moves deliberately.
// ~46 KiB headroom again catches a heavy accidental import; the standing trim target stays the
// utils chunk (tailwind-merge/bits-ui — A136).
// A223 (2026-07-05, owner-authorized): raised 640 → 840 KiB. Headroom had eroded to ~14 KiB and the
// approved feature slate (F53 accounts w/ the lazy @simplewebauthn/browser chunk, F52's lazy xlsx
// reader, F47 batch-intake UI, F51 compact Blotter module) is intentional product code. The A223
// boot-path wins ($state.raw collections, consolidated boot reads, curve decimation) landed first;
// lazy chunks still count toward this total (A190), so the ceiling moves deliberately with the
// owner's +200 KiB grant rather than ratcheting per-feature.
const BUDGET_BYTES = 840 * 1024;

let html;
try {
  html = readFileSync(ENTRY, 'utf8');
} catch {
  console.error(`size-budget: ${ENTRY} not found — run \`npm run build\` first.`);
  process.exit(1);
}

// Pull every <script src="/assets/*.js"> the shell references, then walk the CHUNK GRAPH from
// them (A190): the #94 code-split loads the six non-default screens via import(), so their chunks
// never appear in app.html — summing only the static scripts let a heavy lazy import ship past the
// gate silently. Each emitted chunk names its static + dynamic imports as ./relative or /assets/
// .js specifiers in the code, so a BFS over those references reaches every chunk the app can load.
const bootSrcs = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
if (bootSrcs.length === 0) {
  console.error('size-budget: no /assets/*.js scripts found in app.html — build output looks wrong.');
  process.exit(1);
}

const seen = new Set(bootSrcs);
const queue = [...bootSrcs];
while (queue.length) {
  const url = queue.shift();
  const code = readFileSync(resolve(DIST, '.' + url), 'utf8');
  // Static imports are emitted as "./chunk.js"; dynamic import() targets as "assets/chunk.js"
  // (resolved against the site root at runtime); either may also appear as "/assets/chunk.js".
  for (const m of code.matchAll(/["'](?:\.\/|\/?assets\/)([A-Za-z0-9_.-]+\.js)["']/g)) {
    const ref = '/assets/' + m[1];
    if (!seen.has(ref)) {
      seen.add(ref);
      queue.push(ref);
    }
  }
}

let total = 0;
const rows = [...seen].map(url => {
  const bytes = statSync(resolve(DIST, '.' + url)).size;
  total += bytes;
  return `  ${String(bytes).padStart(8)}  ${url}${bootSrcs.includes(url) ? '' : '  (lazy)'}`;
});

const kib = n => (n / 1024).toFixed(1) + ' KiB';
console.log('App-surface JS budget (uncompressed; boot + lazy screen chunks):');
console.log(rows.join('\n'));
console.log(`  ${'-'.repeat(8)}`);
console.log(`  ${String(total).padStart(8)}  total (budget ${BUDGET_BYTES} = ${kib(BUDGET_BYTES)})`);

if (total > BUDGET_BYTES) {
  console.error(
    `\nsize-budget: FAIL — app JS is ${kib(total)}, over the ${kib(BUDGET_BYTES)} budget by ${kib(total - BUDGET_BYTES)}.\n` +
      'Trim the bundle or, if the growth is intentional, raise BUDGET_BYTES in scripts/check-bundle-size.mjs.'
  );
  process.exit(1);
}
console.log(`\nsize-budget: OK — ${kib(total)} / ${kib(BUDGET_BYTES)} (${kib(BUDGET_BYTES - total)} headroom).`);
