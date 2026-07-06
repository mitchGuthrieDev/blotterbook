'use strict';
import { pad2 } from './core.ts';
import { checkCsvText } from './intake.ts';
import type { Trade, Fill, Row, Adapter, Detected, ParseResult } from './types.ts';
/* ============================================================
   Platform CSV adapters + format auto-detection
   ------------------------------------------------------------
   Parsing is keyed to the trading *platform* the CSV came from
   (TradingView, Tradovate, …) — NOT the broker. Every adapter
   normalizes its export into Blotterbook's internal trade shape:

       { time, date, pnl, symbol, root, side
         [, qty, entryTime, exitTime, holdMs] }

   so compute() / costModel() never change. Two export styles:
     • "closed"  — each row is a finished position w/ realized PnL
                   (TradingView, MotiveWave).
     • "fills"   — individual buy/sell executions; pairFills() runs
                   a FIFO round-trip matcher to build closed trades
                   (and finally unlocks hold time).

   Adapters for platforms we don't yet have real exports for are
   marked `beta:true` — built from documented formats + synthetic
   tests; verify against a real export before trusting the numbers.
   ============================================================ */

/* ---------- low-level CSV ---------- */
// Quote-aware splitter; auto-detects comma vs tab vs semicolon (Sierra Chart uses tabs; an
// EU-locale Excel re-save emits semicolons — A168: a ';' file used to collapse each line into one
// cell and import with pnl = the year, silently).
function parseCSV(text: string, delim?: string): Row[] {
  if (delim == null) {
    const firstLine = text.slice(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n'));
    const counts: Array<[string, number]> = [
      ['\t', firstLine.split('\t').length],
      [';', firstLine.split(';').length],
      [',', firstLine.split(',').length],
    ];
    counts.sort((a, b) => b[1] - a[1]);
    delim = counts[0][1] > 1 ? counts[0][0] : ',';
  }
  const rows: Row[] = [];
  let i = 0,
    field = '',
    row: Row = [],
    q = false;
  const n = text.length;
  const push = () => {
    row.push(field);
    field = '';
  };
  const eol = () => {
    push();
    if (row.some(c => c !== '')) rows.push(row);
    row = [];
  }; // drop all-empty lines
  while (i < n) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === delim) push();
      else if (c === '\n') eol();
      else if (c === '\r') {
        /* skip CR */
      } else field += c;
    }
    i++;
  }
  if (field !== '' || row.length) eol();
  return rows;
}

/* ---------- helpers ---------- */
// Futures root: MESM2025 → MES, M2KZ2025 → M2K, MES1! → MES, CME_MINI:ES1! → ES,
// F.US.MESM25 → MES, ESM25-CME / MESM25.CME → ES / MES (A168: service prefixes + venue suffixes
// used to defeat the month-code strip → $1/pt fallback point value and a wrong commission tier).
function rootSym(s: string) {
  if (!s) return '?';
  s = s.toUpperCase().trim().replace(/^.*:/, '').replace(/^\//, ''); // drop exchange prefix and thinkorswim "/" futures marker
  s = s.replace(/^F\.[A-Z]{2}\./, ''); // CQG/Sierra service prefix (F.US.MESM25)
  s = s.replace(/[-.](CME|CBOT|CBT|NYMEX|NYM|COMEX|CMX|GLOBEX|CEC|FUT)$/, ''); // venue suffixes
  s = s.replace(/[FGHJKMNQUVXZ]\d{1,4}$/, '').replace(/\d*!$/, '');
  s = s.replace(/[^A-Z0-9._-]/g, ''); // restrict to a safe symbol charset so a crafted CSV symbol can't inject HTML downstream
  return s || '?';
}

// tolerant number: "$1,234.50" → 1234.5, "(123.45)" → -123.45, EU "1.234,50" → 1234.5
function num(x: unknown): number {
  if (x == null) return NaN;
  let s = String(x).trim();
  if (!s) return NaN;
  const neg = /^\$?\(.*\)$/.test(s); // accounting-style negatives, incl. currency-prefixed "$(6.25)" (Tradovate/NT Performance)
  s = s.replace(/[()$\s]/g, '').replace(/−/g, '-'); // strip parens/$/whitespace; Unicode minus → ASCII (A174)
  // A174: trailing-minus exports ("123.45-") — carry the sign to the front instead of silently
  // dropping it (parseFloat stops at a trailing '-', flipping a loss into a gain).
  if (/^[^-]+-$/.test(s)) s = '-' + s.slice(0, -1);
  // A174: scientific notation parses as such — "1e3" used to read as 13 once the 'e' was stripped.
  if (/^[-+]?\d+(?:\.\d+)?[eE][-+]?\d+$/.test(s)) {
    const sci = Number(s);
    return isNaN(sci) ? NaN : neg ? -Math.abs(sci) : sci;
  }
  // Decide thousands vs decimal separators, supporting BOTH US (1,234.50) and EU (1.234,50):
  const hasDot = s.indexOf('.') >= 0,
    hasComma = s.indexOf(',') >= 0;
  if (hasDot && hasComma) {
    // the right-most separator is the decimal point; the other groups thousands
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // only commas: a lone comma with !=3 trailing digits is a decimal ("12,34"); else thousands ("1,234").
    // KNOWN LIMITATION (B24/B42): a genuine EU 3-decimal value ("0,123" = 0.123) is ambiguous with US
    // thousands and is read here as thousands → 123. Futures PnL/prices virtually never carry exactly 3
    // decimal places, and gating thousands on a prior separator would wrongly turn US "1,234" into 1.234,
    // so this resolves toward thousands by design.
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length !== 3 ? parts[0] + '.' + parts[1] : s.replace(/,/g, '');
  } else if (hasDot) {
    // only dots: if more than one, the last is the decimal point and the rest group thousands.
    // KNOWN LIMITATION (B24 mirror, A174): a lone dot with exactly 3 decimals ("1.234") is ambiguous
    // with EU dot-thousands (= 1234) and is read as a US decimal by design — the exact inverse of the
    // comma rule above, and the right call for the same reason (US exports dominate).
    const i = s.lastIndexOf('.');
    if (s.indexOf('.') !== i) s = s.slice(0, i).replace(/\./g, '') + '.' + s.slice(i + 1);
  }
  s = s.replace(/[^0-9.-]/g, ''); // drop any stray currency letters/symbols
  const v = parseFloat(s);
  return isNaN(v) ? NaN : neg ? -Math.abs(v) : v;
}

// Date-order hint for slash dates, decided ONCE per file by parse() (see detectDateOrder).
// 'mdy' | 'dmy' force a column-wide interpretation; 'auto' falls back to the per-value heuristic
// (used by standalone normTime callers/tests). This prevents one file from mixing M/D/Y and D/M/Y
// rows just because only some days happen to exceed 12.
let DATE_ORDER: 'auto' | 'mdy' | 'dmy' = 'auto';
function detectDateOrder(rows: Row[]): 'auto' | 'mdy' | 'dmy' {
  // A168: decide from cells that ARE dates (anchored full-cell match), not from any fragment
  // anywhere in the raw text — a stray "14/3/2026" inside a note/description cell used to
  // silently re-date the entire import.
  const re = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}(?:[ ,T].*)?$/;
  let dayFirst = false,
    monthFirst = false;
  for (const row of rows)
    for (const cell of row) {
      const m = re.exec(String(cell).trim().replace(/^"|"$/g, ''));
      if (!m) continue;
      const a = +m[1],
        b = +m[2];
      if (a > 12 && b <= 12)
        dayFirst = true; // field-1 can't be a month → D/M/Y
      else if (b > 12 && a <= 12) monthFirst = true; // field-2 can't be a month → M/D/Y
    }
  // If a file shows both, it's genuinely inconsistent — leave it to the per-row heuristic.
  return dayFirst && !monthFirst ? 'dmy' : monthFirst && !dayFirst ? 'mdy' : 'auto';
}

