#!/usr/bin/env node
/**
 * Build static/data/econ-events.json — the curated US-government economic-release calendar for the
 * Calendar module (R14 / R14a). Regenerate + `node scripts/build-manifest.mjs` to refresh the
 * cache-busting hash, then commit both (same generated-but-committed posture as the other /data files).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * SCOPE (R14 "Event-set proposal", the R14a slice): the five headline, futures-moving series only —
 *   fomc   FOMC rate decision (2nd day of the meeting)   federalreserve.gov   14:00 ET   high
 *   cpi    CPI (BLS)                                      bls.gov              08:30 ET   high
 *   nfp    Employment Situation / NFP (BLS)              bls.gov              08:30 ET   high
 *   gdp    GDP advance/2nd/3rd (BEA)                     bea.gov              08:30 ET   high
 *   eiaCl  EIA Weekly Petroleum Status (crude stocks)    eia.gov              10:30 ET   medium
 * (The doc's fuller v1 list — FOMC minutes, PPI, PCE, retail sales, EIA nat-gas — is deliberately
 *  deferred; adding a series is one constant list + one `TYPES` entry here.)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * SOURCING (all US-gov public-domain schedules published in advance — no third-party/redistributed
 * data). Dates were transcribed from the primary agency calendars; each block cites its source and
 * confidence. Government shutdowns occasionally reschedule releases after the fact (see the 2025 BLS
 * disruption below); the annual refresh corrects any drift.
 *
 *   FOMC  — federalreserve.gov/monetarypolicy/fomccalendars.htm (meeting calendars, hist + forward).
 *           The DECISION lands on the SECOND day of each two-day meeting. VERIFIED 2021–2027.
 *   GDP   — bea.gov/news/schedule + the news archive (advance/2nd/3rd per quarter, 08:30 ET).
 *           VERIFIED 2022–2026 from the BEA archive; 2021 is PARTIAL/UNVERIFIED (the archive page
 *           for early-2021 rendered ambiguously) and is intentionally OMITTED — flagged for owner
 *           backfill rather than guessed (accuracy over coverage).
 *   EIA   — eia.gov/petroleum/supply/weekly/schedule.php. RULE-GENERATED here (the doc endorses
 *           synthesizing these): every Wednesday 10:30 ET, shifting to Thursday when the week
 *           contains a Monday US federal holiday. Published holiday exceptions (with their off-time)
 *           are pinned in EIA_HOLIDAY_SHIFTS below and override the rule. VERIFIED 2025–2026 holiday
 *           shifts; earlier back-years use the rule with the standard US-holiday calendar (dates are
 *           reliable, the occasional off-hour on an un-pinned holiday week is approximate).
 *   CPI/NFP — bls.gov/schedule/news_release/{cpi,empsit}.htm. BLS blocks automated fetch, so these
 *           lists were transcribed from the BLS advance schedules + documented archives. VERIFIED:
 *           2024 (full), 2026 (forward, published). PARTIALLY VERIFIED / NEEDS OWNER CONFIRMATION:
 *           2021–2023 and 2025. The **2025 government shutdown** (Oct 1 – mid-Nov) CANCELLED the Sep
 *           NFP's normal date and SHIFTED several BLS prints — the 2025 lists below encode the
 *           REVISED (actual) dates as published, but the owner should reconcile against the BLS
 *           archive before ship. Years/rows the script could not confidently source are OMITTED, not
 *           invented.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'data', 'econ-events.json');
const SCHEMA_VERSION = 1;
const RANGE = { from: '2021-01-01', to: '2026-12-31' };

/** Per-kind defaults (label/impact/default ET/source host). Row `t` keys into this. */
const TYPES = {
  fomc: { label: 'FOMC rate decision', impact: 'high', et: '14:00', src: 'federalreserve.gov' },
  cpi: { label: 'CPI', impact: 'high', et: '08:30', src: 'bls.gov' },
  nfp: { label: 'Employment Situation (NFP)', impact: 'high', et: '08:30', src: 'bls.gov' },
  gdp: { label: 'GDP', impact: 'high', et: '08:30', src: 'bea.gov' },
  eiaCl: { label: 'EIA crude stocks', impact: 'medium', et: '10:30', src: 'eia.gov' },
};

