"use strict";
import { state } from './state.js';
import { costModel, money, cls, stateRate, fmtDate, pad2, BROKERS, feedName, DOW_LABEL } from './core.js';
import { activeMetrics, commSymRows, scopeLabel } from './render.js';
import { stateLabel, downloadFile, modalOpened, modalClosed } from './ui.js';
import { esc } from '../assets/util.js';
/* Blotterbook app · export — performance report export (print → PDF)
   Loaded in order: core → render → data → ui → export → datamanager → widgets → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime). */

/* ============================================================
   Export — stylized, condensed performance report (print → PDF)
   Builds a standalone document in the app's palette and prints it,
   rather than screenshotting the live dashboard.
   ============================================================ */
export function exportReport(){
  if(!state.METRICS_ALL || !state.METRICS_ALL.n){ alert('Load data before exporting a report.'); return; }
  const m=activeMetrics(), c=costModel(m);
  const bePer = c.bePer;
  const gen=new Date();
  const range = (m.firstDate==='—') ? '—' : `${m.firstDate} → ${m.lastDate}`;

  const tile=(k,v,cl='')=>`<div class="rtile"><div class="rk">${k}</div><div class="rv ${cl}">${v}</div></div>`;
  const crow=(l,v,cl='')=>`<tr class="${cl}"><td>${l}</td><td class="num">${v}</td></tr>`;
  const stat=(l,v)=>`<tr><td>${l}</td><td class="num">${v}</td></tr>`;


  // Headline figures defined once, then rendered as HTML tiles AND as the plaintext email
  // summary below — so the two can't drift (CH11). [label, value, className].
  const headline = [
    ['Net P&L (pre-tax)', money(c.netPreTax), cls(c.netPreTax)],
    ['Take-home (post-tax)', money(c.afterTax), cls(c.afterTax)],
    ['Gross P&L', money(c.gross), cls(c.gross)],
    ['Win rate', m.winRate.toFixed(1)+'%', ''],
    ['Profit factor', c.pf===Infinity?'∞':c.pf.toFixed(2), ''],
    ['Max drawdown', money(-m.maxDD), 'neg'],
    ['Trades', String(m.n), ''],
    ['Active days', String(m.active), '']
  ];
  const tiles = headline.map(([k,v,cl])=>tile(k,v,cl)).join('');

  // Cost & tax breakdown defined ONCE, rendered as the HTML report table AND the Markdown
  // download below — so the two can't drift (CH17). [label, value, valueClass, rowClass].
  const costRows = [
    ['Gross P&L', money(c.gross), cls(c.gross), ''],
    ['Commissions (all-in)', money(-c.totalComm), 'neg', ''],
    [`Subscriptions (${money(c.fixedMo)}/mo × ${c.months})`, money(-c.fixedPeriod), 'neg', ''],
    ['Net P&L (pre-tax)', money(c.netPreTax), cls(c.netPreTax), 'tot'],
    ['State top rate', stateRate().toFixed(2)+'%', '', 'sub'],
    ['Blended 1256 rate', (c.tEff*100).toFixed(1)+'%', '', 'sub'],
    ['Est. 1256 tax (net profit only)', money(-c.tax), 'neg', 'sub'],
    ['After-tax take-home', money(c.afterTax), cls(c.afterTax), 'tot'],
    ['Break-even / trade', money(bePer), '', '']
  ];
  const costTbl = costRows.map(([l,v,vc,rc])=>crow(l, vc?`<span class="${vc}">${v}</span>`:v, rc)).join('');

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
    +headline.slice(0,6).map(([k,v])=>`${k}: ${v}`).join('\n')+'\n'
    +`Trades: ${m.n} · Active days: ${m.active}\n\n`
    +`Commissions: ${money(c.totalComm)} · Subscriptions: ${money(c.fixedPeriod)} · Est. 1256 tax: ${money(c.tax)}\n`
    +`Break-even / trade: ${money(bePer)}\n\n`
    +`Estimates only — not financial or tax advice. A formatted copy can be downloaded from the report page.`;
  const fname=`blotterbook-report-${fmtDate(gen)}.html`;
  const mailto='mailto:?subject='+encodeURIComponent(`Blotterbook Performance Report — ${range}`)
    +'&body='+encodeURIComponent(reportText);

  // The report is a standalone document (it can't @import app.css/tokens.css), so bake the
  // CURRENT token values into its :root at export time instead of hand-copying hexes that
  // silently drift from tokens.css (A8). One source of truth = the live design tokens.
  const cs=getComputedStyle(document.documentElement);
  const tokenVars=['--bg','--panel','--panel2','--line','--txt','--dim','--faint','--green','--red','--accent','--take','--mono','--sans'];
  const rootBlock=':root{'+tokenVars.map(n=>`${n}:${cs.getPropertyValue(n).trim()}`).join(';')+';}';
  const reportCss=`
  ${rootBlock}
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
  .bar button.pri{background:var(--accent);color:var(--bg);border-color:var(--accent);font-weight:600}
  @media print{.bar{display:none}.sheet{padding:0 6mm}@page{margin:12mm}}`;

  const sheetHtml=`<div class="sheet">
    <div class="rtop">
      <div>
        <div class="brandline"><span class="dot"></span>Blotterbook</div>
        <div class="rsub">Performance Report · ${scopeLabel()}</div>
      </div>
      <div class="rmeta">
        Generated <b>${fmtDate(gen)} ${pad2(gen.getHours())}:${pad2(gen.getMinutes())}</b><br>
        Period <b>${range}</b><br>
        Broker <b>${esc(BROKERS[c.broker]?BROKERS[c.broker].name:c.broker)}</b> · Feed ${esc(feedName())}<br>
        State <b>${esc(stateLabel())}</b> · Platform $${esc(c.platform)}/mo
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
      <tbody>${commSymRows(c,true)}</tbody>
    </table>

    <div class="foot">
      Figures are estimates generated by Blotterbook from a TradingView balance-history export. Commissions and the
      Section&nbsp;1256 tax (blended 60/40 federal rate plus state top rate, applied to positive net profit only) are
      modeled, not statements of record. Max drawdown is realized, closed-trade only. Not financial or tax advice.
    </div>
  </div>`;

  const mdRow=(l,v)=>`| ${l} | ${v} |\n`;
  const reportMd=
     `# Blotterbook — Performance Report\n\n`
    +`**Period:** ${range} (${scopeLabel()})  \n`
    +`**Generated:** ${fmtDate(gen)} ${pad2(gen.getHours())}:${pad2(gen.getMinutes())}  \n`
    +`**Broker:** ${BROKERS[c.broker]?BROKERS[c.broker].name:c.broker} · **Feed:** ${feedName()} · **State:** ${stateLabel()}\n\n`
    +`## Summary\n\n| Metric | Value |\n|---|---|\n`
    +headline.map(([k,v])=>mdRow(k,v)).join('')          // CH17: same source as the HTML tiles
    +`\n## Cost & tax breakdown\n\n| Line | Amount |\n|---|---|\n`
    +costRows.map(([l,v])=>mdRow(l,v)).join('')          // CH17: same source as the HTML cost table
    +`\n_Estimates only — not financial or tax advice._\n`;

  // F3 (CH16): preview + multi-format download + email in an in-page modal on every surface
  // (replaces the old new-tab report). The report renders in an isolated iframe in #exportModal.
  const docNoBar=`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Blotterbook — Performance Report</title>
<style>${reportCss}</style></head><body>${sheetHtml}</body></html>`;
  openExportReportModal(docNoBar, { mailto, fname, md:reportMd });
}