// Normalize any timestamp to canonical "YYYY-MM-DD HH:MM:SS".
function normTime(s: unknown): string {
  if (!s) return '';
  let str = String(s).trim().replace(/^"|"$/g, '');
  // A168: the separator set includes ',' — IBKR quotes "YYYY-MM-DD, HH:MM:SS", which used to lose
  // its time (every fill at midnight → hold time and session analytics silently wrong).
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T,]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])} ${pad2(m[4] || 0)}:${pad2(m[5] || 0)}:${pad2(m[6] || 0)}`;
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (m) {
    let h = +(m[4] || 0);
    const ap = (m[7] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    const Y = m[3].length === 2 ? '20' + m[3] : m[3];
    // Whole-file order wins when parse() detected one (DATE_ORDER); otherwise default to US M/D/Y
    // and only swap when the first field can't be a month (>12) but the second can.
    let mo, day;
    if (DATE_ORDER === 'dmy') {
      day = +m[1];
      mo = +m[2];
    } else {
      mo = +m[1];
      day = +m[2];
      if (DATE_ORDER === 'auto' && mo > 12 && day <= 12) {
        const t = mo;
        mo = day;
        day = t;
      }
    }
    return `${Y}-${pad2(mo)}-${pad2(day)} ${pad2(h)}:${pad2(m[5] || 0)}:${pad2(m[6] || 0)}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime()))
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return str;
}
// Parse as UTC (trailing Z) so a hold-time DELTA is independent of the runner's timezone and stable
// across a DST boundary (A120) — entry/exit are wall-clock strings, and we want the wall-clock span.
const tms = (iso: string) => new Date(String(iso).replace(' ', 'T') + 'Z').getTime();
const sideWord = (s: string): 'buy' | 'sell' | '' => {
  s = String(s).toLowerCase();
  if (/\b(buy|bot|bought|b|long)\b/.test(s)) return 'buy';
  if (/\b(sell|sld|sold|s|short)\b/.test(s)) return 'sell';
  return '';
};

/* ---------- futures point values (for fills exports without realized PnL) ---------- */
const POINT: Record<string, number> = {
  ES: 50,
  MES: 5,
  NQ: 20,
  MNQ: 2,
  YM: 5,
  MYM: 0.5,
  RTY: 50,
  M2K: 5,
  EMD: 100,
  NKD: 5,
  CL: 1000,
  MCL: 100,
  QM: 500,
  NG: 10000,
  QG: 2500,
  RB: 42000,
  HO: 42000,
  BZ: 1000,
  GC: 100,
  MGC: 10,
  SI: 5000,
  SIL: 1000,
  HG: 25000,
  MHG: 2500,
  PL: 50,
  PA: 100,
  ZB: 1000,
  UB: 1000,
  ZN: 1000,
  TN: 1000,
  ZF: 1000,
  ZT: 2000,
  ZQ: 4167,
  GE: 2500,
  ZC: 50,
  ZS: 50,
  ZW: 50,
  ZL: 600,
  ZM: 100,
  ZO: 50,
  KE: 50,
  HE: 400,
  LE: 400,
  GF: 500,
  '6E': 125000,
  '6B': 62500,
  '6J': 12500000,
  '6A': 100000,
  '6C': 100000,
  '6S': 125000,
  '6M': 500000,
  '6N': 100000,
  M6E: 12500,
  M6A: 10000,
};
function pointValue(root: string) {
  return POINT[root] != null ? POINT[root] : 1;
}

/* ---------- fills → closed round-trips (FIFO, handles flips & partials) ----------
     fills: [{ time, symbol, side:'buy'|'sell', qty>0, price[, realized][, commission] }]
     A closing fill realizes PnL against the oldest open lots. PnL uses the fill's
     own `realized` (apportioned by matched qty) when the export provides it, else
     (exitPrice − entryPrice) × qty × pointValue(root). Output carries hold time. */
// Import-quality counters surfaced through ParseResult (A168/A174): fills skipped for an
// unparseable timestamp, and lots left open (dangling) at end-of-file. Module-level because
// pairFills is called from inside the adapters' toTrades; parse() resets + reads them.
let SKIPPED_FILLS = 0;
let OPEN_LOTS = 0;