/* ── FOMC — rate-decision (2nd-day) dates. Source: federalreserve.gov FOMC calendars. VERIFIED. ── */
const FOMC = [
  // 2021
  '2021-01-27',
  '2021-03-17',
  '2021-04-28',
  '2021-06-16',
  '2021-07-28',
  '2021-09-22',
  '2021-11-03',
  '2021-12-15',
  // 2022
  '2022-01-26',
  '2022-03-16',
  '2022-05-04',
  '2022-06-15',
  '2022-07-27',
  '2022-09-21',
  '2022-11-02',
  '2022-12-14',
  // 2023
  '2023-02-01',
  '2023-03-22',
  '2023-05-03',
  '2023-06-14',
  '2023-07-26',
  '2023-09-20',
  '2023-11-01',
  '2023-12-13',
  // 2024
  '2024-01-31',
  '2024-03-20',
  '2024-05-01',
  '2024-06-12',
  '2024-07-31',
  '2024-09-18',
  '2024-11-07',
  '2024-12-18',
  // 2025
  '2025-01-29',
  '2025-03-19',
  '2025-05-07',
  '2025-06-18',
  '2025-07-30',
  '2025-09-17',
  '2025-10-29',
  '2025-12-10',
  // 2026 (published forward schedule)
  '2026-01-28',
  '2026-03-18',
  '2026-04-29',
  '2026-06-17',
  '2026-07-29',
  '2026-09-16',
  '2026-10-28',
  '2026-12-09',
];

/* ── CPI — release dates (08:30 ET), reference month is the prior month. Source: BLS CPI schedule. ──
   VERIFIED: 2024, 2026. NEEDS OWNER CONFIRMATION: 2021–2023, 2025 (shutdown-affected). */
const CPI = [
  // 2024 (VERIFIED — BLS)
  '2024-01-11',
  '2024-02-13',
  '2024-03-12',
  '2024-04-10',
  '2024-05-15',
  '2024-06-12',
  '2024-07-11',
  '2024-08-14',
  '2024-09-11',
  '2024-10-10',
  '2024-11-13',
  '2024-12-11',
  // 2025 (NEEDS CONFIRMATION — Dec-2024 CPI released 2025-01-15; late-2025 shutdown-shifted)
  '2025-01-15',
  '2025-02-12',
  '2025-03-12',
  '2025-04-10',
  '2025-05-13',
  '2025-06-11',
  '2025-07-15',
  '2025-08-12',
  '2025-09-11',
  // 2026 (VERIFIED forward — BLS advance schedule; Jun-2026 CPI = 2026-07-14)
  '2026-01-14',
  '2026-02-11',
  '2026-03-11',
  '2026-04-10',
  '2026-05-13',
  '2026-06-10',
  '2026-07-14',
  '2026-08-12',
  '2026-09-11',
  '2026-10-14',
  '2026-11-13',
  '2026-12-11',
];

/* ── NFP / Employment Situation — release dates (08:30 ET; typically 1st Friday, 2nd if a holiday).
   Source: BLS Employment Situation schedule. VERIFIED: 2024, forward-2026. NEEDS OWNER CONFIRMATION:
   2021–2023, 2025 (the Oct-2025 report was CANCELLED and Sep/Oct/Nov were shutdown-shifted). */
