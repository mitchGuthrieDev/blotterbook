'use strict';
/* Blotterbook app · core — metrics, formatting, broker/cost model, reference-data loading, shared
   pure helpers, and the app event bus. A native ES module: everything it shares is `export`ed and
   imported explicitly by the Svelte app + the pure-logic modules. */
import type {
  Trade,
  CostInputs,
  CostModel,
  SymCost,
  Broker,
  FeedGroups,
  TaxModel,
  StateRow,
  RefDataManifest,
  FeeHistoryEntry,
  ExchangeFeesFile,
  BrokersFile,
  FeedsFile,
  StateTaxFile,
} from './types.ts';

export const pad2 = (n: number | string) => String(n).padStart(2, '0');
export const fmtDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// running min/max — avoids Math.min(...arr)/Math.max(...arr), whose argument spread overflows the
// call stack on large per-trade arrays (equity curve / pnl list). compute() walks manually for the
// same reason; this is the shared helper for the chart code (B27).
export function minMax(arr: number[]) {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of arr) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}
// Positive/negative P&L classifier — shared by the dashboard/analytics/reports view-models for
// coloring. A170: exactly-zero (within a cent — float residue) is NEITHER: undefined renders the
// neutral treatment, so a $0.00 KPI isn't green (mirrors cls()'s '' at 0).
export const tone = (n: number): 'pos' | 'neg' | undefined => (Math.abs(n) < 0.005 ? undefined : n > 0 ? 'pos' : 'neg');
// Full month names, index 0 = January — shared by the App dashboard + the reports view-model.
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
// Short month names, index 0 = Jan — shared by the Calendar month picker + the changelog dates.
export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* Page modes (document.body[data-mode]):
     ''        — the main app
     'demo'    — in-memory sample data, never persists
     'staging' — a clone of the main app on an ISOLATED IndexedDB, used to trial changes
                 before they reach the main app (features now ship to all surfaces — CH16) */
// The `typeof document` guard keeps the pure-logic core importable under Node (A29 — the core is
// framework-agnostic + node-tested; see scripts/test-curveandreport.mjs): off-DOM, PAGE_MODE is ''.
export const PAGE_MODE = (typeof document !== 'undefined' && document.body && document.body.dataset.mode) || '';

/* ------------------------------------------------------------------
   Orientation — how the pieces fit together (read this first)

   Post-A33, the app is a Svelte 5 SPA over a framework-agnostic pure-logic core; the vanilla
   view layer (render/data/ui/export/datamanager/widgets/main/state.js + partials/app-*.html) was
   deleted. The source tree is src/{lib,app,site} (A30):

     src/lib/  PURE-LOGIC CORE (native TS, node-tested, framework-agnostic — A29/A61)
       core      this file: metrics (compute), formatting, cost model, refdata loading, event bus,
                 shared pure helpers (sessionOf/isoWeek/niceTicks/axMoney/fmtDur/ratio/num)
       adapters  platform CSV adapters + auto-detect    report  performance-report builder
       store     IndexedDB persistence (+ Store.local)  demostore  in-memory Store for demo
       curveseries  daily gross/net/take series         sampledata  demo CSV
       format    esc/platformLabel + version badge      types  shared interfaces
     src/app/  the journal SPA — App.svelte (sidebar shell) + screens/ + parts/ + lib/ (dashboard.svelte.ts/actions/files/flags/nav/analytics/reports)
     src/site/ marketing/info — Svelte SSG (components prerendered by vite-ssg.mjs)

   Cross-component state is Svelte runes ($state/$derived) inside the components, NOT a shared
   globals object; the active Store is provided via context('bb:store') (real IndexedDB for
   app/staging, in-memory DemoStore for demo). Persistence is ALWAYS via the Store seam — never
   call indexedDB directly from a component.

   Mode flag (derived from document.body[data-mode] above):
     PAGE_MODE === 'staging'  the staging sandbox — isolated DB + one-time sample seeding (App.svelte
                    derives an isStaging local from PAGE_MODE; the old STAGING_PAGE export is retired
                    now that the CH16 cutover ships one app on every surface).
     PAGE_MODE === 'demo'     selects the in-memory DemoStore; the demo suppresses ALL persistence.
   ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
   App event bus — shared code EMITS action events; the Dashboard's
   ActivityTerminal part subscribes to mirror them into the activity
   log. emit() stays a harmless no-op on any page without a listener,
   so shared code never names a component symbol directly. Events:
   app:ready, refdata:loaded, data:loaded, data:imported, note:saved,
   trade:deleted, backup:created, data:erased.
   ------------------------------------------------------------------ */