function pairFills(fills: Fill[]): Trade[] {
  const bySym = new Map<string, Fill[]>();
  // Timestamps are second-resolution, so same-second fills can't be ordered by time alone — FIFO
  // must keep their true execution order. Detect whether the export is newest-first and, if so,
  // invert the row-index tiebreak so same-second fills still resolve in execution order (B25).
  let desc = false;
  for (let i = 1; i < fills.length; i++) {
    const a = fills[i - 1],
      b = fills[i];
    if (a && b && a.time && b.time && a.time !== b.time) {
      desc = a.time > b.time;
      break;
    }
  }
  fills.forEach((f, i) => {
    if (!f || !f.symbol || !f.side || !(f.qty > 0) || isNaN(f.price)) return;
    // A168: a fill whose timestamp didn't normalize would corrupt the FIFO string-sort (garbage
    // sorts after ISO → a later sell processes first, books a phantom short, and that round
    // trip's P&L silently vanishes at the date gate) or escape as holdMs: NaN. Skip it and count
    // it into the import warning instead.
    if (!/^\d{4}-\d{2}-\d{2}/.test(f.time || '')) {
      SKIPPED_FILLS++;
      return;
    }
    f._seq = desc ? fills.length - i : i; // stable, execution-order tiebreak within a second
    let bucket = bySym.get(f.symbol);
    if (!bucket) bySym.set(f.symbol, (bucket = []));
    bucket.push(f);
  });
  const trades: Trade[] = [];
  for (const [sym, arr] of bySym) {
    arr.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : (a._seq ?? 0) - (b._seq ?? 0)));
    const root = rootSym(sym),
      pv = pointValue(root),
      pvKnown = POINT[root] != null; // A113: an unknown root falls back to $1/point → flag those PnLs
    // commPerQty: the opening fill's per-contract commission share (A208) — undefined when the
    // export carries no commission column, so a modeled rate applies downstream.
    type Lot = { dir: number; qty: number; price: number; time: string; commPerQty?: number };
    const open: Lot[] = []; // FIFO lots (single-direction by construction: a flip closes all opposing lots first)
    for (const f of arr) {
      const dir = f.side === 'buy' ? 1 : -1;
      // Plan the FIFO close against the opposing lots (the rest of f opens a new lot on a flip), and
      // compute each closed lot's own price-based PnL up front. closeQty is the portion of this fill
      // that closes lots (NOT f.qty), so a flip fill's full realized PnL lands on the closed contracts.
      const plan: Array<{ lot: Lot; m: number; long: boolean; priced: number }> = [];
      let closeQty = 0;
      for (const lot of open) {
        if (lot.dir === dir || closeQty >= f.qty - 1e-9) break;
        const m = Math.min(lot.qty, f.qty - closeQty);
        const long = lot.dir === 1;
        plan.push({ lot, m, long, priced: (f.price - lot.price) * m * pv * (long ? 1 : -1) });
        closeQty += m;
      }
      // Apportion a broker-provided `realized` across the closed lots by each lot's PRICE-SPREAD share
      // (A115) — the parts sum EXACTLY to f.realized while preserving per-lot magnitude/sign — instead
      // of a flat qty proration that mis-splits lots opened at different prices. Fall back to qty
      // proration only when the signed spreads can't separate them (≈0). Without realized, each lot
      // books its own price-based PnL.
      const useRealized = f.realized != null && closeQty > 0;
      const sumPriced = plan.reduce((a, p) => a + p.priced, 0);
      const raw = plan.map(p =>
        useRealized
          ? Math.abs(sumPriced) > 1e-9
            ? (f.realized as number) * (p.priced / sumPriced)
            : (f.realized as number) * (p.m / closeQty)
          : p.priced
      );
      // A174: largest-remainder cent allocation — rounding each lot's share independently could
      // drop/gain a cent vs the broker's realized figure; nudge the lots with the largest rounding
      // error until the cent totals sum EXACTLY to round2(f.realized).
      const cents = raw.map(v => Math.round(v * 100));
      if (useRealized && plan.length) {
        let resid = Math.round((f.realized as number) * 100) - cents.reduce((a, b) => a + b, 0);
        while (resid !== 0) {
          const order = raw.map((v, i) => ({ i, err: v * 100 - cents[i] })).sort((a, b) => (resid > 0 ? b.err - a.err : a.err - b.err));
          for (let k = 0; resid !== 0 && k < order.length; k++) {
            cents[order[k].i] += resid > 0 ? 1 : -1;
            resid += resid > 0 ? -1 : 1;
          }
        }
      }
      // A208: the closing fill's per-contract commission share (covers f.qty, including any
      // flip remainder that opens a new lot — each closed contract carries m/f.qty of it).
      const exitCommPerQty = f.commission != null ? f.commission / f.qty : undefined;
      for (let j = 0; j < plan.length; j++) {
        const p = plan[j];
        const t: Trade = {
          time: f.time,
          date: f.time.slice(0, 10),
          symbol: sym,
          root,
          side: p.long ? 'long' : 'short',
          qty: p.m,
          pnl: cents[j] / 100,
          entryTime: p.lot.time,
          exitTime: f.time,
          holdMs: Math.max(0, tms(f.time) - tms(p.lot.time)),
        };
        // A208: real round-turn commission = entry share + exit share, when the export provides
        // either side (a missing side counts 0 — still real data, just one-sided).
        if (p.lot.commPerQty != null || exitCommPerQty != null)
          t.commission = Math.round(((p.lot.commPerQty || 0) + (exitCommPerQty || 0)) * p.m * 100) / 100;
        if (!useRealized && !pvKnown) t.pvEstimated = true; // price × $1/point guess — surfaced to the user (A113)
        trades.push(t);
        p.lot.qty -= p.m;
        if (p.lot.qty <= 1e-9) open.shift();
      }
      const remaining = f.qty - closeQty;
      if (remaining > 1e-9)
        open.push({
          dir,
          qty: remaining,
          price: f.price,
          time: f.time,
          commPerQty: f.commission != null ? f.commission / f.qty : undefined,
        });
    }
    OPEN_LOTS += open.length; // A174: dangling opens (truncated export / still-open position) — surfaced as a notice
  }
  trades.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return trades;
}

/* ---------- header utilities ---------- */
const lc = (a: Row) => a.map(h => String(h).trim().toLowerCase());
const finder = (head: string[]) => (name: string) => head.findIndex(h => h.includes(name));
// A174: sniffing matches on WORD BOUNDARIES — bare substring matching let a 'Transaction' column
// claim TradingView's 'action'. A name matches a cell only where it isn't embedded in a longer
// alphanumeric run ('date/time' still matches 'time'; 'datetime' does not). Column lookup (finder)
// stays substring — adapters name their own columns and rely on prefix matches.
function cellHas(h: string, n: string): boolean {
  for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + 1)) {
    const before = i > 0 ? h[i - 1] : '';
    const after = i + n.length < h.length ? h[i + n.length] : '';
    if (!/[a-z0-9]/.test(before || ' ') && !/[a-z0-9]/.test(after || ' ')) return true;
  }
  return false;
}
const hasAny = (head: string[], names: string[]) => names.some(n => head.some(h => cellHas(h, n)));
// first row index whose lowercased cells contain every substring in `names`
function headerRow(rows: Row[], names: string[]) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = lc(rows[i]);
    if (names.every(n => h.some(c => c.includes(n)))) return i;
  }
  return -1;
}

