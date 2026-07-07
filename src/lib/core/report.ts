'use strict';
/* Blotterbook · performance-report builder (A34). Pure assembly of the report content from the
   compute() metrics + costModel result + setup labels — ONE source for the on-screen report, the
   Markdown download, and the email summary (so they can't drift, like the vanilla export.js).
   Depends only on core formatters. */
import { money, cls, ratio, DOW_LABEL, fmtDate, pad2, estimatedCommRoots } from './core.ts';
import type { Metrics } from './core.ts';
import type { CostModel, ReportLabels } from './types.ts';

/** Assemble the report content (on-screen tiles/tables + Markdown + email body) from the metrics. */
export function buildReport(m: Metrics, c: CostModel, labels: ReportLabels) {
  const range = m.firstDate === '—' ? '—' : `${m.firstDate} → ${m.lastDate}`;
  const gen = labels.generated;
  const genStr = `${fmtDate(gen)} ${pad2(gen.getHours())}:${pad2(gen.getMinutes())}`;
  const head = `${labels.broker} · Feed: ${labels.feed} · State: ${labels.state}`;

  // [label, value, toneClass] — tone mirrors vanilla export.js so the tiles color-code identically.
  const headline = [
    ['Net P&L (pre-tax)', money(c.netPreTax), cls(c.netPreTax)],
    ['Take-home (post-tax)', money(c.afterTax), cls(c.afterTax)],
    ['Gross P&L', money(c.gross), cls(c.gross)],
    ['Win rate', m.winRate.toFixed(1) + '%', ''],
    // A172: the label carries the basis — this is the commission-adjusted PF (pfGP/pfGL), matching
    // the Reports preview KPI; the dashboard's gross 'Profit factor' is a separately-labeled surface.
    ['Profit factor (net of comm.)', ratio(c.pf), ''],
    ['Max drawdown', money(-m.maxDD), 'neg'],
    ['Trades', String(m.n), ''],
    ['Active days', String(m.active), ''],
  ];
  // A171: mark commissions computed off the FALLBACK per-side rate (root not in the fee table). A285:
  // use the canonical estimatedCommRoots (!known && actual < count) so a root whose trades ALL carry
  // real CSV commissions — which never used the fallback rate (A208) — is not falsely flagged.
  const estRoots = estimatedCommRoots(c);
  const estNote = estRoots.length ? `* Commission rate estimated for ${estRoots.join(', ')} — root not in the fee table.` : '';
  const costRows = [
    ['Gross P&L', money(c.gross)],
    [`Commissions (all-in)${estRoots.length ? ' *' : ''}`, money(-c.totalComm)],
    [`Subscriptions (${money(c.fixedMo)}/mo × ${c.months})`, money(-c.fixedPeriod)],
    ['Net P&L (pre-tax)', money(c.netPreTax)],
    ['State top rate', (labels.stateRate || 0).toFixed(2) + '%'],
    ['Blended 1256 rate', (c.tEff * 100).toFixed(1) + '%'],
    ['Est. 1256 tax (net profit only)', money(-c.tax)],
    ['After-tax take-home', money(c.afterTax)],
    ['Break-even / trade', money(c.bePer)],
  ];
  const statsRows = [
    ['Expectancy / trade', money(m.expectancy)],
    ['Std dev / trade', money(m.tStd)],
    ['Avg daily PnL', money(m.avgDaily)],
    ['Avg win / loss', `${money(m.avgW)} / ${money(m.avgL)}`],
    ['Long PnL · trades', `${money(m.long.pnl)} · ${m.long.n}`],
    ['Short PnL · trades', `${money(m.short.pnl)} · ${m.short.n}`],
    ['Best / worst trade', `${money(m.best)} / ${money(m.worst)}`],
    ['Best day', m.bestDay ? `${money(m.bestDay.pnl)} · ${m.bestDay.date}` : '—'],
    ['Worst day', m.worstDay ? `${money(m.worstDay.pnl)} · ${m.worstDay.date}` : '—'],
    ['Best / worst weekday', `${m.bestDow ? DOW_LABEL[m.bestDow.i] : '—'} / ${m.worstDow ? DOW_LABEL[m.worstDow.i] : '—'}`],
    ['Max consecutive W / L', `${m.mcw} / ${m.mcl}`],
    ['Sharpe (daily, illustrative)', isNaN(m.sharpe) ? '—' : m.sharpe.toFixed(2)],
  ];

  // A156: the exports honor the configured title/account + section toggles, so a download renders
  // exactly what the preview shows. Defaults preserve the pre-A156 payloads (all sections on).
  const title = (labels.title || '').trim() || 'Blotterbook — Performance Report';
  const acct = (labels.account || '').trim();
  const s = { kpis: true, cost: true, tax: true, advanced: true, ...(labels.sections || {}) };

  const reportText =
    `${title}\n` +
    (acct ? `Account: ${acct}\n` : '') +
    `Period: ${range} (${labels.scope})\n` +
    `Generated: ${genStr}\n` +
    `Broker: ${head}\n\n` +
    (s.kpis
      ? headline
          .slice(0, 6)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n') + `\nTrades: ${m.n} · Active days: ${m.active}\n\n`
      : '') +
    (s.cost || s.tax
      ? `Commissions: ${money(c.totalComm)}${estRoots.length ? ' *' : ''} · Subscriptions: ${money(c.fixedPeriod)} · Est. 1256 tax: ${money(c.tax)}\n` +
        `Break-even / trade: ${money(c.bePer)}\n\n` +
        (estNote ? `${estNote}\n` : '')
      : '') +
    `Estimates only — not financial or tax advice.`;

  const mdRow = (l: string, v: string) => `| ${l} | ${v} |\n`;
  const reportMd =
    `# ${title}\n\n` +
    (acct ? `**Account:** ${acct}  \n` : '') +
    `**Period:** ${range} (${labels.scope})  \n` +
    `**Generated:** ${genStr}  \n` +
    `**Broker:** ${head}\n\n` +
    (s.kpis ? `## Summary\n\n| Metric | Value |\n|---|---|\n` + headline.map(([k, v]) => mdRow(k, v)).join('') + `\n` : '') +
    (s.cost || s.tax
      ? `## Cost & tax breakdown\n\n| Line | Amount |\n|---|---|\n` +
        costRows.map(([l, v]) => mdRow(l, v)).join('') +
        (estNote ? `\n${estNote}\n` : '') +
        `\n`
      : '') +
    (s.advanced ? `## Key statistics\n\n| Metric | Value |\n|---|---|\n` + statsRows.map(([l, v]) => mdRow(l, v)).join('') + `\n` : '') +
    `_Estimates only — not financial or tax advice._\n`;

  const mailto = 'mailto:?subject=' + encodeURIComponent(`${title} — ${range}`) + '&body=' + encodeURIComponent(reportText);

  // Commissions by symbol (parity with render.js commSymRows): [root, known, trades, cts, $/side, $/RT, total].
  const commRows = (c.bySym || []).map(r => ({
    root: r.root,
    known: r.known,
    count: r.count,
    qty: r.qty,
    side: money(r.rate),
    rt: money(r.rate * 2),
    total: money(r.total),
  }));

  return { range, genStr, head, scope: labels.scope, headline, costRows, statsRows, commRows, reportText, reportMd, mailto };
}