export const BUS = new EventTarget();
// A188: a small replay buffer — the boot events (app:ready, refdata:loaded, data:loaded) fire
// BEFORE the Dashboard's ActivityTerminal mounts, and an EventTarget keeps no history, so the
// terminal always looked dead. emit() records the last 50 events with a wall-clock stamp; a late
// subscriber backfills from busLog() and then listens live.
export interface BusEntry {
  name: string;
  detail: unknown;
  at: Date;
}
const BUS_LOG: BusEntry[] = [];
export function busLog(): readonly BusEntry[] {
  return BUS_LOG;
}
export function emit(name: string, detail?: unknown) {
  BUS_LOG.push({ name, detail, at: new Date() });
  if (BUS_LOG.length > 50) BUS_LOG.shift();
  BUS.dispatchEvent(new CustomEvent(name, { detail }));
}
// Subscribe to a bus event; returns an unsubscribe function (callers that don't need cleanup —
// the vanilla widgets — can ignore it; the Svelte components capture it for onMount teardown).
export function onEvent(name: string, fn: (detail: unknown) => void) {
  const handler = (e: Event) => fn((e as CustomEvent).detail);
  BUS.addEventListener(name, handler);
  return () => BUS.removeEventListener(name, handler);
}

/* CSV parsing now lives in adapters.js (the imported `Adapters`) — platform-specific
   format detection + normalization to the internal trade shape below. */

/* ============================================================
   Metrics
   ============================================================ */
