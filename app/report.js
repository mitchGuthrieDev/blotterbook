// @ts-check
'use strict';
/* Blotterbook · performance-report builder (A34). Pure assembly of the report content from the
   compute() metrics + costModel result + setup labels — ONE source for the on-screen report, the
   Markdown download, and the email summary (so they can't drift, like the vanilla export.js).
   Depends only on core formatters. */
import { money, cls, DOW_LABEL, fmtDate, pad2 } from './core.js';
import { esc } from '../assets/util.js';

/**
 * @param {*} m  active compute() metrics
 * @param {*} c  costModel(m, inputs) result
 * @param {{broker:string, feed:string, state:string, scope:string, stateRate:number, platform:(number|string), generated:Date}} labels
 */
export function buildReport(m, c, labels) {
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
    ['Profit factor', c.pf === Infinity ? '∞' : c.pf.toFixed(2), ''],
    ['Max drawdown', money(-m.maxDD), 'neg'],
    ['Trades', String(m.n), ''],
    ['Active days', String(m.active), ''],
  ];
  const costRows = [
    ['Gross P&L', money(c.gross)],
    ['Commissions (all-in)', money(-c.totalComm)],
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

  const reportText =
    `Blotterbook — Performance Report\n` +
    `Period: ${range} (${labels.scope})\n` +
    `Generated: ${genStr}\n` +
    `Broker: ${head}\n\n` +
    headline
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') +
    `\nTrades: ${m.n} · Active days: ${m.active}\n\n` +
    `Commissions: ${money(c.totalComm)} · Subscriptions: ${money(c.fixedPeriod)} · Est. 1256 tax: ${money(c.tax)}\n` +
    `Break-even / trade: ${money(c.bePer)}\n\n` +
    `Estimates only — not financial or tax advice.`;

  const mdRow = (l, v) => `| ${l} | ${v} |\n`;
  const reportMd =
    `# Blotterbook — Performance Report\n\n` +
    `**Period:** ${range} (${labels.scope})  \n` +
    `**Generated:** ${genStr}  \n` +
    `**Broker:** ${head}\n\n` +
    `## Summary\n\n| Metric | Value |\n|---|---|\n` +
    headline.map(([k, v]) => mdRow(k, v)).join('') +
    `\n## Cost & tax breakdown\n\n| Line | Amount |\n|---|---|\n` +
    costRows.map(([l, v]) => mdRow(l, v)).join('') +
    `\n_Estimates only — not financial or tax advice._\n`;

  const mailto =
    'mailto:?subject=' + encodeURIComponent(`Blotterbook Performance Report — ${range}`) + '&body=' + encodeURIComponent(reportText);

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

/* Assemble the standalone, self-contained report document (faithful port of export.js's
   sheetHtml + reportCss) for the iframe preview + print(PDF) + raster(PNG/JPEG). Kept DOM-free:
   the caller bakes the live design tokens into `tokenBlock` (a `:root{…}` string) via
   getComputedStyle so the report palette tracks tokens.css (A8) without this module touching the DOM. */
export function reportHtmlDoc(rep, labels, tokenBlock) {
  const tile = (k, v, cl = '') => `<div class="rtile"><div class="rk">${esc(k)}</div><div class="rv ${cl}">${esc(v)}</div></div>`;
  const tiles = rep.headline.map(([k, v, tone]) => tile(k, v, tone || '')).join('');
  const COST_CLASS = {
    'Net P&L (pre-tax)': 'tot',
    'After-tax take-home': 'tot',
    'State top rate': 'sub',
    'Blended 1256 rate': 'sub',
    'Est. 1256 tax (net profit only)': 'sub',
  };
  const costTbl = rep.costRows
    .map(([l, v]) => `<tr class="${COST_CLASS[l] || ''}"><td>${esc(l)}</td><td class="num">${esc(v)}</td></tr>`)
    .join('');
  const statsTbl = rep.statsRows.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="num">${esc(v)}</td></tr>`).join('');
  const commTbl =
    rep.commRows.length === 0
      ? '<tr><td colspan="6">No commissions in scope.</td></tr>'
      : rep.commRows
          .map(
            r =>
              `<tr><td>${esc(r.root)}${r.known ? '' : '<span class="neg">*</span>'}</td><td class="num">${r.count}</td>` +
              `<td class="num">${r.qty}</td><td class="num">${esc(r.side)}</td><td class="num">${esc(r.rt)}</td><td class="num">${esc(r.total)}</td></tr>`
          )
          .join('');

  const reportCss = `
  ${tokenBlock}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:var(--sans);font-size:13px;line-height:1.5;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:820px;margin:0 auto;padding:34px 38px}
  .rtop{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;
    border-bottom:1px solid var(--line);padding-bottom:16px}
  .brandline{font-size:22px;font-weight:700;display:flex;align-items:center;gap:9px;letter-spacing:.01em}
  .brandline .dot{width:11px;height:11px;border-radius:3px;background:linear-gradient(135deg,var(--accent),var(--take))}
  .rsub{font-family:var(--mono);color:var(--dim);font-size:11.5px;margin-top:5px;letter-spacing:.02em}
  .rmeta{font-family:var(--mono);font-size:11px;color:var(--dim);text-align:right;line-height:1.7}
  .rmeta b{color:var(--txt);font-weight:600}
  h2{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);
    margin:26px 0 10px;font-weight:700}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
  .rtile{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:11px 12px}
  .rtile .rk{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim)}
  .rtile .rv{font-family:var(--mono);font-size:18px;font-weight:600;margin-top:5px;font-variant-numeric:tabular-nums}
  .rtile .rv.neg{color:var(--red)}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td,th{padding:6px 0;border-bottom:1px solid var(--line);text-align:left}
  td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
  thead th{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:600}
  tr.tot td{font-weight:700;color:var(--txt);border-bottom:1px solid var(--line)}
  tr.sub td{color:var(--dim);font-size:11.5px;border-bottom:1px dashed var(--line)}
  tr.sub td:first-child{padding-left:14px}
  .pos{color:var(--green)} .neg{color:var(--red)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:34px}
  .foot{margin-top:30px;padding-top:14px;border-top:1px solid var(--line);
    font-size:10.5px;color:var(--faint);line-height:1.6}
  @media print{.sheet{padding:0 6mm}@page{margin:12mm}}`;

  const sheetHtml = `<div class="sheet">
    <div class="rtop">
      <div>
        <div class="brandline"><span class="dot"></span>Blotterbook</div>
        <div class="rsub">Performance Report · ${esc(rep.scope)}</div>
      </div>
      <div class="rmeta">
        Generated <b>${esc(rep.genStr)}</b><br>
        Period <b>${esc(rep.range)}</b><br>
        Broker <b>${esc(labels.broker)}</b> · Feed ${esc(labels.feed)}<br>
        State <b>${esc(labels.state)}</b> · Platform $${esc(String(labels.platform))}/mo
      </div>
    </div>

    <h2>Summary</h2>
    <div class="tiles">${tiles}</div>

    <div class="cols">
      <div>
        <h2>Cost &amp; tax breakdown</h2>
        <table><tbody>${costTbl}</tbody></table>
      </div>
      <div>
        <h2>Key statistics</h2>
        <table><tbody>${statsTbl}</tbody></table>
      </div>
    </div>

    <h2>Commissions by symbol</h2>
    <table>
      <thead><tr><th>Symbol</th><th class="num">Trades</th><th class="num">Cts</th><th class="num">$/side</th><th class="num">$/RT</th><th class="num">Commission</th></tr></thead>
      <tbody>${commTbl}</tbody>
    </table>

    <div class="foot">
      Figures are estimates generated by Blotterbook from a balance-history export. Commissions and the
      Section&nbsp;1256 tax (blended 60/40 federal rate plus state top rate, applied to positive net profit only) are
      modeled, not statements of record. Max drawdown is realized, closed-trade only. Not financial or tax advice.
    </div>
  </div>`;

  // Return the doc body (NO inline <style>) + the CSS separately. The caller injects the CSS into
  // the iframe via the CSSOM (adoptedStyleSheets), which `style-src 'self'` permits — A55/S18.
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Blotterbook — Performance Report</title></head><body>${sheetHtml}</body></html>`;
  return { html, css: reportCss };
}