/* ============================================================
     Adapters
     ============================================================ */

/* TradingView — "List of trades" / balance history (closed positions). */
const tradingview: Adapter = {
  id: 'tradingview',
  label: 'TradingView',
  kind: 'closed',
  beta: false,
  minScore: 5,
  // A176 first slice: this export has exact P&L but no quantities/hold times — point at the
  // sibling export that adds them (overlapping trades de-duplicate and enrich, so importing
  // both is safe in either order).
  upgradeHint:
    'TradingView’s order-history export adds hold times, quantities and broker-reported commissions — import both; overlapping trades merge automatically.',
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    return hasAny(h, ['action']) && hasAny(h, ['realized pnl']) ? 5 : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cT = ix('time'),
      cP = ix('realized pnl (value)') >= 0 ? ix('realized pnl (value)') : ix('realized pnl'),
      cA = ix('action');
    if (cT < 0 || cP < 0) throw new Error('missing Time or Realized PnL column');
    // A168 belt-and-braces: if Time and PnL resolve to the SAME cell the delimiter was wrong
    // (a one-column file) — refuse rather than extract the year as the P&L.
    if (cT === cP) throw new Error('Time and Realized PnL resolve to the same column — wrong delimiter?');
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cT]) continue;
      const pnl = num(row[cP]);
      if (isNaN(pnl)) continue;
      const action = cA >= 0 ? row[cA] : '';
      const sm = action.match(/symbol\s+(\S+)\s+at price/i);
      const symbol = sm ? sm[1] : '';
      const side = /close short/i.test(action) ? 'short' : /close long/i.test(action) ? 'long' : '';
      out.push({ time: normTime(row[cT]), date: normTime(row[cT]).slice(0, 10), pnl, symbol, root: rootSym(symbol), side });
    }
    return out;
  },
};

/* TradingView — order history export (fills). One row per ORDER with Status + avg Fill price;
   only Filled rows are executions. Verified against a real paper-trading export (A106, 2026-07-04);
   `Closing time` is the fill moment, and the Commission column feeds A208 when populated (empty on
   paper accounts; broker-integrated accounts may carry real costs). */
const tradingviewOrders: Adapter = {
  id: 'tradingview-orders',
  label: 'TradingView (order history)',
  kind: 'fills',
  beta: false,
  minScore: 4,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    // 'placing time' is the TradingView-distinctive signal (Webull's is 'placed time' — the
    // word-boundary matcher keeps them apart); status separates this from fills-only exports.
    return hasAny(h, ['fill price']) && hasAny(h, ['placing time']) && hasAny(h, ['status']) ? 4 : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cSym = ix('symbol'),
      cSide = ix('side'),
      cQty = ix('quantity') >= 0 ? ix('quantity') : ix('qty'),
      cPx = ix('fill price'),
      cStatus = ix('status'),
      cComm = ix('commission'),
      cT = ix('closing time') >= 0 ? ix('closing time') : ix('placing time');
    if (cSym < 0 || cSide < 0 || cPx < 0 || cStatus < 0) throw new Error('missing Symbol, Side, Fill price or Status column');
    const fills: Fill[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cSym]) continue;
      if (!/^filled$/i.test((row[cStatus] || '').trim())) continue; // cancelled/rejected/working orders aren't executions
      const side = sideWord(row[cSide]);
      const price = num(row[cPx]);
      const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
      if (!side || isNaN(price) || !(qty > 0)) continue;
      const f: Fill = { time: normTime(row[cT]), symbol: row[cSym], side, qty, price };
      if (cComm >= 0) {
        const cm = num(row[cComm]);
        if (!isNaN(cm)) f.commission = Math.abs(cm); // A208 — absent on paper accounts
      }
      fills.push(f);
    }
    return pairFills(fills);
  },
};

/* MotiveWave — Trade Report (closed; entry+exit+P/L per row → native hold time). */
const motivewave: Adapter = {
  id: 'motivewave',
  label: 'MotiveWave',
  kind: 'closed',
  beta: true,
  minScore: 5,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    return hasAny(h, ['entry price', 'entry time']) && hasAny(h, ['exit price', 'exit time']) && hasAny(h, ['p/l', 'pnl', 'profit'])
      ? 5
      : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cSym = ix('instrument') >= 0 ? ix('instrument') : ix('symbol');
    const cEntryT = ix('entry time') >= 0 ? ix('entry time') : ix('entry date');
    const cExitT = ix('exit time') >= 0 ? ix('exit time') : ix('exit date');
    const cP = ix('p/l') >= 0 ? ix('p/l') : ix('pnl') >= 0 ? ix('pnl') : ix('profit');
    const cSide = ix('side') >= 0 ? ix('side') : ix('position');
    const cQty = ix('quantity') >= 0 ? ix('quantity') : ix('qty');
    if (cExitT < 0 || cP < 0) throw new Error('missing Exit Time or P/L column');
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cExitT]) continue;
      const pnl = num(row[cP]);
      if (isNaN(pnl)) continue;
      const symbol = (cSym >= 0 ? row[cSym] : '') || '';
      const exit = normTime(row[cExitT]);
      const entry = cEntryT >= 0 ? normTime(row[cEntryT]) : '';
      const sd = cSide >= 0 ? sideWord(row[cSide]) : '';
      out.push({
        time: exit,
        date: exit.slice(0, 10),
        pnl,
        symbol,
        root: rootSym(symbol),
        side: sd === 'sell' ? 'short' : sd === 'buy' ? 'long' : '',
        qty: cQty >= 0 ? Math.abs(num(row[cQty])) || 1 : 1,
        entryTime: entry || undefined,
        exitTime: exit,
        holdMs: entry ? Math.max(0, tms(exit) - tms(entry)) : undefined,
      });
    }
    return out;
  },
};

/* Tradovate / NinjaTrader — Orders export (fills). NinjaTrader (web) runs on the Tradovate
   platform, so all six export types are IDENTICAL formats and headers cannot distinguish the
   platforms (verified against real exports 2026-07-05 — docs/csv-examples/README.md); the three
   adapters in this family therefore carry the combined label. The id 'tradovate' is kept for
   stored file-record provenance. Orders is avg-fill-price based and carries NO commission column —
   the Fills export (below) is the richer source when both are imported. */