/* ============================================================
   F3 (staging) — Export-report modal: preview + multi-format download + email
   Reuses the .modal overlay pattern. The report renders in an isolated <iframe>
   (its own palette/CSS); Download is disabled until a real format is chosen.
   ============================================================ */
export let EXPORT_CUR=null, EXPORT_WIRED=false;

export function openExportReportModal(docNoBar, parts){
  const ov=document.getElementById('exportModal'); if(!ov) return;
  EXPORT_CUR=Object.assign({ docNoBar }, parts);
  const ifr=document.getElementById('exp_preview');
  ifr.srcdoc=docNoBar;
  const sel=document.getElementById('exp_format'); if(sel) sel.value='';
  const dl=document.getElementById('exp_download'); if(dl) dl.disabled=true;
  const msg=document.getElementById('exp_msg'); if(msg){ msg.textContent=''; msg.className='parsestatus'; }
  ov.classList.add('open'); document.body.style.overflow='hidden';
  if(!EXPORT_WIRED){ wireExportModal(); EXPORT_WIRED=true; }
  modalOpened(ov);   // aria-hidden + focus trap/restore (B9)
}
export function closeExportReportModal(){
  const ov=document.getElementById('exportModal'); if(!ov||!ov.classList.contains('open')) return;
  ov.classList.remove('open');
  document.body.style.overflow='';
  modalClosed(ov);
}
export function wireExportModal(){
  const sel=document.getElementById('exp_format'),
        dl=document.getElementById('exp_download');
  if(sel) sel.addEventListener('change',()=>{ if(dl) dl.disabled=!sel.value; });
  if(dl) dl.addEventListener('click',exportDownload);
  const em=document.getElementById('exp_email');
  if(em) em.addEventListener('click',()=>{ if(EXPORT_CUR) window.location.href=EXPORT_CUR.mailto; });
  document.querySelectorAll('#exportModal [data-expclose]').forEach(b=>b.addEventListener('click',closeExportReportModal));
  const ov=document.getElementById('exportModal');
  if(ov) ov.addEventListener('click',e=>{ if(e.target.id==='exportModal') closeExportReportModal(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && ov && ov.classList.contains('open')) closeExportReportModal(); });
}
export async function exportDownload(){
  if(!EXPORT_CUR) return;
  const fmt=(document.getElementById('exp_format')||{}).value;
  const ifr=document.getElementById('exp_preview');
  const base=(EXPORT_CUR.fname||'blotterbook-report.html').replace(/\.html$/,'');
  const msg=document.getElementById('exp_msg');
  const note=(t,k)=>{ if(msg){ msg.textContent=t||''; msg.className='parsestatus'+(k?' '+k:''); } };
  try{
    if(fmt==='pdf'){ ifr.contentWindow.focus(); ifr.contentWindow.print(); }
    else if(fmt==='md'){ downloadFile(base+'.md', new Blob([EXPORT_CUR.md],{type:'text/markdown;charset=utf-8'})); note('Markdown downloaded.','ok'); }
    else if(fmt==='png'||fmt==='jpeg'){
      note('Rendering image…');
      const type=fmt==='png'?'image/png':'image/jpeg';
      const blob=await rasterizeReport(ifr, type);
      downloadFile(base+'.'+fmt, blob); note('');
    }
  }catch(err){ console.error('export download failed', err); note('Could not export '+String(fmt).toUpperCase()+' — try PDF or Markdown.','err'); }
}
/* Rasterize the report node by embedding its serialized HTML + CSS in an SVG
   <foreignObject>, drawing that into a 2× canvas, then exporting a blob. The
   report uses only inline styles + system fonts + a CSS-gradient dot (no external
   images), so the canvas is not tainted. */
