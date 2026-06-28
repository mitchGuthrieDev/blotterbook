// @ts-check
'use strict';
/* Blotterbook app · core — DOM helpers, metrics, formatting, broker/cost model, reference-data
   loading, and the app event bus. A native ES module (A20): everything it shares is `export`ed and
   imported explicitly by the other modules — no shared global scope, no load-order dependence. */

export const SVGNS = 'http://www.w3.org/2000/svg';
export const pad2 = n => String(n).padStart(2, '0');
export const fmtDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// running min/max — avoids Math.min(...arr)/Math.max(...arr), whose argument spread overflows the
// call stack on large per-trade arrays (equity curve / pnl list). compute() walks manually for the
// same reason; this is the shared helper for the chart code (B27).
export function minMax(arr) {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of arr) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}
export const $ = id => document.getElementById(id);
export const on = (id, ev, fn) => {
  const el = $(id);
  if (el) el.addEventListener(ev, fn);
};
/* Page modes (document.body[data-mode]):
     ''        — the main app
     'demo'    — in-memory sample data, never persists (its own trimmed top bar)
     'staging' — a clone of the main app on an ISOLATED IndexedDB, used to trial changes
                 before they reach the main app (features now ship to all surfaces — CH16) */
export const PAGE_MODE = (document.body && document.body.dataset.mode) || '';
export const STAGING_PAGE = PAGE_MODE === 'staging';

/* ------------------------------------------------------------------
   Orientation — how the modules fit together (read this first)

   Native ES modules (A20). partials/app-scripts.html is a single entry —
   <script type="module" src="main.js"> — and main.js imports the rest. Each module
   `export`s what others use and `import`s what it needs: no shared global scope and
   no fixed load order. Module scripts are deferred, so boot() (main.js) runs after
   the DOM is parsed; widgets.js is a side-effect import in main.js so its event
   subscriptions register before boot() emits app:ready.

     core         this file: DOM helpers, metrics, formatting, cost model, refdata, event bus
     render       cards, equity curve, calendar, advanced stats, break-even +
                  the scope/filter/render driver
     data         CSV import, demo data, filters, day-notes journal, session, setup
     ui           collapsible/drag panels, file download, modal a11y + scroll-lock helpers
     export       performance report
     datamanager  Manage-data modal + per-trade editor
     widgets      activity terminal, session pill, workspace templates, card-detail modals (CH16)
     main         the ES-module entry: DOM event wiring + boot()

   Mode flags (derived from document.body[data-mode] above):
     STAGING_PAGE     marks the staging sandbox. Its former feature set (web-grid dashboard,
                      note dots, saved filters, activity terminal, session pill, workspace
                      templates) was promoted to all surfaces (CH16); this flag now gates only
                      the staging ENVIRONMENT — the isolated DB, the one-time sample seeding,
                      and the F5 "open on the initial state" landing flow.
     state.DEMO_MODE  true while the demo's in-memory dataset is loaded; suppresses ALL
                      persistence (nothing is written to IndexedDB).

   Shared mutable cross-module state lives on the `state` object (state.js), accessed as
   state.X — e.g. state.TRADES, state.METRICS_ALL, state.SCOPE, state.calYear/calMonth,
   state.selectedDate, state.JOURNAL_DATES, state.TRADE_META, state.SAVED_FILTERS — because an
   ESM import binding is read-only. The const objects FILTERS/curveSel (render.js) are plain
   exports (only their properties mutate). Persistence is ALWAYS via Store (store.js) — never
   call indexedDB directly from app/render code.
   ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
   App event bus — shared code EMITS action events; widgets.js (loaded on
   every surface since CH16) subscribes to mirror them into the activity
   terminal. emit() stays a harmless no-op on any page without a listener,
   so shared code never names a widget symbol directly. Events: app:ready,
   data:imported, note:saved, trade:deleted, backup:created, data:erased.
   ------------------------------------------------------------------ */
export const BUS = new EventTarget();
export function emit(name, detail) {
  BUS.dispatchEvent(new CustomEvent(name, { detail }));
}
export function onEvent(name, fn) {
  BUS.addEventListener(name, e => fn(/** @type {CustomEvent} */ (e).detail));
}

/* CSV parsing now lives in adapters.js (the imported `Adapters`) — platform-specific
   format detection + normalization to the internal trade shape below. */

/* ============================================================
   Metrics
   ============================================================ */
