// Bundle size budget for the /app/ surface (A96). Dev-only, zero-dependency (A28): after a build,
// it sums the byte size of every JS chunk the app shell actually loads and fails loudly if the
// total crosses a ceiling, so a stray heavy import or an accidental dependency can't bloat the
// download silently. Run AFTER `vite build` (it reads dist/) — wired into CI right after the build
// step. The /app/, /demo/, /staging/ surfaces share the same main bundle, so app.html is the proxy.
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const ENTRY = resolve(DIST, 'app/app.html');

// Ceiling for the sum of the app shell's JS (uncompressed bytes). Baseline at introduction was
// ~167 KiB across three chunks (main + the disclose-version/svelte runtime + format); this leaves
// ~20% headroom to catch a regression without flapping on noise. Raise deliberately (with a commit
// message saying why) when a real feature legitimately grows the bundle.
const BUDGET_BYTES = 200 * 1024;

let html;
try {
  html = readFileSync(ENTRY, 'utf8');
} catch {
  console.error(`size-budget: ${ENTRY} not found — run \`npm run build\` first.`);
  process.exit(1);
}

// Pull every <script src="/assets/*.js"> the shell references and total their on-disk size.
const srcs = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
if (srcs.length === 0) {
  console.error('size-budget: no /assets/*.js scripts found in app.html — build output looks wrong.');
  process.exit(1);
}

let total = 0;
const rows = srcs.map(url => {
  const bytes = statSync(resolve(DIST, '.' + url)).size;
  total += bytes;
  return `  ${String(bytes).padStart(8)}  ${url}`;
});

const kib = n => (n / 1024).toFixed(1) + ' KiB';
console.log('App-surface JS budget (uncompressed):');
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
