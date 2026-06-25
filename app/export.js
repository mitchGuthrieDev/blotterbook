"use strict";
/* Blotterbook app · export — performance report export (print → PDF)
   Loaded in order: core → render → data → ui → export → datamanager → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime). */

/* ============================================================
   Export — stylized, condensed performance report (print → PDF)
   Builds a standalone document in the app's palette and prints it,
   rather than screenshotting the live dashboard.
   ============================================================ */
function exportReport(){
  if(!METRICS_ALL || !METRICS_ALL.n){ alert('Load data before exporting a report.'); return; }
  const m=activeMetrics(), c=costModel(m);
  const bePer = c.n>0 ? (c.totalComm+c.fixedPeriod)/c.n : 0;
  const gen=new Date();
  const range = (m.firstDate==='—') ? '—' : `${m.firstDate} → ${m.lastDate}`;

  const tile=(k,v,cl='')=>`<div class="rtile"><div class="rk">${k}</div><div class="rv ${cl}">${v}</div></div>`;
  const crow=(l,v,cl='')=>`<tr class="${cl}"><td>${l}</td><td class="num">${v}</td></tr>`;
  const stat=(l,v)=>`<tr><td>${l}</td><td class="num">${v}</td></tr>`;

  const symRows=c.bySym.map(s=>
    `<tr><td>${esc(s.root)}${s.known?'':' *'}</td><td class="num">${s.count}</td>
      <td class="num">${money(s.rate)}</td><td class="num">${money(s.rate*2)}</td>
      <td class="num">${money(s.total)}</td></tr>`).join('');

  const tiles =
      tile('Net P&L (pre-tax)', money(c.netPreTax), cls(c.netPreTax))
    + tile('Take-home (post-tax)', money(c.afterTax), cls(c.afterTax))
    + tile('Gross P&L', money(c.gross), cls(c.gross))
    + tile('Win rate', (m.n?100*m.wins/m.n:0).toFixed(1)+'%')
    + tile('Profit factor', c.pf===Infinity?'∞':c.pf.toFixed(2))
    + tile('Max drawdown', money(-m.maxDD), 'neg')
    + tile('Trades', String(m.n))
    + tile('Active days', String(m.active));

  const costTbl =
     crow('Gross P&L', `<span class="${cls(c.gross)}">${money(c.gross)}</span>`)
    +crow('Commissions (all-in)', `<span class="neg">${money(-c.totalComm)}</span>`)
    +crow(`Subscriptions (${money(c.fixedMo)}/mo × ${c.months})`, `<span class="neg">${money(-c.fixedPeriod)}</span>`)
    +crow('Net P&L (pre-tax)', `<span class="${cls(c.netPreTax)}">${money(c.netPreTax)}</span>`,'tot')
    +crow('State top rate', stateRate().toFixed(2)+'%','sub')
    +crow('Blended 1256 rate', (c.tEff*100).toFixed(1)+'%','sub')
    +crow('Est. 1256 tax (net profit only)', `<span class="neg">${money(-c.tax)}</span>`,'sub')
    +crow('After-tax take-home', `<span class="${cls(c.afterTax)}">${money(c.afterTax)}</span>`,'tot')
    +crow('Break-even / trade', money(bePer));

  const statsTbl =
     stat('Expectancy / trade', `<span class="${cls(m.expectancy)}">${money(m.expectancy)}</span>`)
    +stat('Std dev / trade', money(m.tStd))
    +stat('Avg daily PnL', `<span class="${cls(m.avgDaily)}">${money(m.avgDaily)}</span>`)
    +stat('Avg win / loss', `${money(m.avgW)} / ${money(m.avgL)}`)
    +stat('Long PnL · trades', `<span class="${cls(m.long.pnl)}">${money(m.long.pnl)}</span> · ${m.long.n}`)
    +stat('Short PnL · trades', `<span class="${cls(m.short.pnl)}">${money(m.short.pnl)}</span> · ${m.short.n}`)
    +stat('Best / worst trade', `<span class="pos">${money(m.best)}</span> / <span class="neg">${money(m.worst)}</span>`)
    +stat('Best day', m.bestDay?`<span class="pos">${money(m.bestDay.pnl)}</span> · ${m.bestDay.date}`:'—')
    +stat('Worst day', m.worstDay?`<span class="neg">${money(m.worstDay.pnl)}</span> · ${m.worstDay.date}`:'—')
    +stat('Best / worst weekday', `${m.bestDow?DOW_LABEL[m.bestDow.i]:'—'} / ${m.worstDow?DOW_LABEL[m.worstDow.i]:'—'}`)
    +stat('Max consecutive W / L', `${m.mcw} / ${m.mcl}`)
    +stat('Sharpe (daily, illustrative)', isNaN(m.sharpe)?'—':m.sharpe.toFixed(2));

  // plaintext summary for the "Email a copy" mailto (attachments aren't possible via mailto)
  const reportText=
     `Blotterbook — Performance Report\n`
    +`Period: ${range} (${scopeLabel()})\n`
    +`Generated: ${fmtDate(gen)} ${pad2(gen.getHours())}:${pad2(gen.getMinutes())}\n`
    +`Broker: ${BROKERS[c.broker]?BROKERS[c.broker].name:c.broker} · Feed: ${feedName()} · State: ${stateLabel()}\n\n`
    +`Net P&L (pre-tax): ${money(c.netPreTax)}\n`
    +`Take-home (post-tax): ${money(c.afterTax)}\n`
    +`Gross P&L: ${money(c.gross)}\n`
    +`Win rate: ${(m.n?100*m.wins/m.n:0).toFixed(1)}%\n`
    +`Profit factor: ${c.pf===Infinity?'∞':c.pf.toFixed(2)}\n`
    +`Max drawdown: ${money(-m.maxDD)}\n`
    +`Trades: ${m.n} · Active days: ${m.active}\n\n`
    +`Commissions: ${money(c.totalComm)} · Subscriptions: ${money(c.fixedPeriod)} · Est. 1256 tax: ${money(c.tax)}\n`
    +`Break-even / trade: ${money(bePer)}\n\n`
    +`Estimates only — not financial or tax advice. A formatted copy can be downloaded from the report page.`;
  const fname=`blotterbook-report-${fmtDate(gen)}.html`;
  const mailto='mailto:?subject='+encodeURIComponent(`Blotterbook Performance Report — ${range}`)
    +'&body='+encodeURIComponent(reportText);

  const html=`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Blotterbook — Performance Report</title>
<style>
  :root{--bg:#0d1014;--panel:#151a21;--panel2:#1b212a;--line:#262d38;--txt:#d6dde6;
    --dim:#8a94a3;--faint:#5b6470;--green:#3fb950;--red:#f04a4a;--accent:#6aa0ff;--take:#c98bff;
    --mono:"SF Mono",SFMono-Regular,ui-monospace,Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
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
  .bar{position:sticky;top:0;background:var(--panel);border-bottom:1px solid var(--line);
    padding:10px 14px;display:flex;gap:10px;justify-content:flex-end}
  .bar button{font-family:inherit;font-size:12.5px;cursor:pointer;border:1px solid var(--line);
    background:var(--panel2);color:var(--txt);padding:7px 14px;border-radius:7px}
  .bar button.pri{background:var(--accent);color:#0d1014;border-color:var(--accent);font-weight:600}
  @media print{.bar{display:none}.sheet{padding:0 6mm}@page{margin:12mm}}
</style></head><body>
  <div class="bar">
    <button onclick="dlReport()" class="pri">Download</button>
    <button onclick="emailReport()">Email a copy</button>
    <button onclick="window.close()">Close</button>
  </div>
  <div class="sheet">
    <div class="rtop">
      <div>
        <div class="brandline"><span class="dot"></span>Blotterbook</div>
        <div class="rsub">Performance Report · ${scopeLabel()}</div>
      </div>
      <div class="rmeta">
        Generated <b>${fmtDate(gen)} ${pad2(gen.getHours())}:${pad2(gen.getMinutes())}</b><br>
        Period <b>${range}</b><br>
        Broker <b>${BROKERS[c.broker]?BROKERS[c.broker].name:c.broker}</b> · Feed ${feedName()}<br>
        State <b>${stateLabel()}</b> · Platform $${c.platform}/mo
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
      <thead><tr><th>Symbol</th><th class="num">Trades</th><th class="num">$/side</th><th class="num">$/RT</th><th class="num">Commission</th></tr></thead>
      <tbody>${symRows}<tr class="tot"><td>Total</td><td class="num">${c.n}</td><td></td><td></td><td class="num">${money(c.totalComm)}</td></tr></tbody>
    </table>

    <div class="foot">
      Figures are estimates generated by Blotterbook from a TradingView balance-history export. Commissions and the
      Section&nbsp;1256 tax (blended 60/40 federal rate plus state top rate, applied to positive net profit only) are
      modeled, not statements of record. Max drawdown is realized, closed-trade only. Not financial or tax advice.
    </div>
  </div>
  <script id="rscript">
    var RFNAME=${JSON.stringify(fname)}, RMAILTO=${JSON.stringify(mailto)};
    function dlReport(){
      var clone=document.documentElement.cloneNode(true);
      var b=clone.querySelector('.bar'); if(b) b.remove();
      var s=clone.querySelector('#rscript'); if(s) s.remove();
      var html='<!DOCTYPE html>\\n'+clone.outerHTML;
      var a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
      a.download=RFNAME; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(a.href);},1500);
    }
    function emailReport(){ window.location.href=RMAILTO; }
  <\/script>
</body></html>`;

  const w=window.open('', '_blank');
  if(!w){ alert('Allow pop-ups for this site to generate the report.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
