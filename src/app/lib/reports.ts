// Pure view-model builder for the redesigned Reports screen (UI redesign, Phase 3). Slices the trade
// list to the configured date range, runs compute() + costModel(), and assembles the preview sections
// (KPIs with optional prior-period comparison, equity curve, calendar, cost / tax / advanced tables)
// plus the export payloads (Markdown / text / mailto) via the shared report.ts builder (A34). Pure: no
// runes, no DOM — the staging shell calls it from a $derived and the /dev preview falls back to mocks.
import { compute, costModel, usd, money, num, ratio, type Metrics } from '../../lib/core/core.ts';
import { buildReport } from '../../lib/core/report.ts';
import type { Trade, CostInputs, ReportLabels } from '../../lib/core/types.ts';

export type ReportKpi = { label: string; value: string; prior?: string; tone?: 'pos' | 'neg' };
export type ReportVM = {
  kpis: ReportKpi[];
  curve: number[];
  calPnl: Record<number, number>;
  calFirstDow: number;
  calDaysInMonth: number;
  calMonthLabel: string;
  costRows: [string, string, boolean][];
  taxRows: [string, string, boolean][];
  advRows: [string, string][];
  rangeLabel: string;
  md: string;
  text: string;
  mailto: string;
};

export type ReportRange = { scope: 'all' | 'month' | 'custom'; from: string; to: string; calYear: number; calMonth: number };

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const tone = (n: number): 'pos' | 'neg' => (n >= 0 ? 'pos' : 'neg');
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Resolve a range descriptor into concrete [from, to] ISO bounds (empty = open-ended).
function bounds(r: ReportRange): { from: string; to: string; label: string } {
  if (r.scope === 'all') return { from: '', to: '', label: 'All time' };
  if (r.scope === 'month') {
    const from = iso(new Date(r.calYear, r.calMonth, 1));
    const to = iso(new Date(r.calYear, r.calMonth + 1, 0));
    return { from, to, label: `${MON[r.calMonth]} ${r.calYear}` };
  }
  return { from: r.from, to: r.to, label: `${r.from || '…'} → ${r.to || '…'}` };
}
const inRange = (t: Trade, from: string, to: string) => (!from || t.date >= from) && (!to || t.date <= to);

// The equal-length window immediately before [from,to]; null for open-ended ranges.
function priorBounds(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const a = new Date(from + 'T00:00:00'),
    b = new Date(to + 'T00:00:00');
  const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  const pb = new Date(a.getTime() - 86400000);
  const pa = new Date(pb.getTime() - (days - 1) * 86400000);
  return { from: iso(pa), to: iso(pb) };
}

export function buildReportVM(
  allTrades: Trade[],
  range: ReportRange,
  compare: boolean,
  costInputs: CostInputs,
  labels: Omit<ReportLabels, 'generated' | 'scope'>
): ReportVM {
  const { from, to, label } = bounds(range);
  const slice = allTrades.filter(t => inRange(t, from, to));
  const m = compute(slice);
  const c = costModel(m, costInputs);

  // Prior-period comparison.
  const pb = compare ? priorBounds(from || m.firstDate, to || m.lastDate) : null;
  const mp: Metrics | null = pb ? compute(allTrades.filter(t => inRange(t, pb.from, pb.to))) : null;
  const prior = (fn: (x: Metrics) => string) => (mp && mp.n ? fn(mp) : undefined);

  const kpis: ReportKpi[] = [
    { label: 'Net P&L', value: usd(m.net), prior: prior(x => usd(x.net)), tone: tone(m.net) },
    { label: 'Win rate', value: `${m.winRate.toFixed(1)}%`, prior: prior(x => `${x.winRate.toFixed(1)}%`) },
    { label: 'Profit factor', value: ratio(m.pf), prior: prior(x => ratio(x.pf)) },
    { label: 'Expectancy', value: usd(m.expectancy), prior: prior(x => usd(x.expectancy)), tone: tone(m.expectancy) },
    { label: 'Trades', value: `${m.n}`, prior: prior(x => `${x.n}`) },
    {
      label: 'Max drawdown',
      value: m.maxDD > 0 ? `-${money(m.maxDD)}` : '$0',
      prior: prior(x => (x.maxDD > 0 ? `-${money(x.maxDD)}` : '$0')),
      tone: 'neg',
    },
  ];

  // Calendar — the last active month in the slice (or the cursor month for an open range).
  const last = slice.length ? slice[slice.length - 1].date : '';
  const cy = last ? +last.slice(0, 4) : range.calYear;
  const cm = last ? +last.slice(5, 7) - 1 : range.calMonth;
  const calPnl: Record<number, number> = {};
  for (const d of m.days) {
    const dt = new Date(d.date + 'T00:00:00');
    if (dt.getFullYear() === cy && dt.getMonth() === cm) calPnl[dt.getDate()] = d.pnl;
  }

  const totalCost = c.totalComm + c.fixedPeriod;
  const costRows: [string, string, boolean][] = [
    ['Gross P&L', usd(c.gross), false],
    ['Commissions (all-in)', usd(-c.totalComm), false],
    [`Subscriptions (${money(c.fixedMo)}/mo × ${c.months})`, usd(-c.fixedPeriod), false],
    ['Total costs', usd(-totalCost), true],
  ];
  const taxRows: [string, string, boolean][] = [
    ['Net §1256 gain (pre-tax)', usd(c.netPreTax), false],
    ['Blended 1256 rate', `${(c.tEff * 100).toFixed(1)}%`, false],
    ['Est. 1256 tax (profit only)', usd(-c.tax), false],
    ['Est. take-home', usd(c.afterTax), true],
  ];
  const advRows: [string, string][] = [
    ['Payoff ratio', ratio(m.wl)],
    ['Sortino', num(m.sortino)],
    ['Recovery factor', ratio(m.recovery)],
    ['Profit concentration', m.concPct == null ? '—' : `${Math.round(m.concPct)}%`],
    ['Max consec. wins', `${m.mcw}`],
    ['Max consec. losses', `${m.mcl}`],
  ];

  const rep = buildReport(m, c, { ...labels, scope: label, generated: new Date() });

  return {
    kpis,
    curve: m.curve,
    calPnl,
    calFirstDow: new Date(cy, cm, 1).getDay(),
    calDaysInMonth: new Date(cy, cm + 1, 0).getDate(),
    calMonthLabel: `${MON[cm]} ${cy}`,
    costRows,
    taxRows,
    advRows,
    rangeLabel: label,
    md: rep.reportMd,
    text: rep.reportText,
    mailto: rep.mailto,
  };
}