/** @param {import('./types.js').Trade[]} tr */
export function compute(tr) {
  const n = tr.length,
    pnls = tr.map(t => t.pnl);
  const wins = pnls.filter(p => p > 0),
    losses = pnls.filter(p => p < 0),
    scratch = pnls.filter(p => p === 0);
  const net = pnls.reduce((a, b) => a + b, 0);
  const gp = wins.reduce((a, b) => a + b, 0),
    gl = losses.reduce((a, b) => a + b, 0);
  const pf = gl !== 0 ? gp / Math.abs(gl) : Infinity;
  const avgW = wins.length ? gp / wins.length : 0;
  const avgL = losses.length ? gl / losses.length : 0;
  const wl = losses.length ? avgW / Math.abs(avgL) : Infinity;
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
  const maxDDpct = ddPeakVal > 0 ? (maxDD / ddPeakVal) * 100 : 0; // peak-relative; 0 if peak never went positive
  const maxDDdur = maxDD > 0 ? ddEnd - ddStart : 0; // trades from peak to trough
  // F15: profit concentration — % of total NET profit delivered by the 5 biggest winners. A high
  // figure (or >100%, meaning the rest nets negative) flags reliance on a handful of outlier trades.
  const top5Win = [...wins]
    .sort((a, b) => b - a)
    .slice(0, 5)
    .reduce((a, b) => a + b, 0);
  const concPct = net > 0 ? (top5Win / net) * 100 : null; // null when there's no net profit to concentrate
  const dayMap = new Map();
  for (const t of tr) {
    if (!dayMap.has(t.date)) dayMap.set(t.date, []);
    dayMap.get(t.date).push(t.pnl);
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
  const sortino = downside > 0 ? mean / downside : NaN;
  const months = new Set(tr.map(t => t.date.slice(0, 7))).size;
  // expectancy + per-trade dispersion
  const expectancy = n ? net / n : 0;
  const tmean = expectancy;
  const tStd = n ? Math.sqrt(pnls.reduce((a, p) => a + (p - tmean) ** 2, 0) / n) : 0;
  // long / short split
  const side = k => {
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
export const DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Day-of-week buckets (0=Sun..6=Sat), summing PnL + count per weekday. Shared by compute()
// (Best/Worst Weekday) and the win-rate card modal (cmDow) so the two can't drift (CH23).
export function dowBuckets(trades) {
  const d = Array.from({ length: 7 }, () => ({ pnl: 0, n: 0 }));
  for (const t of trades) {
    const wd = new Date(t.date + 'T00:00:00').getDay();
    d[wd].pnl += t.pnl;
    d[wd].n++;
  }
  return d;
}

/* ============================================================
   Formatting
   ============================================================ */
export const usd = (v, s = true) => {
  if (v === Infinity) return '∞';
  const sign = v < 0 ? '-' : s && v > 0 ? '+' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const money = v => usd(v, false);
export const cls = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

/* ============================================================
   Broker / commission / cost model
   ------------------------------------------------------------
   All-in per-side = broker commission (by micro/standard tier)
   + CME exchange/clearing/NFA fee (by root). Both are editable
   snapshot estimates (mid-2026). See README for sources.
   ============================================================ */

/* Reference data — loaded at runtime from /data/*.json (see loadRefData).
   Populated before any setup/render runs, so call-time access is safe. */
export let EXCH = {}; // root -> exchange/clearing/NFA $ per side
export let MICRO = new Set(); // roots priced at the micro tier
export let EXCH_FALLBACK = { micro: 0.37, std: 1.5 };
export let BROKERS = {}; // key -> {name, comm:{micro,std}}
export let BROKER_ORDER = [];
export let BROKER_FEEDS = {}; // key -> {group: [[label,$/mo],...]}
export let STATES = []; // [abbr, ratePct, name]
export let TAXMODEL = { fedOrdinary: 24, ltcg: 15, ltcgWeight: 0.6, ordinaryWeight: 0.4 };

export function tierOf(root) {
  if (EXCH[root] != null) return MICRO.has(root) ? 'micro' : 'std';
  return root[0] === 'M' && root.length >= 3 ? 'micro' : 'std';
}
export function exchOf(root, tier) {
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
  const man = await fetch('../data/manifest.json?t=' + Date.now(), { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error('manifest ' + r.status);
    return r.json();
  });
  const v = f => (man.files && man.files[f] ? '?v=' + man.files[f] : '');
  const get = f =>
    fetch(`../data/${f}${v(f)}`).then(r => {
      if (!r.ok) throw new Error(f + ' ' + r.status);
      return r.json();
    });
  const [exch, brokers, feeds, tax] = await Promise.all([
    get('exchange-fees.json'),
    get('brokers.json'),
    get('feeds.json'),
    get('state-tax.json'),
  ]);

  EXCH = exch.exchange || {};
  MICRO = new Set(exch.micro || []);
  EXCH_FALLBACK = exch.fallback || EXCH_FALLBACK;

  BROKERS = brokers.brokers || {};
  BROKER_ORDER = brokers.order || Object.keys(BROKERS);

  // resolve string aliases (e.g. "AMP": "CQG") against feeds.shared
  const shared = feeds.shared || {};
  BROKER_FEEDS = {};
  for (const k in feeds.brokerFeeds || {}) {
    const v = feeds.brokerFeeds[k];
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
}

export function curBroker() {
  const e = /** @type {HTMLSelectElement|null} */ (document.getElementById('c_broker'));
  return e && e.value ? e.value : 'AMP';
}
export function rateFor(brokerKey, root) {
  const b = BROKERS[brokerKey] || BROKERS.AMP;
  const tier = tierOf(root),
    exch = exchOf(root, tier);
  return { rate: +(b.comm[tier] + exch).toFixed(4), known: EXCH[root] != null };
}

// Empty/NaN → 0 (an empty field shows its "0" placeholder, so it reads as 0, not a typed value);
// clamp negatives so a typed "-5" can't manufacture a negative cost that inflates net (B13).
export function numIn(id) {
  const e = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
  const v = e ? parseFloat(e.value) : NaN;
  return isNaN(v) ? 0 : Math.max(0, v);
}
export function feedCost() {
  const o = /** @type {HTMLSelectElement|null} */ (document.getElementById('c_feed'));
  const x = o && o.selectedOptions[0] ? parseFloat(o.selectedOptions[0].dataset.cost) : NaN;
  return isNaN(x) ? 0 : x;
}
export function feedName() {
  const o = /** @type {HTMLSelectElement|null} */ (document.getElementById('c_feed'));
  return o && o.value ? o.value.split('|')[0] : '—';
}
export function stateRate() {
  const o = /** @type {HTMLSelectElement|null} */ (document.getElementById('c_state_sel'));
  const x = o && o.selectedOptions[0] ? parseFloat(o.selectedOptions[0].dataset.rate) : NaN;
  return isNaN(x) ? 0 : x;
}
// Section-1256 blended federal rate + a given state rate (%). blendedRate() reads the live DOM
// state select; blendedRateFor() takes the rate as a param so the Svelte cost panel (A32) can pass
// its own value instead of relying on DOM ids.
export function blendedRateFor(stateRatePct) {
  return (TAXMODEL.ltcgWeight * TAXMODEL.ltcg) / 100 + (TAXMODEL.ordinaryWeight * TAXMODEL.fedOrdinary) / 100 + (+stateRatePct || 0) / 100;
}
export function blendedRate() {
  return blendedRateFor(stateRate());
}

/**
 * @param {*} m  Active metrics (compute() result) — reads m.trades / m.net / m.months.
 * @param {*} [inputs]  Optional { broker, platform, feedCost, stateRate } (A32). When omitted the
 *   setup is read from the live DOM (#c_broker/#c_tv/#c_feed/#c_state_sel) — the vanilla path,
 *   unchanged. Negatives are clamped to 0 like numIn()/feedCost() (B13).
 * @returns {import('./types.js').CostModel}
 */
export function costModel(m, inputs) {
  const broker = inputs ? inputs.broker || 'AMP' : curBroker(),
    platform = inputs ? Math.max(0, +inputs.platform || 0) : numIn('c_tv'),
    data = inputs ? Math.max(0, +inputs.feedCost || 0) : feedCost(),
    fixedMo = platform + data;
  const trades = m && m.trades ? m.trades : [];
  const bySym = new Map();
  let totalComm = 0,
    gp = 0,
    gl = 0;
  for (const t of trades) {
    // Round-turn commission is charged per CONTRACT: 2 sides × the per-side rate × qty.
    // Fills-based adapters (and MotiveWave) emit trades with qty>1; close-event exports
    // (e.g. TradingView) have no qty, so (t.qty||1) keeps single-contract data unchanged.
    const q = t.qty || 1;
    const { rate, known } = rateFor(broker, t.root);
    const rt = rate * 2 * q;
    totalComm += rt;
    if (!bySym.has(t.root)) bySym.set(t.root, { root: t.root, count: 0, qty: 0, rate, known, total: 0 });
    const e = bySym.get(t.root);
    e.count++;
    e.qty += q;
    e.total += rt;
    const x = t.pnl - rt;
    if (x > 0) gp += x;
    else if (x < 0) gl += x;
  }
  const months = m ? m.months : 0;
  const fixedPeriod = fixedMo * months;
  const gross = m ? m.net : 0;
  const netPreTax = gross - totalComm - fixedPeriod;
  const tEff = inputs ? blendedRateFor(inputs.stateRate) : blendedRate();
  const tax = netPreTax > 0 ? netPreTax * tEff : 0;
  const afterTax = netPreTax - tax;
  const pf = gl !== 0 ? gp / Math.abs(gl) : gp > 0 ? Infinity : 0;
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
  };
}
