// Pure view-model builder for the redesigned Reports screen (UI redesign, Phase 3). Slices the trade
// list to the configured date range, runs compute() + costModel(), and assembles the preview sections
// (KPIs with optional prior-period comparison, equity curve, calendar, cost / tax / advanced tables)
// plus the export payloads (Markdown / text / mailto) via the shared report.ts builder (A34). Pure: no
// runes, no DOM — the staging shell calls it from a $derived and the /dev preview falls back to mocks.
import {
  compute,
  costModel,
  estimatedCommRoots,
  usd,
  money,
  num,
  ratio,
  fmtDate,
  tone,
  MONTH_NAMES,
  type Metrics,
} from '../../lib/core/core.ts';
import { buildReport } from '../../lib/core/report.ts';
import type { Trade, CostInputs, CostModel, ReportLabels, ReportSections } from '../../lib/core/types.ts';

export type { ReportSections };
/** The user-configured export meta (A156) — threads into the text/Markdown/mailto payloads. */
export type ReportMeta = { title: string; account: string; sections: ReportSections };
export type ReportKpi = { label: string; value: string; prior?: string; tone?: 'pos' | 'neg' };
export type ReportVM = {
  kpis: ReportKpi[];
  curve: number[];
  calPnl: Record<number, number>;
  calFirstDow: number;
  calDaysInMonth: number;
  calMonthLabel: string;
  costRows: [string, string, boolean][];
  /** Fallback-rate footnote for the cost table — set when any root prices off the estimated rate (A171). */
  commNote: string | null;
  taxRows: [string, string, boolean][];
  advRows: [string, string][];
  rangeLabel: string;
  md: string;
  text: string;
  mailto: string;
};

export type ReportRange = { scope: 'all' | 'month' | 'custom'; from: string; to: string; calYear: number; calMonth: number };

// Resolve a range descriptor into concrete [from, to] ISO bounds (empty = open-ended).
function bounds(r: ReportRange): { from: string; to: string; label: string } {
  if (r.scope === 'all') return { from: '', to: '', label: 'All time' };
  if (r.scope === 'month') {
    const from = fmtDate(new Date(r.calYear, r.calMonth, 1));
    const to = fmtDate(new Date(r.calYear, r.calMonth + 1, 0));
    return { from, to, label: `${MONTH_NAMES[r.calMonth]} ${r.calYear}` };
  }
  return { from: r.from, to: r.to, label: `${r.from || '…'} → ${r.to || '…'}` };
}
const inRange = (t: Trade, from: string, to: string) => (!from || t.date >= from) && (!to || t.date <= to);

// The equal-length window immediately before [from,to]; null for open-ended ranges.
// A169: CALENDAR arithmetic (setDate is DST-safe), not epoch math — subtracting 86400000ms across
// the 23-hour spring-forward day landed the window start at 23:00 of the previous day, silently
// extending the prior period by one day for US-timezone users.
function priorBounds(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const a = new Date(from + 'T00:00:00'),
    b = new Date(to + 'T00:00:00');
  const days = Math.round((b.getTime() - a.getTime()) / 86400000) + 1; // Math.round absorbs the ±1h
  const pb = new Date(a);
  pb.setDate(pb.getDate() - 1); // day before `from`
  const pa = new Date(pb);
  pa.setDate(pa.getDate() - (days - 1));
  return { from: fmtDate(pa), to: fmtDate(pb) };
}

/** The caller-supplied slice of ReportLabels (generated/scope are filled in here). */
export type ReportLabelsIn = Omit<ReportLabels, 'generated' | 'scope'>;

export function buildReportVM(
  allTrades: Trade[],
  range: ReportRange,
  compare: boolean,
  costInputs: CostInputs,
  labels: ReportLabelsIn,
  meta?: ReportMeta
): ReportVM {
  const { from, to, label } = bounds(range);
  const slice = allTrades.filter(t => inRange(t, from, to));
  const m = compute(slice);
  const c = costModel(m, costInputs);

  // Prior-period comparison. A172: the cost-adjusted KPIs compare like-for-like, so the prior
  // window runs through costModel too (same setup inputs; months accrue over the prior span).
  // A174: a month scope compares against the previous CALENDAR month ("March 2026" vs February),
  // not a rolling equal-length window that would start Jan 29.
  const pb = compare
    ? range.scope === 'month'
      ? { from: fmtDate(new Date(range.calYear, range.calMonth - 1, 1)), to: fmtDate(new Date(range.calYear, range.calMonth, 0)) }
      : priorBounds(from || m.firstDate, to || m.lastDate)
    : null;
  const mp: Metrics | null = pb ? compute(allTrades.filter(t => inRange(t, pb.from, pb.to))) : null;
  const cp: CostModel | null = mp && mp.n ? costModel(mp, costInputs) : null;
  const prior = (fn: (x: Metrics) => string) => (mp && mp.n ? fn(mp) : undefined);
  const priorC = (fn: (x: CostModel) => string) => (cp ? fn(cp) : undefined);

  // A172: one basis per label — the preview KPI strip shows the SAME numbers as the export headline
  // (net-of-costs netPreTax, commission-adjusted PF), with the basis in the label. Gross P&L lives
  // in the cost table below; the dashboard's gross 'Net P&L'/'Profit factor' cards are a different
  // surface with their own disclosed basis.
  const kpis: ReportKpi[] = [
    { label: 'Net P&L (pre-tax)', value: usd(c.netPreTax), prior: priorC(x => usd(x.netPreTax)), tone: tone(c.netPreTax) },
    { label: 'Win rate', value: `${m.winRate.toFixed(1)}%`, prior: prior(x => `${x.winRate.toFixed(1)}%`) },
    { label: 'Profit factor (net of comm.)', value: ratio(c.pf), prior: priorC(x => ratio(x.pf)) },
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
  const estRoots = estimatedCommRoots(c);
  const costRows: [string, string, boolean][] = [
    ['Gross P&L', usd(c.gross), false],
    [`Commissions (all-in)${estRoots.length ? ' *' : ''}`, usd(-c.totalComm), false],
    [`Subscriptions (${money(c.fixedMo)}/mo × ${c.months})`, usd(-c.fixedPeriod), false],
    ['Total costs', usd(-totalCost), true],
  ];
  // A172: 'Net P&L (pre-tax)', not 'Net §1256 gain' — the base is net of subscriptions, which don't
  // reduce a §1256 gain for a non-TTS filer (the modeling choice is documented in Definitions).
  const taxRows: [string, string, boolean][] = [
    ['Net P&L (pre-tax)', usd(c.netPreTax), false],
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

  const rep = buildReport(m, c, {
    ...labels,
    scope: label,
    generated: new Date(),
    // A156: the export payloads honor the configured title/account + section toggles.
    ...(meta ? { title: meta.title, account: meta.account, sections: meta.sections } : {}),
  });

  return {
    kpis,
    curve: m.curve,
    calPnl,
    calFirstDow: new Date(cy, cm, 1).getDay(),
    calDaysInMonth: new Date(cy, cm + 1, 0).getDate(),
    calMonthLabel: `${MONTH_NAMES[cm]} ${cy}`,
    costRows,
    commNote: estRoots.length ? `* Commission rate estimated for ${estRoots.join(', ')} — root not in the fee table.` : null,
    taxRows,
    advRows,
    rangeLabel: label,
    md: rep.reportMd,
    text: rep.reportText,
    mailto: rep.mailto,
  };
}
