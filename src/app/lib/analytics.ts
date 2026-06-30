// Pure view-model builder for the redesigned Analytics screen (UI redesign, Phase 3). Turns the
// compute() Metrics + the working trade list into the discrete arrays/values the Analytics component
// renders (KPI strip, P&L histogram, hour/weekday signed bars, per-symbol + long/short breakdowns,
// and the advanced-stats grid). Pure: no runes, no DOM — the staging shell calls it from a $derived.
import { usd, money, num, ratio, fmtDur, type Metrics } from '../../lib/core/core.ts';
import type { Trade } from '../../lib/core/types.ts';

export type Kpi = { label: string; value: string; tone?: 'pos' | 'neg' };
export type DistBar = { label: string; value: number; neg: boolean };
export type SignedBar = { label: string; value: number };
export type SymbolRow = { sym: string; trades: number; win: number; pnl: number };
export type StatRow = { k: string; v: string; tone?: 'pos' | 'neg' };

export interface AnalyticsVM {
  kpis: Kpi[];
  dist: DistBar[];
  wins: number;
  losses: number;
  long: { pnl: number; n: number };
  short: { pnl: number; n: number };
  hours: SignedBar[];
  wdays: SignedBar[];
  symbols: SymbolRow[];
  statRows: StatRow[];
}

const tone = (n: number): 'pos' | 'neg' => (n >= 0 ? 'pos' : 'neg');
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Symmetric per-trade P&L histogram. Edges in dollars; the outer buckets catch the tails.
const EDGES = [-200, -100, -50, 0, 50, 100, 200];
function histogram(pnls: number[]): DistBar[] {
  const labels = ['<-200', '-200..-100', '-100..-50', '-50..0', '0..50', '50..100', '100..200', '>200'];
  const counts = new Array(labels.length).fill(0);
  for (const p of pnls) {
    let b = EDGES.findIndex(e => p < e);
    if (b === -1) b = EDGES.length; // ≥ last edge → top bucket
    counts[b]++;
  }
  return labels.map((label, i) => ({ label, value: counts[i], neg: i < 4 }));
}

export function buildAnalytics(m: Metrics, trades: Trade[]): AnalyticsVM {
  // ── KPI strip ──
  const kpis: Kpi[] = [
    { label: 'Net P&L', value: usd(m.net), tone: tone(m.net) },
    { label: 'Expectancy / trade', value: usd(m.expectancy), tone: tone(m.expectancy) },
    { label: 'Profit factor', value: ratio(m.pf) },
    { label: 'Payoff ratio', value: ratio(m.wl) },
    { label: 'Sharpe (daily)', value: num(m.sharpe) },
    { label: 'Recovery factor', value: ratio(m.recovery) },
  ];

  // ── Avg P&L by hour-of-day (from the trade timestamp HH) ──
  const hourMap = new Map<string, { pnl: number; n: number }>();
  for (const t of trades) {
    const hh = (t.time || '').slice(11, 13);
    if (!/^\d\d$/.test(hh)) continue;
    const a = hourMap.get(hh) ?? { pnl: 0, n: 0 };
    a.pnl += t.pnl;
    a.n++;
    hourMap.set(hh, a);
  }
  const hours: SignedBar[] = [...hourMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([hh, a]) => ({ label: hh, value: Math.round(a.pnl / a.n) }));

  // ── Avg P&L by weekday ──
  const dow = Array.from({ length: 7 }, () => ({ pnl: 0, n: 0 }));
  for (const t of trades) {
    const wd = new Date(t.date + 'T00:00:00').getDay();
    dow[wd].pnl += t.pnl;
    dow[wd].n++;
  }
  const wdays: SignedBar[] = dow
    .map((d, i) => ({ i, ...d }))
    .filter(d => d.n)
    .map(d => ({ label: WD[d.i], value: Math.round(d.pnl / d.n) }));

  // ── Per-symbol breakdown (top 8 by |P&L|) ──
  const symMap = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const t of trades) {
    const k = t.root || t.symbol || '—';
    const a = symMap.get(k) ?? { trades: 0, wins: 0, pnl: 0 };
    a.trades++;
    if (t.pnl > 0) a.wins++;
    a.pnl += t.pnl;
    symMap.set(k, a);
  }
  const symbols: SymbolRow[] = [...symMap.entries()]
    .map(([sym, a]) => ({ sym, trades: a.trades, win: a.trades ? Math.round((100 * a.wins) / a.trades) : 0, pnl: a.pnl }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
    .slice(0, 8);

  // ── Avg hold time (only trades that carry a duration — fills exports) ──
  const holds = trades.map(t => t.holdMs).filter((h): h is number => typeof h === 'number' && h > 0);
  const avgHold = holds.length ? fmtDur(holds.reduce((a, b) => a + b, 0) / holds.length) : '—';

  // ── Advanced-stats grid ──
  const statRows: StatRow[] = [
    { k: 'Payoff ratio (avg win / avg loss)', v: ratio(m.wl) },
    { k: 'Average win', v: usd(m.avgW), tone: 'pos' },
    { k: 'Average loss', v: usd(m.avgL), tone: 'neg' },
    { k: 'Expectancy / trade', v: usd(m.expectancy), tone: tone(m.expectancy) },
    { k: 'Per-trade std dev', v: money(m.tStd) },
    { k: 'Sortino (daily)', v: num(m.sortino) },
    { k: 'Recovery factor (net / max DD)', v: ratio(m.recovery) },
    { k: 'Profit concentration (top 5)', v: m.concPct == null ? '—' : `${Math.round(m.concPct)}%` },
    { k: 'Max consecutive wins', v: `${m.mcw}` },
    { k: 'Max consecutive losses', v: `${m.mcl}` },
    { k: 'Avg hold time', v: avgHold },
    { k: 'Largest winning streak', v: usd(m.maxWinStk), tone: 'pos' },
    { k: 'Largest losing streak', v: usd(m.maxLossStk), tone: 'neg' },
    {
      k: 'Best weekday',
      v: m.bestDow ? `${WD[m.bestDow.i]} · ${usd(m.bestDow.avg)}/trade` : '—',
      tone: m.bestDow ? tone(m.bestDow.avg) : undefined,
    },
    {
      k: 'Worst weekday',
      v: m.worstDow ? `${WD[m.worstDow.i]} · ${usd(m.worstDow.avg)}/trade` : '—',
      tone: m.worstDow ? tone(m.worstDow.avg) : undefined,
    },
    { k: 'Gross profit', v: usd(m.gp), tone: 'pos' },
    { k: 'Gross loss', v: usd(m.gl), tone: 'neg' },
    { k: 'Avg trades / day', v: m.avgTrades.toFixed(1) },
  ];

  return {
    kpis,
    dist: histogram(m.pnls),
    wins: m.wins,
    losses: m.losses,
    long: { pnl: m.long.pnl, n: m.long.n },
    short: { pnl: m.short.pnl, n: m.short.n },
    hours,
    wdays,
    symbols,
    statRows,
  };
}
