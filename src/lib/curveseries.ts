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
import { rateFor } from './core.ts';
import type { Metrics } from './core.ts';

export interface DailyPoint {
  date: string;
  gross: number;
  net: number;
  take: number;
}

/** Per-day cumulative gross/net/take-home series. `m` is a compute() result (reads m.trades). */
export function dailySeries(m: Metrics, opts: { broker: string; tEff?: number; fixedMo?: number }): { pts: DailyPoint[] } {
  const broker = opts.broker,
    tEff = opts.tEff || 0,
    fixedMo = opts.fixedMo || 0;
  const map = new Map<string, { gross: number; comm: number }>();
  for (const t of (m && m.trades) || []) {
    let e = map.get(t.date);
    if (!e) map.set(t.date, (e = { gross: 0, comm: 0 }));
    e.gross += t.pnl;
    e.comm += rateFor(broker, t.root).rate * 2 * (t.qty || 1); // per-contract (B4)
  }
  let cg = 0,
    cn = 0,
    subAcc = 0;
  const pts: DailyPoint[] = [];
  const seenMonths = new Set<string>();
  for (const d of [...map.keys()].sort()) {
    const mo = d.slice(0, 7);
    if (!seenMonths.has(mo)) {
      seenMonths.add(mo);
      subAcc += fixedMo;
    }
    const e = map.get(d)!;
    cg += e.gross;
    cn += e.gross - e.comm;
    const net = cn - subAcc,
      take = net - (net > 0 ? net * tEff : 0);
    pts.push({ date: d, gross: cg, net, take });
  }
  return { pts };
}