const tradovate: Adapter = {
  id: 'tradovate',
  label: 'Tradovate / NinjaTrader (orders)',
  kind: 'fills',
  beta: false, // verified vs real exports + the platform's own Performance ground truth (2026-07-05)
  minScore: 4,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    return hasAny(h, ['b/s']) &&
      hasAny(h, ['contract', 'product']) &&
      hasAny(h, ['fill time', 'avg fill price', 'filledqty', 'filled qty', 'avgprice'])
      ? 4
      : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cBS = ix('b/s'),
      cSym = ix('contract') >= 0 ? ix('contract') : ix('product');
    const cQty = ix('filled qty') >= 0 ? ix('filled qty') : ix('filledqty');
    const cPx = ix('avg fill price') >= 0 ? ix('avg fill price') : ix('avgprice');
    const cT = ix('fill time') >= 0 ? ix('fill time') : ix('timestamp');
    if (cBS < 0 || cSym < 0 || cPx < 0) throw new Error('missing B/S, Contract or price column');
    const fills = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cBS]) continue;
      const side = sideWord(row[cBS]);
      const price = num(row[cPx]);
      const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
      if (!side || isNaN(price) || !(qty > 0)) continue;
      fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
    }
    return pairFills(fills);
  },
};

/* Tradovate / NinjaTrader — Performance export (closed round trips). The platform's own pairing:
   one row per round trip with both fill ids, prices, '$x.xx' / '$(x.xx)' pnl and bought/sold
   timestamps (side = whichever leg executed first). The authoritative import source for this
   family (A209). */
const tradovatePerf: Adapter = {
  id: 'tradovate-perf',
  label: 'Tradovate / NinjaTrader (performance)',
  kind: 'closed',
  beta: false,
  minScore: 5,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    return hasAny(h, ['buyfillid']) && hasAny(h, ['sellfillid']) && hasAny(h, ['pnl']) ? 5 : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cSym = ix('symbol'),
      cQty = ix('qty'),
      cPnl = ix('pnl'),
      cBT = ix('boughttimestamp'),
      cST = ix('soldtimestamp');
    if (cSym < 0 || cPnl < 0 || cBT < 0 || cST < 0) throw new Error('missing symbol, pnl or bought/sold timestamp column');
    const out: Trade[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cSym]) continue;
      const pnl = num(row[cPnl]);
      const bt = normTime(row[cBT]),
        st = normTime(row[cST]);
      if (isNaN(pnl) || !bt || !st) continue;
      // Long bought first, short sold first; a same-second scalp falls back to fill-id order
      // (ids are sequential) and finally to long.
      const long = bt !== st ? bt < st : num(row[ix('buyfillid')]) <= num(row[ix('sellfillid')]);
      const entry = long ? bt : st,
        exit = long ? st : bt;
      const symbol = row[cSym];
      out.push({
        time: exit,
        date: exit.slice(0, 10),
        pnl,
        symbol,
        root: rootSym(symbol),
        side: long ? 'long' : 'short',
        qty: cQty >= 0 ? Math.abs(num(row[cQty])) || 1 : 1,
        entryTime: entry,
        exitTime: exit,
        holdMs: Math.max(0, tms(exit) - tms(entry)),
      });
    }
    return out;
  },
};

/* Tradovate / NinjaTrader — Fills export (per-fill executions WITH real commission — A208). */
const tradovateFills: Adapter = {
  id: 'tradovate-fills',
  label: 'Tradovate / NinjaTrader (fills)',
  kind: 'fills',
  beta: false,
  minScore: 5,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    return hasAny(h, ['fill id']) && hasAny(h, ['b/s']) && hasAny(h, ['commission']) ? 5 : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    // The export carries '_'-prefixed meta twins of most columns (_contractId/_timestamp/_price…),
    // and finder() is substring-based — use EXACT lookups so the human-readable columns win. The
    // LOCAL 'Timestamp' (not the UTC '_timestamp') keeps times aligned with the Orders/Performance
    // exports, which cross-type dedupe depends on.
    const exact = (name: string) => head.findIndex(h => h === name);
    const cBS = ix('b/s'),
      cSym = exact('contract') >= 0 ? exact('contract') : exact('product'),
      cQty = exact('quantity'),
      cPx = exact('price'),
      cComm = exact('commission'),
      cT = exact('timestamp');
    if (cBS < 0 || cSym < 0 || cPx < 0 || cT < 0) throw new Error('missing B/S, Contract, Price or Timestamp column');
    const fills: Fill[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cBS]) continue;
      const side = sideWord(row[cBS]);
      const price = num(row[cPx]);
      const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
      if (!side || isNaN(price) || !(qty > 0)) continue;
      const f: Fill = { time: normTime(row[cT]), symbol: row[cSym], side, qty, price };
      if (cComm >= 0) {
        const cm = num(row[cComm]);
        if (!isNaN(cm)) f.commission = Math.abs(cm); // real per-fill commission (A208)
      }
      fills.push(f);
    }
    return pairFills(fills);
  },
};

/* Quantower — Trades export (per-fill executions WITH per-fill realized P/L + Fee). Verified
   against a real export 2026-07-05 (docs/csv-examples/quantower/): 12-hour AM/PM timestamps
   (normTime handles them), newest-first rows, signed Quantity, full contract codes (MESU26), a
   UTF-8 BOM on the header, and '…,ticks' twin columns plus 'Strike price' that substring lookups
   would hijack — hence the exact-match column resolution. 'Orders history.csv' (order lifecycle)
   is NOT trade data. Scores 5 so it out-ranks TradeStation's generic date/time match (the real
   file used to MISDETECT as TradeStation and refuse). */
const quantower: Adapter = {
  id: 'quantower',
  label: 'Quantower',
  kind: 'fills',
  beta: false,
  minScore: 5,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    return hasAny(h, ['gross p/l']) && hasAny(h, ['net p/l']) && hasAny(h, ['trade id']) ? 5 : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const exact = (name: string) => head.findIndex(h => h === name);
    const cT = ix('date/time'),
      cSym = exact('symbol') >= 0 ? exact('symbol') : ix('symbol'),
      cSide = exact('side'),
      cQty = exact('quantity'),
      cPx = exact('price'), // exact — 'strike price' contains 'price'
      cPnl = exact('gross p/l'), // exact — the '"Gross P/L,ticks"' twins contain it too
      cFee = exact('fee');
    if (cT < 0 || cSide < 0 || cPx < 0 || cPnl < 0) throw new Error('missing Date/Time, Side, Price or Gross P/L column');
    const fills: Fill[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cSide]) continue;
      const side = sideWord(row[cSide]);
      const price = num(row[cPx]);
      const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
      if (!side || isNaN(price) || !(qty > 0)) continue;
      const f: Fill = { time: normTime(row[cT]), symbol: cSym >= 0 ? row[cSym] : '', side, qty, price };
      // Per-fill realized GROSS P/L (0 on opening fills — pairFills only reads it on closes);
      // the Fee column is the real per-fill cost (A208; explicit 0 in the simulator is honored).
      const rz = num(row[cPnl]);
      if (!isNaN(rz)) f.realized = rz;
      if (cFee >= 0) {
        const fee = num(row[cFee]);
        if (!isNaN(fee)) f.commission = Math.abs(fee);
      }
      fills.push(f);
    }
    return pairFills(fills);
  },
};