const NFP = [
  // 2024 (VERIFIED — BLS)
  '2024-01-05',
  '2024-02-02',
  '2024-03-08',
  '2024-04-05',
  '2024-05-03',
  '2024-06-07',
  '2024-07-05',
  '2024-08-02',
  '2024-09-06',
  '2024-10-04',
  '2024-11-01',
  '2024-12-06',
  // 2025 (PARTIAL — first-Friday pattern through Sep; Oct/Nov shutdown-disrupted, see note. The
  //        cancelled/merged late-2025 prints are OMITTED pending owner reconciliation.)
  '2025-01-10',
  '2025-02-07',
  '2025-03-07',
  '2025-04-04',
  '2025-05-02',
  '2025-06-06',
  '2025-07-03',
  '2025-08-01',
  '2025-09-05',
  '2025-11-20', // Sep-2025 report, delayed by the shutdown (VERIFIED via BLS re-publication)
  '2025-12-16', // Oct+Nov-2025 combined report (VERIFIED)
  // 2026 (VERIFIED forward — Dec-2025 report = 2026-01-09; Jul-2026 report = 2026-08-07)
  '2026-01-09',
  '2026-02-06',
  '2026-03-06',
  '2026-04-03',
  '2026-05-08',
  '2026-06-05',
  '2026-07-02',
  '2026-08-07',
  '2026-09-04',
  '2026-10-02',
  '2026-11-06',
  '2026-12-04',
];

/* ── GDP — advance/2nd/3rd per quarter (08:30 ET). Source: bea.gov schedule + news archive.
   VERIFIED 2022–2026. 2021 OMITTED (unverified — flagged for owner backfill). ── */
const GDP = [
  // 2022 (VERIFIED — BEA archive)
  ['2022-01-27', 'Advance'], // Q4-2021 advance
  ['2022-02-24', '2nd'],
  ['2022-03-30', '3rd'],
  ['2022-04-28', 'Advance'],
  ['2022-05-26', '2nd'],
  ['2022-06-29', '3rd'],
  ['2022-07-28', 'Advance'],
  ['2022-08-25', '2nd'],
  ['2022-09-29', '3rd'],
  ['2022-10-27', 'Advance'],
  ['2022-11-30', '2nd'],
  ['2022-12-22', '3rd'],
  // 2023 (VERIFIED — BEA archive)
  ['2023-01-26', 'Advance'],
  ['2023-02-23', '2nd'],
  ['2023-03-30', '3rd'],
  ['2023-04-27', 'Advance'],
  ['2023-05-25', '2nd'],
  ['2023-06-29', '3rd'],
  ['2023-07-27', 'Advance'],
  ['2023-08-30', '2nd'],
  ['2023-09-28', '3rd'],
  ['2023-10-26', 'Advance'],
  ['2023-11-29', '2nd'],
  ['2023-12-21', '3rd'],
  // 2024 (VERIFIED — BEA archive)
  ['2024-01-25', 'Advance'],
  ['2024-02-28', '2nd'],
  ['2024-03-28', '3rd'],
  ['2024-04-25', 'Advance'],
  ['2024-05-30', '2nd'],
  ['2024-06-27', '3rd'],
  ['2024-07-25', 'Advance'],
  ['2024-08-29', '2nd'],
  ['2024-09-26', '3rd'],
  ['2024-10-30', 'Advance'],
  ['2024-11-27', '2nd'],
  ['2024-12-19', '3rd'],
  // 2025 (VERIFIED — BEA archive/schedule; Q3-2025 initial est. published 2025-12-23)
  ['2025-01-30', 'Advance'],
  ['2025-02-27', '2nd'],
  ['2025-03-27', '3rd'],
  ['2025-04-30', 'Advance'],
  ['2025-05-29', '2nd'],
  ['2025-06-26', '3rd'],
  ['2025-07-30', 'Advance'],
  ['2025-08-28', '2nd'],
  ['2025-09-25', '3rd'],
  ['2025-12-23', 'Advance'], // Q3-2025 (delayed by the shutdown)
  // 2026 (VERIFIED forward — BEA schedule)
  ['2026-01-22', '2nd'], // Q3-2025 updated est.
  ['2026-07-30', 'Advance'], // Q2-2026
  ['2026-08-26', '2nd'],
  ['2026-09-30', '3rd'],
  ['2026-10-29', 'Advance'], // Q3-2026
  ['2026-11-25', '2nd'],
  ['2026-12-23', '3rd'],
];