export function compute(tr: Trade[]) {
  const n = tr.length,
    pnls = tr.map(t => t.pnl);
  const wins = pnls.filter(p => p > 0),
    losses = pnls.filter(p => p < 0),
    scratch = pnls.filter(p => p === 0);
  const net = pnls.reduce((a, b) => a + b, 0);
  const gp = wins.reduce((a, b) => a + b, 0),
    gl = losses.reduce((a, b) => a + b, 0);
  // A170: align the degenerate convention with costModel's guard — no losses AND no wins (empty or
  // all-scratch, e.g. an untraded month scope) is undefined ('—' via ratio()), not '∞'.
  const pf = gl !== 0 ? gp / Math.abs(gl) : gp > 0 ? Infinity : NaN;
  const avgW = wins.length ? gp / wins.length : 0;
  const avgL = losses.length ? gl / losses.length : 0;
  const wl = losses.length ? avgW / Math.abs(avgL) : wins.length ? Infinity : NaN;
  // equity curve + REALIZED max drawdown: walk closed-trade PnL, track running peak and the largest peak-to-trough drop
  // Track best/worst here (running, not Math.max(...pnls) — spreading a large array as
  // args overflows the call stack on big fills exports, blanking the whole dashboard).
  // F15: also track the PEAK-RELATIVE drawdown %, and the drawdown DURATION (trades from the
  // pre-drop peak to the trough). peakIdx remembers which trade set the running peak; when a new
  // deepest drop is found we snapshot the peak value (for %) and the peak→trough span (for duration).
  // peakCurveIdx / ddPeakCurveIdx / ddTroughCurveIdx are CURVE indices (curve[0] is the leading 0),
  // so the drawdown card can mark peak→trough directly off m.curve without re-walking it (CH23).
  let eq = 0,
    peak = 0,
    peakIdx = 0,
    peakCurveIdx = 0,
    maxDD = 0,
    ddPeakVal = 0,
    ddStart = 0,
    ddEnd = 0,
    ddPeakCurveIdx = 0,
    ddTroughCurveIdx = 0,
    best = n ? -Infinity : 0,
    worst = n ? Infinity : 0;
  const curve = [0];
  pnls.forEach((p, idx) => {
    eq += p;
    const ci = idx + 1; // curve index of this running equity
    if (eq > peak) {
      peak = eq;
      peakIdx = idx;
      peakCurveIdx = ci;
    }
    const dd = peak - eq;
    if (dd > maxDD) {
      maxDD = dd;
      ddPeakVal = peak;
      ddStart = peakIdx;
      ddEnd = idx;
      ddPeakCurveIdx = peakCurveIdx;
      ddTroughCurveIdx = ci;
    }
    curve.push(eq);
    if (p > best) best = p;
    if (p < worst) worst = p;
  });
  // A170: when a real drawdown has NO positive prior peak (equity never above 0 — an inception
  // drawdown), the peak-relative % is undefined → null ('—'), not a wrong-looking 0.0%.
  const maxDDpct = ddPeakVal > 0 ? (maxDD / ddPeakVal) * 100 : maxDD > 0 ? null : 0;
  // A170: duration from the CURVE indices (curve[0] is the pre-trade origin), which count the
  // inception case correctly — ddEnd−ddStart was off by one there (peakIdx starts at trade 0).
  const maxDDdur = maxDD > 0 ? ddTroughCurveIdx - ddPeakCurveIdx : 0;
  // F15: profit concentration — % of total NET profit delivered by the 5 biggest winners. A high
  // figure (or >100%, meaning the rest nets negative) flags reliance on a handful of outlier trades.
  const top5Win = [...wins]
    .sort((a, b) => b - a)
    .slice(0, 5)
    .reduce((a, b) => a + b, 0);
  // A170: gate on the CENT-ROUNDED net — raw float dust (e.g. +0.1+0.2−0.3 → 5.6e-17) used to
  // pass `> 0` and render an astronomical percentage.
  const netC = Math.round(net * 100) / 100;
  const concPct = netC > 0 ? (top5Win / netC) * 100 : null; // null when there's no net profit to concentrate
  const dayMap = new Map<string, number[]>();
  for (const t of tr) {
    let arr = dayMap.get(t.date);
    if (!arr) dayMap.set(t.date, (arr = []));
    arr.push(t.pnl);
  }
  const days = [...dayMap.entries()]
    .map(([d, arr]) => ({ date: d, pnl: arr.reduce((a, b) => a + b, 0), trades: arr.length, wins: arr.filter(p => p > 0).length }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const active = days.length;
  const winDays = days.filter(d => d.pnl > 0).length;
  // longest run of consecutive winning (mcw) / losing (mcl) trades; a scratch (0) breaks both runs
  // F15: alongside the consecutive-trade COUNTS, accumulate the running $ of each streak so we can
  // surface the largest winning / losing streak by DOLLARS (cws/cls reset whenever the run breaks).
  let mcw = 0,
    mcl = 0,
    cw = 0,
    cl = 0,
    cws = 0,
    cls = 0,
    maxWinStk = 0,
    maxLossStk = 0;
  for (const p of pnls) {
    if (p > 0) {
      cw++;
      cl = 0;
      cws += p;
      cls = 0;
    } else if (p < 0) {
      cl++;
      cw = 0;
      cls += p;
      cws = 0;
    } else {
      cw = 0;
      cl = 0;
      cws = 0;
      cls = 0;
    }
    mcw = Math.max(mcw, cw);
    mcl = Math.max(mcl, cl);
    maxWinStk = Math.max(maxWinStk, cws);
    maxLossStk = Math.min(maxLossStk, cls);
  }
  // daily-PnL dispersion → Sharpe: population std of per-day PnL (NOT annualized — see Definitions panel caveat)
  const dv = days.map(d => d.pnl);
  const mean = dv.reduce((a, b) => a + b, 0) / (dv.length || 1);
  const variance = dv.length ? dv.reduce((a, b) => a + (b - mean) ** 2, 0) / dv.length : 0;
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? mean / sd : NaN;
  // F15: Sortino — same daily mean over the DOWNSIDE deviation only (population RMS of negative days,
  // target 0). Penalizes losing-day volatility, not the upside swings Sharpe also punishes.
  const downside = Math.sqrt(dv.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / (dv.length || 1));
  // A170: no losing days + positive mean → ∞ (matching the pf convention) instead of a blank
  // beside a valid Sharpe; no data / zero mean stays undefined ('—').
  const sortino = downside > 0 ? mean / downside : mean > 0 ? Infinity : NaN;
  const months = new Set(tr.map(t => t.date.slice(0, 7))).size;
  // expectancy + per-trade dispersion
  const expectancy = n ? net / n : 0;
  const tmean = expectancy;
  const tStd = n ? Math.sqrt(pnls.reduce((a, p) => a + (p - tmean) ** 2, 0) / n) : 0;
  // long / short split
  const side = (k: string) => {
    const s = tr.filter(t => t.side === k);
    const p = s.reduce((a, t) => a + t.pnl, 0);
    return { n: s.length, pnl: p, wins: s.filter(t => t.pnl > 0).length };
  };
  const long = side('long'),
    short = side('short');
  // Day-of-week aggregation (0=Sun..6=Sat). Each trade's calendar date is bucketed by its local
  // weekday; we sum total PnL and count per weekday, then derive the per-trade AVERAGE (avg=pnl/n).
  // CH18: bestDow / worstDow are now the active weekdays (n>0) with the highest / lowest AVERAGE
  // PnL per trade — surfaced as "Best/Worst Weekday". Earlier this ranked by *total* PnL, which just
  // tracked which day you traded most/heaviest (the demo "worst" weekday was still a big profit).
  // Averaging makes the two days comparable; the raw total + trade count stay on the object for the
  // UI, and small per-day samples are still noisy (flagged in the Definitions panel).
  const dow = dowBuckets(tr);
  const dowActive = dow.map((d, i) => ({ i, ...d, avg: d.n ? d.pnl / d.n : 0 })).filter(d => d.n);
  const bestDow = dowActive.length ? dowActive.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  const worstDow = dowActive.length ? dowActive.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;
  return {
    n,
    winRate: n ? (100 * wins.length) / n : 0,
    trades: tr,
    wins: wins.length,
    losses: losses.length,
    scratch: scratch.length,
    net,
    gp,
    gl,
    pf,
    avgW,
    avgL,
    wl,
    maxDD,
    maxDDpct,
    maxDDdur,
    concPct,
    curve,
    pnls,
    months,
    best,
    worst,
    days,
    active,
    winDays,
    avgDaily: active ? net / active : 0,
    avgTrades: active ? n / active : 0,
    winDayPct: active ? (100 * winDays) / active : 0,
    mcw,
    mcl,
    maxWinStk,
    maxLossStk,
    recovery: maxDD > 0 ? net / maxDD : net > 0 ? Infinity : NaN,
    sharpe,
    sortino,
    ddPeakIdx: maxDD > 0 ? ddPeakCurveIdx : null,
    ddTroughIdx: maxDD > 0 ? ddTroughCurveIdx : null,
    expectancy,
    tStd,
    long,
    short,
    bestDow,
    worstDow,
    bestDay: days.length ? days.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null,
    worstDay: days.length ? days.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null,
    lastDate: tr.length ? tr[tr.length - 1].date : '—',
    firstDate: tr.length ? tr[0].date : '—',
  };
}
/** The full metrics object compute() returns — derived from its implementation so the two can't drift. */
export type Metrics = ReturnType<typeof compute>;

export const DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Per-tag P&L/win/count buckets over an externally-supplied tag lookup — tags live in trademeta,
// not on the Trade itself, so the caller passes the accessor. A trade with N tags counts in each
// of its N tag buckets; `untagged` is the DISJOINT remainder, whose size doubles as tag coverage
// (R17/A165 — the actionable successor to the retired "Tagged trades" stat). Node-tested.
export function tagBuckets(trades: Trade[], tagsFor: (t: Trade) => string[]) {
  const tags = new Map<string, { pnl: number; n: number; wins: number }>();
  const untagged = { pnl: 0, n: 0, wins: 0 };
  for (const t of trades) {
    const list = tagsFor(t);
    const into = (b: { pnl: number; n: number; wins: number }) => {
      b.pnl += t.pnl;
      b.n++;
      if (t.pnl > 0) b.wins++;
    };
    if (!list || !list.length) {
      into(untagged);
      continue;
    }
    for (const tag of list) {
      let b = tags.get(tag);
      if (!b) tags.set(tag, (b = { pnl: 0, n: 0, wins: 0 }));
      into(b);
    }
  }
  return { tags, untagged };
}
// Day-of-week buckets (0=Sun..6=Sat), summing PnL + count per weekday. Shared by compute()
// (Best/Worst Weekday) and the win-rate card modal (cmDow) so the two can't drift (CH23).
export function dowBuckets(trades: Trade[]) {
  const d = Array.from({ length: 7 }, () => ({ pnl: 0, n: 0 }));
  for (const t of trades) {
    const wd = new Date(t.date + 'T00:00:00').getDay();
    d[wd].pnl += t.pnl;
    d[wd].n++;
  }
  return d;
}
// The Calendar 'By weekday' rows (A174/A194): sum P&L per weekday index (0=Sun..6=Sat) and keep
// Mon–Fri always; weekend rows only when they actually carry P&L (Globex Sunday sessions count in
// the month total, so silently dropping them made the bars not reconcile). Extracted from
// Calendar.svelte so the filter rule is node-testable.
export function dowPnlRows(items: Array<{ dow: number; pnl: number }>): Array<{ lbl: string; i: number; pnl: number }> {
  const all = DOW_LABEL.map((lbl, i) => ({ lbl, i, pnl: 0 }));
  for (const it of items) if (it.dow >= 0 && it.dow <= 6) all[it.dow].pnl += it.pnl;
  return all.filter(d => (d.i >= 1 && d.i <= 5) || d.pnl !== 0);
}

/* ============================================================
   Formatting
   ============================================================ */
export const usd = (v: number, s = true) => {
  if (v === Infinity) return '∞';
  if (Math.abs(v) < 0.005) v = 0; // A170: sub-cent float residue must not render a red "-$0.00"
  const sign = v < 0 ? '-' : s && v > 0 ? '+' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const money = (v: number) => usd(v, false);
// signed whole-dollar with thousands grouping: +$1,234 / -$56 / +$0. Compact money for tight UI slots
// (calendar cells) where the full precision lives in a tooltip (A92 — shared so it can't drift).
// A170: sign taken from the ROUNDED value (usdWhole(-0.4) used to render '-$0').
export const usdWhole = (v: number) => {
  const r = Math.round(v);
  return (r < 0 ? '-' : '+') + '$' + Math.abs(r).toLocaleString('en-US');
};
export const cls = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
// Ratio/number formatters shared by the Svelte overview / advanced-stats / stat-card modal so the
// "∞ / —" handling can't drift between them.
export const ratio = (v: number) => (v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(2) : '—');
export const num = (v: number) => (v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(2) : '—'); // A170: ∞ renders ∞, like ratio()
// Compact duration (ms → "45s" / "12m" / "3h 20m" / "2d 4h"), shared by the vanilla advanced-stats
// hold-time row and the Svelte port (A29/A47) so the two read identically.
export function fmtDur(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 90) return s + 's';
  const mn = Math.round(s / 60);
  if (mn < 90) return mn + 'm';
  const h = Math.floor(mn / 60),
    rem = mn % 60;
  if (h < 24) return h + 'h' + (rem ? ' ' + rem + 'm' : '');
  const d = Math.floor(h / 24);
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}
/* "nice" axis ticks spanning [min,max] with ~count steps. Shared by the vanilla curve and the
   Svelte curve (A29/A43) so axis framing matches. */
export function niceTicks(min: number, max: number, count: number) {
  const span = max - min || 1;
  const rawStep = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step,
    hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}
/* compact money for axis labels: $1.2k / $850 / -$3.4k / $1.5M.
   A174: tier off the ROUNDED value (999.5 used to render "$1000" beside "$1.0k") + an M tier
   (1.5e6 used to render "$1500k"). */
export function axMoney(v: number) {
  const a = Math.round(Math.abs(v)),
    s = v < 0 ? '-' : '';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1000) return s + '$' + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
  return s + '$' + a;
}
/* SVG polyline path ("M…L…L…") from a series of y-values, given index→x and value→y scales. Shared by
   the equity curve and the stat-card mini-charts (A92) so their geometry can't drift. */
export const linePath = (vals: number[], x: (i: number) => number, y: (v: number) => number) =>
  vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

/* ============================================================
   Trade/date classifiers shared across surfaces (kept here so the vanilla view and the Svelte
   app use ONE definition — A29). sessionOf: RTH = 09:30–16:00 by the export's own clock time,
   else ETH (extended). isoWeek: ISO-8601 week number for the calendar's Week column.
   ============================================================ */
export const sessionOf = (t: Trade) => {
  const hm = (t.time || '').slice(11, 16);
  return hm && hm >= '09:30' && hm < '16:00' ? 'rth' : 'eth';
};
// ISO-8601 week number (A58). Shift the date to the Thursday of its week (ISO weeks belong to the
// year containing their Thursday), then count whole weeks from Jan 4 (always in week 1). Math.round
// — not floor — is correct here: the inner term lands on a near-integer multiple of 7, and rounding
// absorbs the sub-day drift so the 52/53 year boundary maps to the right week (see test-curveandreport).
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dn + 3);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - y0.getTime()) / 864e5 - 3 + ((y0.getUTCDay() + 6) % 7)) / 7);
}
// Sunday-first month-grid scaffold: leading nulls up to the 1st's weekday, then day numbers,
// then trailing nulls to a whole number of weeks. Shared by the Dashboard / Calendar / Reports
// month grids so the scaffolding can't drift.
export function monthCells(firstDow: number, daysInMonth: number): (number | null)[] {
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/* ============================================================
   Broker / commission / cost model
   ------------------------------------------------------------
   All-in per-side = broker commission (by micro/standard tier)
   + CME exchange/clearing/NFA fee (by root). Both are editable
   snapshot estimates (mid-2026). See README for sources.
   ============================================================ */

/* Reference data — loaded at runtime from /data/*.json (see loadRefData).
   Populated before any setup/render runs, so call-time access is safe. */
export let EXCH: Record<string, number> = {}; // root -> exchange/clearing/NFA $ per side
export let MICRO = new Set<string>(); // roots priced at the micro tier
export let NOT_MICRO = new Set<string>(); // full-size roots the M-prefix heuristic would misprice (A171)
export let EXCH_FALLBACK = { micro: 0.37, std: 1.5 };
// F30: effective-dated fee periods (oldest first). Each entry holds the values that applied to
// trades ON OR BEFORE its `until`; a root absent from an entry falls through to the next-newer
// period and finally the current EXCH map. CME adjusts these roughly every February — the
// documented changes live in exchange-fees.json `history` with citations.
export let EXCH_HISTORY: FeeHistoryEntry[] = [];
export let BROKERS: Record<string, Broker> = {}; // key -> {name, comm:{micro,std}}
export let BROKER_ORDER: string[] = [];
export let BROKER_FEEDS: Record<string, FeedGroups> = {}; // key -> {group: [[label,$/mo],...]}
export let STATES: StateRow[] = []; // [abbr, ratePct, name]
export let TAXMODEL: TaxModel = { fedOrdinary: 24, ltcg: 15, ltcgWeight: 0.6, ordinaryWeight: 0.4 };

export function tierOf(root: string): 'micro' | 'std' {
  // A171: the explicit micro list wins regardless of fee-table membership (SIL/2YY/10Y/30Y don't
  // start with M); any other root with a known fee — or on the explicit notMicro list (MWE) — is
  // standard. The M-prefix heuristic survives only as a last resort for unknown roots.
  if (MICRO.has(root)) return 'micro';
  if (EXCH[root] != null || NOT_MICRO.has(root)) return 'std';
  return root[0] === 'M' && root.length >= 3 ? 'micro' : 'std';
}
export function exchOf(root: string, tier: 'micro' | 'std', date?: string) {
  // F30: a dated lookup scans the effective periods oldest→newest and takes the first one that
  // both covers the date AND lists the root; anything else falls through to the current values.
  // No date (the default) = current, so date-agnostic callers are unchanged.
  if (date) {
    for (const h of EXCH_HISTORY) if (date <= h.until && h.exchange[root] != null) return h.exchange[root];
  }
  return EXCH[root] != null ? EXCH[root] : tier === 'micro' ? EXCH_FALLBACK.micro : EXCH_FALLBACK.std;
}

export const DEMO_BROKER = 'AMP',
  DEMO_FEED = 'Bundle — All CME markets|15',
  DEMO_STATE = 'AR';

/* ------------------------------------------------------------
   Runtime fetch of reference data, cache-busted by content hash.
   manifest.json (no-cache) maps each file to a short hash; each
   data file is then fetched as `<file>?v=<hash>` so it can be
   cached indefinitely yet still update the instant its bytes change.
   ------------------------------------------------------------ */
export async function loadRefData() {
  // Fetched JSON is typed at the boundary (A162) — the /data/* files own these shapes (types.ts).
  const man: RefDataManifest = await fetch('../data/manifest.json?t=' + Date.now(), { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error('manifest ' + r.status);
    return r.json() as Promise<RefDataManifest>;
  });
  const v = (f: string) => (man.files && man.files[f] ? '?v=' + man.files[f] : '');
  const get = <T>(f: string): Promise<T> =>
    fetch(`../data/${f}${v(f)}`).then(r => {
      if (!r.ok) throw new Error(f + ' ' + r.status);
      return r.json() as Promise<T>;
    });
  const [exch, brokers, feeds, tax] = await Promise.all([
    get<ExchangeFeesFile>('exchange-fees.json'),
    get<BrokersFile>('brokers.json'),
    get<FeedsFile>('feeds.json'),
    get<StateTaxFile>('state-tax.json'),
  ]);

  EXCH = exch.exchange || {};
  MICRO = new Set(exch.micro || []);
  NOT_MICRO = new Set(exch.notMicro || []);
  EXCH_FALLBACK = exch.fallback || EXCH_FALLBACK;
  // F30: sort ascending by `until` so the dated lookup can take the FIRST matching period.
  EXCH_HISTORY = [...(exch.history || [])].sort((a, b) => (a.until < b.until ? -1 : 1));

  BROKERS = brokers.brokers || {};
  BROKER_ORDER = brokers.order || Object.keys(BROKERS);

  // resolve string aliases (e.g. "AMP": "CQG") against feeds.shared
  const shared = feeds.shared || {};
  const brokerFeeds = feeds.brokerFeeds || {};
  BROKER_FEEDS = {};
  for (const k in brokerFeeds) {
    const v = brokerFeeds[k];
    BROKER_FEEDS[k] = typeof v === 'string' ? shared[v] || {} : v;
  }

  STATES = tax.states || [];
  TAXMODEL = Object.assign(TAXMODEL, tax.model || {});
  // The Section-1256 federal blend assumes ltcgWeight + ordinaryWeight === 1 (the 60/40
  // split). Normalize if loaded data drifts, so a malformed state-tax.json can't silently
  // skew take-home (B8).
  const wsum = (+TAXMODEL.ltcgWeight || 0) + (+TAXMODEL.ordinaryWeight || 0);
  if (wsum > 0 && Math.abs(wsum - 1) > 1e-9) {
    console.warn('1256 tax weights summed to ' + wsum + ', not 1 — normalizing.');
    TAXMODEL.ltcgWeight /= wsum;
    TAXMODEL.ordinaryWeight /= wsum;
  }
  emit('refdata:loaded');
}

// F30: the broker commission effective on `date` — scans rateHistory (oldest first) for the first
// period covering the date, else the current tiers. No history (the norm) = current for all dates.
function commOf(b: Broker, tier: 'micro' | 'std', date?: string): number {
  if (date && b.rateHistory) for (const h of b.rateHistory) if (date <= h.until && h.comm[tier] != null) return h.comm[tier];
  return b.comm[tier];
}

/** All-in per-side rate for a broker+root — dated (F30) when a trade date is passed, current otherwise. */
export function rateFor(brokerKey: string, root: string, date?: string) {
  const b = BROKERS[brokerKey] || BROKERS.AMP;
  const tier = tierOf(root);
  return { rate: +(commOf(b, tier, date) + exchOf(root, tier, date)).toFixed(4), known: EXCH[root] != null };
}

// Round-turn commission for one trade: 2 sides × the per-side rate × contracts. Close-event
// exports (e.g. TradingView) have no qty, so (qty || 1) keeps single-contract data unchanged.
// ONE definition — shared by costModel, curveseries, and the blotter/editor row mappers.
export const roundTurn = (rate: number, qty?: number) => rate * 2 * (qty || 1);

// Section-1256 blended federal rate + a given state rate (%). Takes the rate as a param so the cost
// panel passes its own value (A32) — no DOM coupling.
export function blendedRateFor(stateRatePct?: number | string) {
  return (
    (TAXMODEL.ltcgWeight * TAXMODEL.ltcg) / 100 + (TAXMODEL.ordinaryWeight * TAXMODEL.fedOrdinary) / 100 + (Number(stateRatePct) || 0) / 100
  );
}

/**
 * Active metrics + the cost setup → commissions, subscriptions, tax, take-home (A32). Negatives are
 * clamped to 0 (B13). (A33: the old DOM-read fallback was removed — all callers pass inputs explicitly.)
 */
// Whole calendar months spanned by [first, last] inclusive (each a `YYYY-MM-DD` or '—'), for the
// elapsed-span subscription accrual (A117). 0 when there are no trades. Shared shape with
// curveseries' month walk so the cost panel and the curve charge the identical number of months.
export function spanMonths(first?: string, last?: string): number {
  if (!first || first === '—' || !last || last === '—') return 0;
  const [fy, fm] = first.slice(0, 7).split('-').map(Number);
  const [ly, lm] = last.slice(0, 7).split('-').map(Number);
  // A173: clamp — reversed inputs (last < first) used to return a NEGATIVE month count, turning
  // the subscription accrual into a credit. Both dates present spans at least one month.
  return Math.max(1, (ly - fy) * 12 + (lm - fm) + 1);
}

export function costModel(m: Metrics, inputs: CostInputs = {}): CostModel {
  const broker = inputs.broker || 'AMP',
    platform = Math.max(0, Number(inputs.platform) || 0),
    data = Math.max(0, Number(inputs.feedCost) || 0),
    fixedMo = platform + data;
  const trades = m && m.trades ? m.trades : [];
  const bySym = new Map<string, SymCost>();
  let totalComm = 0,
    actualComm = 0,
    actualCommTrades = 0,
    gp = 0,
    gl = 0;
  for (const t of trades) {
    // Round-turn commission is charged per CONTRACT: 2 sides × the per-side rate × qty.
    // Fills-based adapters (and MotiveWave) emit trades with qty>1; close-event exports
    // (e.g. TradingView) have no qty, so (t.qty||1) keeps single-contract data unchanged.
    // A208: a trade carrying an ACTUAL commission from its source CSV uses it VERBATIM (it's the
    // whole round-turn cost, qty already priced in by the broker) — the model only covers the rest.
    const q = t.qty || 1;
    // F30: price each trade at the rate effective on ITS date (falls back to current when no
    // history covers it). bySym's display `rate` below stays the current rate — a mixed-period
    // symbol totals correctly but shows today's rate as the reference figure.
    const { rate, known } = rateFor(broker, t.root, t.date);
    const hasActual = t.commission != null && Number.isFinite(t.commission);
    const rt = hasActual ? (t.commission as number) : roundTurn(rate, q);
    totalComm += rt;
    let e = bySym.get(t.root);
    // The row's reference `rate` is the CURRENT rate (one extra lookup per new symbol), not
    // whichever dated rate the first trade happened to carry.
    if (!e) bySym.set(t.root, (e = { root: t.root, count: 0, qty: 0, rate: rateFor(broker, t.root).rate, known, total: 0, actual: 0 }));
    e.count++;
    e.qty += q;
    e.total += rt;
    if (hasActual) {
      e.actual++;
      actualComm += rt;
      actualCommTrades++;
    }
    const x = t.pnl - rt;
    if (x > 0) gp += x;
    else if (x < 0) gl += x;
  }
  // A117: fixed subscriptions (platform + data feed) are billed EVERY calendar month you hold them,
  // not only the months you happened to trade — so accrue them over the full span from the first to
  // the last trade (inclusive, gap months counted). Active-months-only under-counts a sporadic
  // trader's real cost. Mirrored in curveseries.dailySeries() so the curve endpoint still reconciles.
  const months = m ? spanMonths(m.firstDate, m.lastDate) : 0;
  const fixedPeriod = fixedMo * months;
  const gross = m ? m.net : 0;
  const netPreTax = gross - totalComm - fixedPeriod;
  const tEff = blendedRateFor(inputs.stateRate);
  const tax = netPreTax > 0 ? netPreTax * tEff : 0;
  const afterTax = netPreTax - tax;
  // A170: same degenerate convention as compute()'s pf — no wins and no losses is undefined
  // (NaN → '—' via ratio()), not 0.00; the two PF figures must agree on the empty set.
  const pf = gl !== 0 ? gp / Math.abs(gl) : gp > 0 ? Infinity : NaN;
  const contracts = trades.reduce((a, t) => a + (t.qty || 1), 0);
  return {
    broker,
    platform,
    data,
    fixedMo,
    totalComm,
    months,
    fixedPeriod,
    gross,
    netPreTax,
    tEff,
    tax,
    afterTax,
    pfGP: gp,
    pfGL: gl,
    pf,
    n: trades.length,
    contracts,
    bePer: trades.length ? (totalComm + fixedPeriod) / trades.length : 0,
    bySym: [...bySym.values()].sort((a, b) => b.total - a.total),
    actualCommTrades,
    actualComm,
  };
}

// A171: roots whose commission uses the FALLBACK per-side rate (root not in the fee table) — the
// UI marks these with an asterisk so estimated commissions aren't indistinguishable from table rates.
// A208: a root whose trades ALL carry actual CSV commissions never used the fallback — don't flag it.
export const estimatedCommRoots = (c: CostModel): string[] => c.bySym.filter(s => !s.known && s.actual < s.count).map(s => s.root);