/* ATAS X — the 'Journal' sheet of the .xlsx statistics export (closed round trips). ATAS exports
   ONE workbook (Statistics / Journal / Executions); the app layer converts the Journal sheet to
   CSV text via atasXlsxToCsv() (src/lib/core/xlsx.ts) and feeds it through this normal text
   pipeline — the adapter itself never sees binary. Verified against a real export 2026-07-05
   (docs/csv-examples/atas-x/): 20 round trips, net −$26.25, and the derived side agrees with the
   export's signed Open volume on every row. Rows carry NO explicit side column — long/short is
   derived from the (close − open) price-move sign agreeing with the PnL sign (agree ⇒ long,
   disagree ⇒ short; a zero-move or zero-PnL row is unknowable → side ''). 'PnL' is dollars,
   'Price PnL' is side-adjusted points (the fallback only). Instruments carry an '@CME_Ind'-style
   venue suffix — stripped HERE (not in rootSym) before the root resolves (MESU6@CME_Ind → MESU6). */
const atas: Adapter = {
  id: 'atas',
  label: 'ATAS X',
  kind: 'closed',
  beta: false,
  minScore: 5,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    return hasAny(h, ['open time']) && hasAny(h, ['close time']) && hasAny(h, ['price pnl']) ? 5 : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    // exact — the 'Price PnL' twin column contains 'pnl' and sits to its LEFT, so substring
    // lookup would hijack the dollar figure with the points figure.
    const exact = (name: string) => head.findIndex(h => h === name);
    const cSym = ix('instrument'),
      cOT = ix('open time'),
      cOP = ix('open price'),
      cOV = ix('open volume'),
      cCT = ix('close time'),
      cCP = ix('close price'),
      cPnl = exact('pnl') >= 0 ? exact('pnl') : ix('price pnl');
    if (cOT < 0 || cCT < 0 || cPnl < 0) throw new Error('missing Open time, Close time or PnL column');
    const out: Trade[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cCT]) continue;
      const pnl = num(row[cPnl]);
      if (isNaN(pnl)) continue;
      const symbol = ((cSym >= 0 ? row[cSym] : '') || '').split('@')[0].trim();
      const entry = normTime(row[cOT]),
        exit = normTime(row[cCT]);
      const move = cOP >= 0 && cCP >= 0 ? num(row[cCP]) - num(row[cOP]) : NaN;
      const side = isNaN(move) || !move || !pnl ? '' : move > 0 === pnl > 0 ? 'long' : 'short';
      out.push({
        time: exit,
        date: exit.slice(0, 10),
        pnl,
        symbol,
        root: rootSym(symbol),
        side,
        qty: cOV >= 0 ? Math.abs(num(row[cOV])) || 1 : 1, // Open volume is SIGNED (−1 = short entry)
        entryTime: entry || undefined,
        exitTime: exit,
        holdMs: entry ? Math.max(0, tms(exit) - tms(entry)) : undefined,
      });
    }
    return out;
  },
};

/* Rithmic R|Trader — Completed Orders (fills). */
const rithmic: Adapter = {
  id: 'rithmic',
  label: 'Rithmic R|Trader',
  kind: 'fills',
  beta: true,
  minScore: 4,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    return hasAny(h, ['buy/sell']) && hasAny(h, ['symbol']) && hasAny(h, ['qty filled', 'avg fill price']) ? 4 : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cBS = ix('buy/sell'),
      cSym = ix('symbol');
    const cQty = ix('qty filled') >= 0 ? ix('qty filled') : ix('qty');
    const cPx = ix('avg fill price') >= 0 ? ix('avg fill price') : ix('price');
    const cT = ix('update time') >= 0 ? ix('update time') : ix('create time');
    if (cBS < 0 || cSym < 0 || cPx < 0) throw new Error('missing Buy/Sell, Symbol or price column');
    const fills = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cBS]) continue;
      const side = sideWord(row[cBS]);
      const price = num(row[cPx]);
      const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
      if (!side || isNaN(price) || !(qty > 0)) continue;
      fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
    }
    return pairFills(fills);
  },
};

/* Sierra Chart — Trade Activity Log (fills; usually tab-separated). */
const sierrachart: Adapter = {
  id: 'sierrachart',
  label: 'Sierra Chart',
  kind: 'fills',
  beta: true,
  minScore: 3,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    const distinctive = hasAny(h, ['buysell', 'fillprice', 'internalorderid', 'activitytype', 'openclose']);
    return distinctive &&
      hasAny(h, ['symbol']) &&
      hasAny(h, ['fillprice', 'fill price', 'price']) &&
      hasAny(h, ['quantity', 'fillquantity', 'qty'])
      ? 3
      : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cBS = ix('buysell') >= 0 ? ix('buysell') : ix('buy/sell');
    const cSym = ix('symbol');
    const cQty = ix('fillquantity') >= 0 ? ix('fillquantity') : ix('quantity') >= 0 ? ix('quantity') : ix('qty');
    const cPx = ix('fillprice') >= 0 ? ix('fillprice') : ix('fill price') >= 0 ? ix('fill price') : ix('price');
    const cT = ix('datetime') >= 0 ? ix('datetime') : ix('fill date-time') >= 0 ? ix('fill date-time') : ix('time');
    if (cBS < 0 || cSym < 0 || cPx < 0) throw new Error('missing BuySell, Symbol or price column');
    const fills = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cBS]) continue;
      const side = sideWord(row[cBS]);
      const price = num(row[cPx]);
      const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
      if (!side || isNaN(price) || !(qty > 0)) continue;
      fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
    }
    return pairFills(fills);
  },
};