/* ── EIA Weekly Petroleum Status — RULE-GENERATED. Every Wednesday 10:30 ET; a week containing a
   Monday US federal holiday shifts the report to Thursday. Published holiday exceptions (with the
   off-hour EIA announced) override the rule below. Source: eia.gov WPSR schedule. ── */

// Monday US federal holidays + fixed-date holidays that trigger a one-day EIA shift, by year.
// (Only the ones that fall Mon–Wed can push a WPSR release; the generator checks each release week.)
const US_HOLIDAYS = buildUsHolidays(2021, 2026);

// Published EIA holiday-week releases (exact date + off-hour) — override the rule when present.
// Source: eia.gov/petroleum/supply/weekly/schedule.php (VERIFIED 2025–2026).
const EIA_HOLIDAY_SHIFTS = {
  '2025-01-02': '11:00', // New Year's (Dec-27-2024 data)
  '2025-01-23': '12:00', // MLK/Inauguration
  '2025-02-20': '12:00', // Presidents' Day
  '2025-05-29': '12:00', // Memorial Day
  '2025-09-04': '12:00', // Labor Day
  '2025-10-16': '12:00', // Columbus Day
  '2025-11-13': '12:00', // Veterans Day
  '2025-12-29': '17:00', // Christmas (Mon, shifted from Wed 12-24? — EIA pinned Monday 5:00pm)
  '2026-01-22': '12:00', // MLK Day
  '2026-02-19': '12:00', // Presidents' Day
  '2026-05-28': '12:00', // Memorial Day
  '2026-09-10': '12:00', // Labor Day
  '2026-10-15': '12:00', // Columbus Day
  '2026-11-12': '12:00', // Veterans Day
};

/* ── build ──────────────────────────────────────────────────────────────────────────────────── */

/** @type {Array<{d:string,t:string,et?:string,note?:string}>} */
const events = [];

for (const d of FOMC) events.push({ d, t: 'fomc' });
for (const d of CPI) events.push({ d, t: 'cpi' });
for (const d of NFP) events.push({ d, t: 'nfp' });
for (const [d, est] of GDP) events.push({ d, t: 'gdp', note: est });

for (const ev of eiaCrudeEvents(RANGE.from, RANGE.to)) events.push(ev);

// Sort by date, then by type, for a stable, review-friendly file.
const TYPE_ORDER = { fomc: 0, cpi: 1, nfp: 2, gdp: 3, eiaCl: 4 };
events.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : TYPE_ORDER[a.t] - TYPE_ORDER[b.t]));

const file = {
  schemaVersion: SCHEMA_VERSION,
  updated: new Date().toISOString().slice(0, 10),
  range: RANGE,
  types: TYPES,
  events,
};

// Readable-but-compact layout: pretty header + `types` map, one event object per line.
await writeFile(OUT, render(file));
console.log(`Wrote econ-events.json — ${events.length} events (${RANGE.from} … ${RANGE.to}).`);
const counts = {};
for (const e of events) counts[e.t] = (counts[e.t] || 0) + 1;
for (const [t, n] of Object.entries(counts)) console.log(`  ${t}\t${n}`);

/* ── helpers ────────────────────────────────────────────────────────────────────────────────── */