export function rasterizeReport(iframe, type){
  return new Promise((resolve,reject)=>{
    try{
      const doc=iframe.contentDocument, sheet=doc.querySelector('.sheet');
      if(!sheet) return reject(new Error('no report to render'));
      const w=Math.ceil(sheet.scrollWidth), h=Math.ceil(sheet.scrollHeight);
      const css=(doc.querySelector('style')||{}).textContent||'';
      const xml=new XMLSerializer().serializeToString(sheet);
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'
        +'<foreignObject x="0" y="0" width="'+w+'" height="'+h+'">'
        +'<div xmlns="http://www.w3.org/1999/xhtml"><style>'+css+'</style>'+xml+'</div>'
        +'</foreignObject></svg>';
      const img=new Image();
      img.onload=()=>{
        try{
          const sc=2, cv=document.createElement('canvas');
          cv.width=w*sc; cv.height=h*sc;
          const ctx=cv.getContext('2d'); ctx.scale(sc,sc);
          // raster background = the live --bg token (A8), not a hardcoded hex
          ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#0d1014';
          ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0);
          cv.toBlob(b=> b?resolve(b):reject(new Error('toBlob returned null')), type, type==='image/jpeg'?0.92:undefined);
        }catch(e){ reject(e); }
      };
      img.onerror=()=>reject(new Error('image render failed'));
      img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    }catch(e){ reject(e); }
  });
}