/* TradeStation — trades/fills export. */
const tradestation: Adapter = {
  id: 'tradestation',
  label: 'TradeStation',
  kind: 'fills',
  beta: true,
  minScore: 3,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    // Require the combined 'date/time' column — the TradeStation-distinctive signal. Without it
    // the bare symbol+side+qty+price+time match is too generic and scored at the detect floor,
    // letting TradeStation auto-claim other brokers' fills exports (B14). Score 3 like the other
    // beta fills adapters so a real TS file still wins; an undetected file falls to manual pick.
    const distinctive = hasAny(h, ['date/time']);
    return distinctive &&
      hasAny(h, ['symbol']) &&
      hasAny(h, ['type', 'side', 'action']) &&
      hasAny(h, ['shares', 'contracts', 'quantity', 'qty']) &&
      hasAny(h, ['price']) &&
      hasAny(h, ['time', 'date'])
      ? 3
      : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cSym = ix('symbol');
    const cSide = ix('type') >= 0 ? ix('type') : ix('side') >= 0 ? ix('side') : ix('action');
    const cQty =
      ix('shares') >= 0 ? ix('shares') : ix('contracts') >= 0 ? ix('contracts') : ix('quantity') >= 0 ? ix('quantity') : ix('qty');
    const cPx = ix('price');
    const cT = ix('date/time') >= 0 ? ix('date/time') : ix('time') >= 0 ? ix('time') : ix('date');
    if (cSym < 0 || cSide < 0 || cPx < 0) throw new Error('missing Symbol, Type or Price column');
    const fills = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cSym]) continue;
      const side = sideWord(row[cSide]);
      const price = num(row[cPx]);
      const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
      if (!side || isNaN(price) || !(qty > 0)) continue;
      fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
    }
    return pairFills(fills);
  },
};

/* Webull — Orders export (fills; equities). */
const webull: Adapter = {
  id: 'webull',
  label: 'Webull',
  kind: 'fills',
  beta: true,
  minScore: 3,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    return hasAny(h, ['symbol']) &&
      hasAny(h, ['side']) &&
      hasAny(h, ['avg price', 'price']) &&
      hasAny(h, ['filled', 'qty']) &&
      hasAny(h, ['filled time', 'placed time'])
      ? 3
      : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cSym = ix('symbol'),
      cSide = ix('side');
    const cQty = ix('filled') >= 0 ? ix('filled') : ix('total qty') >= 0 ? ix('total qty') : ix('qty');
    const cPx = ix('avg price') >= 0 ? ix('avg price') : ix('price');
    const cT = ix('filled time') >= 0 ? ix('filled time') : ix('placed time') >= 0 ? ix('placed time') : ix('time');
    const cStatus = ix('status');
    if (cSym < 0 || cSide < 0 || cPx < 0) throw new Error('missing Symbol, Side or Price column');
    const fills = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cSym]) continue;
      if (cStatus >= 0 && row[cStatus] && !/fill/i.test(row[cStatus])) continue; // only filled
      const side = sideWord(row[cSide]);
      const price = num(row[cPx]);
      const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
      if (!side || isNaN(price) || !(qty > 0)) continue;
      fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
    }
    return pairFills(fills);
  },
};

/* Interactive Brokers — Flex/Activity trades (fills; uses Realized P/L when present). */
const ibkr: Adapter = {
  id: 'ibkr',
  label: 'Interactive Brokers',
  kind: 'fills',
  beta: true,
  minScore: 3,
  sniff(text, rows) {
    const h = lc(rows[0] || []);
    const distinctive = hasAny(h, ['buy/sell', 'proceeds', 'ibcommission', 'realized p/l', 'realizedpnl', 'fifopnlrealized']);
    return distinctive &&
      hasAny(h, ['symbol']) &&
      hasAny(h, ['datetime', 'date/time']) &&
      hasAny(h, ['tradeprice', 't. price', 'price', 'proceeds'])
      ? 3
      : 0;
  },
  toTrades(text, rows) {
    const head = lc(rows[0]);
    const ix = finder(head);
    const cSym = ix('symbol');
    const cT = ix('datetime') >= 0 ? ix('datetime') : ix('date/time');
    const cBS = ix('buy/sell');
    const cQty = ix('quantity');
    const cPx = ix('tradeprice') >= 0 ? ix('tradeprice') : ix('t. price') >= 0 ? ix('t. price') : ix('price');
    const cReal = ix('realized p/l') >= 0 ? ix('realized p/l') : ix('realizedpnl') >= 0 ? ix('realizedpnl') : ix('fifopnlrealized');
    // A208: real per-fill commission when exported (Flex: IBCommission; Activity: Comm/Fee or
    // Commission). finder is substring, so 'ibcommission' must be tried before bare 'commission'.
    const cComm = ix('ibcommission') >= 0 ? ix('ibcommission') : ix('comm/fee') >= 0 ? ix('comm/fee') : ix('commission');
    if (cSym < 0 || cPx < 0 || (cBS < 0 && cQty < 0)) throw new Error('missing Symbol, price or Buy/Sell column');
    const fills = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[cSym]) continue;
      let qn = cQty >= 0 ? num(row[cQty]) : NaN;
      let side = cBS >= 0 ? sideWord(row[cBS]) : qn > 0 ? 'buy' : qn < 0 ? 'sell' : '';
      const price = num(row[cPx]);
      const qty = isNaN(qn) ? 1 : Math.abs(qn);
      if (!side || isNaN(price) || !(qty > 0)) continue;
      const f: Fill = { time: normTime(row[cT]), symbol: row[cSym], side, qty, price };
      if (cReal >= 0) {
        const rp = num(row[cReal]);
        if (!isNaN(rp) && rp !== 0) f.realized = rp;
      }
      // A208: IBKR reports commission as a NEGATIVE cash amount — normalize to a positive cost.
      // A parseable 0 is real data (a zero-commission fill), only NaN/blank is "not provided".
      if (cComm >= 0) {
        const cm = num(row[cComm]);
        if (!isNaN(cm)) f.commission = Math.abs(cm);
      }
      fills.push(f);
    }
    return pairFills(fills);
  },
};