/** EIA weekly crude events over [from,to] — Wednesday 10:30 ET, holiday-shifted to Thursday. */
function eiaCrudeEvents(from, to) {
  const out = [];
  // Walk every Wednesday in range.
  let d = firstWeekday(new Date(from + 'T00:00:00Z'), 3); // 3 = Wednesday (UTC-noon dates avoid DST)
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    const wedIso = iso(d);
    // Did a Monday/Tuesday holiday this week push the release to Thursday?
    const monday = addDays(d, -2);
    const tuesday = addDays(d, -1);
    const holidayThisWeek = US_HOLIDAYS.has(iso(monday)) || US_HOLIDAYS.has(iso(tuesday)) || US_HOLIDAYS.has(wedIso);
    const thuIso = iso(addDays(d, 1));
    // A pinned published shift wins outright (its date + off-hour).
    const pinned = Object.keys(EIA_HOLIDAY_SHIFTS).find(k => k === wedIso || k === thuIso || k === iso(monday));
    if (pinned) {
      out.push({ d: pinned, t: 'eiaCl', et: EIA_HOLIDAY_SHIFTS[pinned], note: 'holiday' });
    } else if (holidayThisWeek) {
      out.push({ d: thuIso, t: 'eiaCl', et: '12:00', note: 'holiday' });
    } else {
      out.push({ d: wedIso, t: 'eiaCl' });
    }
    d = addDays(d, 7);
  }
  return out;
}

/** US federal-holiday set (observed dates that can shift a WPSR week) for [y0,y1]. */
function buildUsHolidays(y0, y1) {
  const set = new Set();
  for (let y = y0; y <= y1; y++) {
    set.add(iso(new Date(Date.UTC(y, 0, 1)))); // New Year's Day
    set.add(iso(nthWeekdayOfMonth(y, 0, 1, 3))); // MLK — 3rd Mon Jan
    set.add(iso(nthWeekdayOfMonth(y, 1, 1, 3))); // Presidents' — 3rd Mon Feb
    set.add(iso(lastWeekdayOfMonth(y, 4, 1))); // Memorial — last Mon May
    set.add(iso(new Date(Date.UTC(y, 5, 19)))); // Juneteenth (fixed)
    set.add(iso(new Date(Date.UTC(y, 6, 4)))); // Independence Day
    set.add(iso(nthWeekdayOfMonth(y, 8, 1, 1))); // Labor — 1st Mon Sep
    set.add(iso(nthWeekdayOfMonth(y, 9, 1, 2))); // Columbus — 2nd Mon Oct
    set.add(iso(new Date(Date.UTC(y, 10, 11)))); // Veterans Day (fixed)
    set.add(iso(nthWeekdayOfMonth(y, 10, 4, 4))); // Thanksgiving — 4th Thu Nov
    set.add(iso(new Date(Date.UTC(y, 11, 25)))); // Christmas
  }
  return set;
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}
/** First date >= d whose UTC weekday === wd (0=Sun..6=Sat). */
function firstWeekday(d, wd) {
  const c = new Date(d);
  while (c.getUTCDay() !== wd) c.setUTCDate(c.getUTCDate() + 1);
  return c;
}
/** nth (1-based) `wd` weekday of month `m` (0=Jan) in year `y`. */
function nthWeekdayOfMonth(y, m, wd, nth) {
  const first = new Date(Date.UTC(y, m, 1));
  const offset = (wd - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(y, m, 1 + offset + (nth - 1) * 7));
}
/** last `wd` weekday of month `m` (0=Jan) in year `y`. */
function lastWeekdayOfMonth(y, m, wd) {
  const last = new Date(Date.UTC(y, m + 1, 0));
  const offset = (last.getUTCDay() - wd + 7) % 7;
  return new Date(Date.UTC(y, m + 1, 0 - offset));
}

/** Pretty-but-compact render: 2-space header, one event object per line. */
function render(f) {
  const head =
    '{\n' +
    `  "schemaVersion": ${f.schemaVersion},\n` +
    `  "updated": ${JSON.stringify(f.updated)},\n` +
    `  "range": ${JSON.stringify(f.range)},\n` +
    '  "types": {\n' +
    Object.entries(f.types)
      .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(',\n') +
    '\n  },\n' +
    '  "events": [\n' +
    f.events.map(e => '    ' + JSON.stringify(e)).join(',\n') +
    '\n  ]\n}\n';
  return head;
}
