'use strict';
/* Blotterbook · curve series (A32). The per-day cumulative gross / net / take-home series behind
   the performance curve's overlays. Extracted from render.js so BOTH the vanilla curve (render.js
   passes its DOM-derived broker/tEff/fixedMo) and the Svelte curve (passes the cost-panel inputs)
   compute the exact same cost/tax-adjusted math — no duplication (A29). Pure: depends only on
   rateFor() from core.

   - gross: cumulative raw PnL.
   - net:   cumulative (PnL − per-contract round-turn commission) − accrued monthly subscriptions.
   - take:  net − Section-1256 tax on positive net.
   Subscriptions accrue as each new calendar month is entered (B8); the endpoint equals
   costModel.fixedPeriod (fixedMo × distinct months). */
import { rateFor, roundTurn } from './core.ts';
import type { Metrics } from './core.ts';
import type { Trade } from './types.ts';

export interface DailyPoint {
  date: string;
  gross: number;
  net: number;
  take: number;
}

// Whole-month difference b − a for two `YYYY-MM` strings (A117 elapsed-span accrual).
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Per-day cumulative gross/net/take-home series. `m` is a compute() result (reads m.trades). */
export function dailySeries(
  m: Metrics,
  opts: { broker: string; tEff?: number; fixedMo?: number; brokerFor?: (t: Trade) => string | undefined }
): { pts: DailyPoint[] } {
  const broker = opts.broker,
    tEff = opts.tEff || 0,
    fixedMo = opts.fixedMo || 0;
  const map = new Map<string, { gross: number; comm: number }>();
  for (const t of (m && m.trades) || []) {
    let e = map.get(t.date);
    if (!e) map.set(t.date, (e = { gross: 0, comm: 0 }));
    e.gross += t.pnl;
    // A208: same actual-vs-modeled rule as costModel, so the curve endpoint still reconciles.
    // F30/A211: dated rate at the trade's own broker (per-file override), also matching costModel.
    e.comm +=
      t.commission != null && Number.isFinite(t.commission)
        ? t.commission
        : roundTurn(rateFor(opts.brokerFor?.(t) ?? broker, t.root, t.date).rate, t.qty); // per-contract (B4)
  }
  let cg = 0,
    cn = 0;
  const pts: DailyPoint[] = [];
  const days = [...map.keys()].sort();
  const firstMo = days.length ? days[0].slice(0, 7) : '';
  for (const d of days) {
    // A117 (elapsed span): accrue fixedMo for EVERY calendar month from the first trade month to this
    // day's month inclusive (gap months counted), so the endpoint = fixedMo × span = costModel.fixedPeriod.
    const subAcc = fixedMo * (monthsBetween(firstMo, d.slice(0, 7)) + 1);
    const e = map.get(d)!;
    cg += e.gross;
    cn += e.gross - e.comm;
    const net = cn - subAcc,
      take = net - (net > 0 ? net * tEff : 0);
    pts.push({ date: d, gross: cg, net, take });
  }
  return { pts };
}

/* A223: min/max decimation for per-trade SVG paths (the Analytics underwater curve emits one path
   command per trade — a 50k-fill import means a 50k-segment path). Buckets the series and keeps
   each bucket's min AND max in first-seen order (plus the first/last points verbatim), so peaks,
   troughs and endpoints survive while the path stays ≤ maxPoints. Returns [originalIndex, value]
   pairs so the caller's x-axis mapping is unchanged. A series already within budget passes through. */
export function decimateMinMax(values: number[], maxPoints = 1500): Array<[number, number]> {
  const n = values.length;
  if (n <= maxPoints) return values.map((v, i) => [i, v]);
  const buckets = Math.max(1, Math.floor(maxPoints / 2) - 1);
  const out: Array<[number, number]> = [[0, values[0]]];
  const per = (n - 2) / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = 1 + Math.floor(b * per);
    const end = Math.min(n - 1, 1 + Math.floor((b + 1) * per));
    if (start >= end) continue;
    let loI = start,
      hiI = start;
    for (let i = start + 1; i < end; i++) {
      if (values[i] < values[loI]) loI = i;
      if (values[i] > values[hiI]) hiI = i;
    }
    if (loI === hiI) out.push([loI, values[loI]]);
    else if (loI < hiI) out.push([loI, values[loI]], [hiI, values[hiI]]);
    else out.push([hiI, values[hiI]], [loI, values[loI]]);
  }
  out.push([n - 1, values[n - 1]]);
  return out;
}