/* Charles Schwab / thinkorswim — Account Statement "Account Trade History" (fills). */
const schwab: Adapter = {
  id: 'schwab',
  label: 'Schwab / thinkorswim',
  kind: 'fills',
  beta: true,
  minScore: 3,
  sniff(text, rows) {
    if (/account trade history/i.test(text)) return 4;
    return headerRow(rows, ['exec time', 'side', 'symbol']) >= 0 ? 3 : 0;
  },
  toTrades(text, rows) {
    const hr = headerRow(rows, ['exec time', 'symbol']);
    if (hr < 0) throw new Error('no "Exec Time / Symbol" trade-history section found');
    const head = lc(rows[hr]);
    const ix = finder(head);
    const cT = ix('exec time'),
      cSide = ix('side'),
      cSym = ix('symbol');
    const cQty = ix('qty'),
      cPx = ix('price');
    if (cT < 0 || cSide < 0 || cSym < 0 || cPx < 0) throw new Error('missing Exec Time / Side / Symbol / Price');
    const ncol = rows[hr].length;
    const fills = [];
    for (let r = hr + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < ncol - 1) break; // fewer columns ⇒ we've left the trade-history table
      if (!row[cSide]) continue; // a blank optional Side cell shouldn't truncate the rest of the section
      const side = sideWord(row[cSide]);
      const price = num(row[cPx]);
      const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
      if (!side || isNaN(price) || !(qty > 0)) continue;
      fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
    }
    return pairFills(fills);
  },
};

const ADAPTERS: Adapter[] = [
  tradingview,
  tradingviewOrders,
  motivewave,
  tradovate,
  tradovatePerf,
  tradovateFills,
  quantower,
  atas,
  rithmic,
  sierrachart,
  tradestation,
  webull,
  ibkr,
  schwab,
];
const byId = (id: string) => ADAPTERS.find(a => a.id === id);

/* Best-guess platform for an export (or null). */
function detect(text: string): Detected | null {
  let rows: Row[];
  try {
    rows = parseCSV(text);
  } catch (_) {
    return null;
  }
  if (!rows.length) return null;
  let best: Detected | null = null;
  for (const a of ADAPTERS) {
    let score = 0;
    try {
      score = a.sniff(text, rows) || 0;
    } catch (_) {
      /* unscorable adapter → leave 0 */
    }
    // A178 strict gate: each adapter sets the minimum score it will auto-claim at — a weak
    // partial match refuses (falls through to the "unrecognized" error) instead of misparsing.
    if (score >= a.minScore && (!best || score > best.score)) best = { id: a.id, label: a.label, beta: !!a.beta, kind: a.kind, score };
  }
  return best;
}

/* Parse an export into normalized trades. platformId optional — when omitted, auto-detect. */
function parse(text: string, platformId?: string): ParseResult {
  if (!text || !text.trim()) return { ok: false, error: 'The file is empty.' };
  // A177 belt-and-braces: the intake points run checkCsvFile/checkCsvText before reaching here,
  // but every path through parse() gets the binary-sniff + size/row caps regardless.
  const veto = checkCsvText(text);
  if (veto) return { ok: false, error: veto };
  let rows: Row[];
  try {
    rows = parseCSV(text);
  } catch (e) {
    return { ok: false, error: 'Could not read the file as CSV.' };
  }
  if (rows.length < 2) return { ok: false, error: 'The file has no data rows.' };
  DATE_ORDER = detectDateOrder(rows); // decide M/D/Y vs D/M/Y once for the whole file (B26; A168: from date cells only)
  SKIPPED_FILLS = 0;
  OPEN_LOTS = 0;

  let adapter: Adapter | undefined,
    detected = detect(text);
  if (platformId) {
    adapter = byId(platformId);
    if (!adapter) return { ok: false, error: 'Unknown platform "' + platformId + '".' };
  } else if (detected) adapter = byId(detected.id);
  else
    // A178: explicit refusal — name the supported platforms instead of importing garbage through
    // a weak match (the old copy also pointed at a platform dropdown the redesigned UI no longer has).
    return {
      ok: false,
      error:
        'This CSV doesn’t match a supported platform export. Supported: ' +
        ADAPTERS.map(a => a.label).join(', ') +
        '. See the How-To guide for per-platform export steps.',
      detected: null,
    };
  // Unreachable in practice (detect() ids always resolve), but narrows `adapter` for the rest.
  if (!adapter) return { ok: false, error: 'Unknown platform.', detected: detected ? detected.id : null };

  let trades;
  try {
    trades = adapter.toTrades(text, rows);
  } catch (e) {
    return { ok: false, error: `Could not parse this file as ${adapter.label}: ${(e as Error).message}.`, platform: adapter.id };
  }

  // A168: range-checked date gate — "2026-31-31" used to pass the shape-only regex.
  trades = (trades || []).filter(
    t => t && t.time && !isNaN(t.pnl) && t.date && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/.test(t.date)
  );
  if (!trades.length)
    return { ok: false, error: `No completed trades found in this file for the ${adapter.label} format.`, platform: adapter.id };
  trades.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  // A114: disambiguate genuinely-distinct trades that share time|symbol|side|pnl (e.g. two identical
  // scalps in a close-event export, which carry no qty/price to separate them). Tag the 2nd+ occurrence
  // with a within-file ordinal so the dedupe key (Store.tradeId) keeps them apart, while a re-upload of
  // the SAME file reproduces the same ordinals and still dedupes. The 1st/unique occurrence keeps `dup`
  // unset, so its id stays byte-identical to the pre-A114 key (no migration churn for existing data).
  const seen = new Map<string, number>();
  for (const t of trades) {
    const k = `${t.time}|${t.symbol}|${t.side}|${t.pnl}`;
    const c = seen.get(k) || 0;
    if (c) t.dup = c;
    seen.set(k, c + 1);
  }
  // A113: roots whose PnL was a $1/point fallback guess — surfaced as an import warning.
  const estimatedRoots = [...new Set(trades.filter(t => t.pvEstimated).map(t => t.root))];

  return {
    ok: true,
    trades,
    platform: adapter.id,
    label: adapter.label,
    beta: !!adapter.beta,
    kind: adapter.kind,
    detected: detected ? detected.id : null,
    ...(estimatedRoots.length ? { estimatedRoots } : {}),
    // A168/A174 import-quality notices (fills-based adapters only; 0/absent for close-event exports).
    ...(SKIPPED_FILLS ? { skippedFills: SKIPPED_FILLS } : {}),
    ...(OPEN_LOTS ? { openLots: OPEN_LOTS } : {}),
    ...(adapter.upgradeHint ? { upgradeHint: adapter.upgradeHint } : {}),
  };
}

const API = {
  parse,
  detect,
  pairFills,
  pointValue,
  rootSym,
  parseCSV,
  normTime,
  num,
  list: () => ADAPTERS.map(a => ({ id: a.id, label: a.label, beta: !!a.beta, kind: a.kind })),
};

export const Adapters = API;
export default API;
