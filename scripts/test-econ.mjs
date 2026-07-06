/* R14a — unit coverage for the economic-event calendar data layer: the shipped econ-events.json is
   well-formed against its schema, and the pure core helpers (loadEconEvents / eventsForDay /
   eventsForMonth) load + resolve + index it correctly.

   Run: node scripts/test-econ.mjs */
import { readFileSync } from 'node:fs';

// --- serve static/data/*.json from disk (loadEconEvents fetches manifest.json then econ-events.json) ---
globalThis.fetch = async url => {
  const name = String(url).split('?')[0].split('/').pop();
  const txt = readFileSync('static/data/' + name, 'utf8');
  return { ok: true, json: async () => JSON.parse(txt) };
};

let failed = 0;
function ok(cond, msg) {
  if (cond) {
    console.log('  ok  ' + msg);
  } else {
    failed++;
    console.error('  FAIL ' + msg);
  }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// ── 1. The shipped JSON is well-formed against the schema ──────────────────────────────────────
const file = JSON.parse(readFileSync('static/data/econ-events.json', 'utf8'));
eq(file.schemaVersion, 1, 'schemaVersion is 1');
ok(file.range && file.range.from <= file.range.to, 'range.from <= range.to');
ok(file.types && typeof file.types === 'object', 'types map present');
ok(Array.isArray(file.events) && file.events.length > 0, 'events array non-empty');

const KNOWN_TYPES = new Set(['fomc', 'cpi', 'nfp', 'gdp', 'eiaCl']);
for (const [k, ty] of Object.entries(file.types)) {
  ok(KNOWN_TYPES.has(k), `type key '${k}' is a known kind`);
  ok(typeof ty.label === 'string' && ty.label.length > 0, `type '${k}' has a label`);
  ok(['high', 'medium', 'low'].includes(ty.impact), `type '${k}' impact is valid`);
  ok(/^\d{2}:\d{2}$/.test(ty.et), `type '${k}' default et is HH:MM`);
  ok(typeof ty.src === 'string' && ty.src.includes('.gov'), `type '${k}' src is a .gov host`);
}

let badRows = 0;
let inRange = 0;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
for (const ev of file.events) {
  if (!dateRe.test(ev.d)) badRows++;
  if (!file.types[ev.t]) badRows++;
  if (ev.et !== undefined && !/^\d{2}:\d{2}$/.test(ev.et)) badRows++;
  if (ev.d >= file.range.from && ev.d <= file.range.to) inRange++;
}
eq(badRows, 0, 'every row: valid date, known type key, HH:MM et override when present');
eq(inRange, file.events.length, 'every row falls inside the declared range');

// high-impact defaults per the doc (FOMC/CPI/NFP/GDP high; weekly EIA medium)
eq(file.types.fomc.impact, 'high', 'FOMC is high impact');
eq(file.types.cpi.impact, 'high', 'CPI is high impact');
eq(file.types.nfp.impact, 'high', 'NFP is high impact');
eq(file.types.eiaCl.impact, 'medium', 'weekly EIA crude is medium impact');

// ── 2. The pure core helpers load + resolve + index ────────────────────────────────────────────
const core = await import('../src/lib/core/core.ts');
const { loadEconEvents, eventsForDay, eventsForMonth, econEventsLoaded, ECON_SCHEMA_VERSION } = core;

eq(ECON_SCHEMA_VERSION, 1, 'core ECON_SCHEMA_VERSION matches the data file');
eq(econEventsLoaded(), false, 'not loaded before loadEconEvents()');
eq(eventsForDay('2026-07-29').length, 0, 'eventsForDay empty before load');

await loadEconEvents();
eq(econEventsLoaded(), true, 'loaded after loadEconEvents()');
await loadEconEvents(); // idempotent — second call is a no-op, must not throw or duplicate

// A verified FOMC decision date resolves with its type defaults (that day also carries an EIA row).
const fomc = eventsForDay('2026-07-29').find(e => e.type === 'fomc');
ok(fomc, '2026-07-29 carries the FOMC decision');
eq(fomc.impact, 'high', 'FOMC event resolves to high impact');
eq(fomc.et, '14:00', 'FOMC event resolves to the 14:00 ET default');
eq(fomc.label, 'FOMC rate decision', 'FOMC label is the type label');
eq(fomc.src, 'federalreserve.gov', 'FOMC src is federalreserve.gov');

// A GDP row carries its estimate note appended to the label.
const gdp = eventsForDay('2026-07-30').find(e => e.type === 'gdp');
ok(gdp && gdp.label === 'GDP (Advance)', 'GDP row label appends its estimate note');

// A holiday-shifted EIA row uses its per-row et override, not the type default.
const eiaHol = eventsForDay('2026-01-22').find(e => e.type === 'eiaCl');
ok(eiaHol && eiaHol.et === '12:00', 'holiday-shifted EIA event uses its per-row et override');

// eventsForMonth: 1-based month, returns only that month's dates.
const jul26 = eventsForMonth(2026, 7);
ok(jul26.size > 0, 'eventsForMonth(2026,7) is non-empty');
let allInMonth = true;
for (const d of jul26.keys()) if (!d.startsWith('2026-07-')) allInMonth = false;
ok(allInMonth, 'eventsForMonth returns only that month');
ok(jul26.has('2026-07-29'), 'eventsForMonth includes the FOMC day');

// A normal (non-holiday) Wednesday EIA release has NO et override (inherits 10:30).
const eiaWed = eventsForDay('2026-07-01').find(e => e.type === 'eiaCl');
ok(eiaWed && eiaWed.et === '10:30', 'normal Wednesday EIA inherits the 10:30 default');

console.log(failed ? `\n${failed} FAILED` : '\nAll econ tests passed.');
process.exit(failed ? 1 : 0);
