"use strict";
/* Blotterbook app · render — dashboard rendering (cards, equity curve, calendar, advanced stats, break-even) + the scope/filter/render driver
   Loaded in order: core → render → data → ui → export → datamanager → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime). */

/* ============================================================
   Rendering — cards
   ============================================================ */
function renderCards(m, c=costModel(m)){   // c may be passed in to avoid recomputing per render (CH11)
  document.getElementById('cards').innerHTML=`
   <div class="card"><div class="k">Net PnL</div>
     <div class="v ${cls(c.netPreTax)}">${usd(c.netPreTax)}</div>
     <div class="sub">${m.n} trades · gross ${usd(m.net)}</div>
     <div class="sub">take-home ${usd(c.afterTax)} · after 1256 tax</div></div>
   <div class="card"><div class="k">Win Rate</div>
     <div class="v">${(m.n?100*m.wins/m.n:0).toFixed(1)}%</div>
     <div class="sub">${m.wins} W / ${m.losses} L${m.scratch?` / ${m.scratch} BE`:''}</div></div>
   <div class="card"><div class="k">Profit Factor</div>
     <div class="v ${c.pf>=1?'pos':'neg'}">${c.pf===Infinity?'∞':c.pf.toFixed(2)}</div>
     <div class="sub">${usd(c.pfGP)} / ${usd(Math.abs(c.pfGL),false)} · net of comm</div></div>
   <div class="card"><div class="k">Avg Win/Loss</div>
     <div class="v">${m.wl===Infinity?'∞':m.wl.toFixed(2)}</div>
     <div class="sub"><span class="pos">${usd(m.avgW)}</span> / <span class="neg">${usd(m.avgL)}</span></div></div>
   <div class="card"><div class="k">Max Drawdown</div>
     <div class="v neg">${usd(-m.maxDD)}</div>
     <div class="sub">realized, closed-trade</div></div>`;
}

/* ============================================================
   Rendering — performance graph (date-based, overlays, hover, click marker)
   ============================================================ */
const curveSel={gross:true, net:false, take:false};
let selectedDate=null;     // 'YYYY-MM-DD' highlighted from the calendar

function dateRange(m){
  if(SCOPE==='month') return [new Date(calYear,calMonth,1), new Date(calYear,calMonth+1,0)];
  if(!m || m.firstDate==='—'){ const t=new Date(); return [t,t]; }
  return [new Date(m.firstDate+'T00:00:00'), new Date(m.lastDate+'T00:00:00')];
}
function dailySeries(m){
  const broker=curBroker(), map=new Map();
  for(const t of m.trades){
    if(!map.has(t.date)) map.set(t.date,{gross:0,comm:0});
    const e=map.get(t.date); e.gross+=t.pnl; e.comm+=rateFor(broker,t.root).rate*2*(t.qty||1);  // per-contract (B4)
  }
  const c=costModel(m), tEff=c.tEff, fixedMo=c.fixedMo;
  // Accrue the monthly subscription as each new calendar month is entered (B8), instead of
  // dropping the whole period's subscriptions at day 0. The endpoint still equals
  // costModel.fixedPeriod (fixedMo × distinct months), so totals are unchanged.
  let cg=0,cn=0,subAcc=0; const pts=[], seenMonths=new Set();
  for(const d of [...map.keys()].sort()){
    const mo=d.slice(0,7);
    if(!seenMonths.has(mo)){ seenMonths.add(mo); subAcc+=fixedMo; }
    const e=map.get(d); cg+=e.gross; cn+=e.gross-e.comm;
    const net=cn-subAcc, take=net-(net>0?net*tEff:0);
    pts.push({date:d,gross:cg,net,take});
  }
  return {pts,subs:c.fixedPeriod,tEff};
}
/* "nice" axis ticks spanning [min,max] with ~count steps, always including 0. */
function niceTicks(min,max,count){
  const span=(max-min)||1;
  const rawStep=span/Math.max(1,count);
  const mag=Math.pow(10,Math.floor(Math.log10(rawStep)));
  const norm=rawStep/mag;
  const step=(norm<1.5?1:norm<3?2:norm<7?5:10)*mag;
  const lo=Math.floor(min/step)*step, hi=Math.ceil(max/step)*step;
  const ticks=[]; for(let v=lo; v<=hi+step*1e-6; v+=step) ticks.push(+v.toFixed(6));
  return ticks;
}
/* compact money for axis labels: $1.2k / $850 / -$3.4k */
function axMoney(v){ const a=Math.abs(v), s=v<0?'-':'';
  if(a>=1000) return s+'$'+(a/1000).toFixed(a>=10000?0:1)+'k';
  return s+'$'+Math.round(a); }

function renderCurve(m){
  const svg=document.getElementById('curve'), tip=document.getElementById('curvetip');
  // Draw at the SVG's real pixel width (viewBox = pixel width) so labels aren't horizontally
  // stretched on a wide grid column (promoted from staging, CH16).
  const W = Math.max(600, Math.round((svg.getBoundingClientRect().width)||1000));
  const H=260,padL=62,padR=20,padT=18,padB=46;
  if(!m || !m.n){ svg.innerHTML=''; if(tip)tip.style.display='none'; return; }

  const [rd0,rd1]=dateRange(m);
  const d0ms=rd0.getTime(), d1ms=Math.max(rd1.getTime(), d0ms+864e5);
  const {pts}=dailySeries(m);
  // Curve starts at the origin; subscriptions accrue month-by-month across pts (B8).
  const disp=[{date:fmtDate(rd0),gross:0,net:0,take:0}, ...pts];

  const series=[];
  if(curveSel.gross) series.push({key:'gross',color:'var(--green)',label:'Gross'});
  if(curveSel.net)   series.push({key:'net',  color:'var(--accent)',label:'Net'});
  if(curveSel.take)  series.push({key:'take', color:'var(--take)',  label:'Take-home'});
  if(!series.length) series.push({key:'gross',color:'var(--green)',label:'Gross'}); // defensive

  let vals=[0];
  for(const p of disp) for(const s of series) vals.push(p[s.key]);
  let min=Math.min(...vals), max=Math.max(...vals); if(min===max){min-=1;max+=1;}
  // expand the domain out to nice round tick bounds so the plot is framed cleanly
  const yticks=niceTicks(min,max,5);
  min=Math.min(min,yticks[0]); max=Math.max(max,yticks[yticks.length-1]);

  // linear scales mapping data → SVG pixels inside the padded plot box. yPx inverts
  // (1 - …) because SVG y grows downward, so a larger cumulative PnL sits higher up.
  const xMs=ms=> padL+((ms-d0ms)/(d1ms-d0ms))*(W-padL-padR);
  const xOf=p=> xMs(new Date(p.date+'T00:00:00').getTime());
  const yPx=v=> padT+(1-(v-min)/((max-min)||1))*(H-padT-padB);
  const zeroY=yPx(0);

  // horizontal gridlines + y labels
  let grid=yticks.map(v=>{ const y=yPx(v);
    return `<line class="grid" x1="${padL}" x2="${W-padR}" y1="${y}" y2="${y}"/>
      <text x="${padL-9}" y="${y+3.5}" text-anchor="end">${axMoney(v)}</text>`;}).join('');
  // vertical gridlines + date labels (5 ticks across the range)
  const xticks=[0,1,2,3,4].map(i=>d0ms+(d1ms-d0ms)*i/4);
  grid+=xticks.map((ms,i)=>{ const d=new Date(ms), x=xMs(ms);
    const vline=(i>0&&i<4)?`<line class="vgrid" x1="${x}" x2="${x}" y1="${padT}" y2="${H-padB}"/>`:'';
    return vline+`<text x="${x}" y="${H-padB+16}" text-anchor="middle">${pad2(d.getMonth()+1)}/${pad2(d.getDate())}</text>`;}).join('');

  // gradient area fill under the primary (first) series
  const prim=series[0];
  const areaPts=disp.map(p=>xOf(p)+','+yPx(p[prim.key])).join(' L ');
  const x0=xOf(disp[0]), xN=xOf(disp[disp.length-1]);
  const defs=`<defs><linearGradient id="cgrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:${prim.color};stop-opacity:.26"/>
      <stop offset="1" style="stop-color:${prim.color};stop-opacity:0"/></linearGradient></defs>`;
  const area=`<path d="M${areaPts} L ${xN},${H-padB} L ${x0},${H-padB} Z" fill="url(#cgrad)"/>`;

  // drawdown band only when focused on gross alone (keeps multi-overlay views clean)
  let band='';
  if(curveSel.gross && series.length===1){
    let peak=-Infinity; const top=[],bot=[];
    for(const p of disp){ peak=Math.max(peak,p.gross); top.push([xOf(p),yPx(peak)]); bot.push([xOf(p),yPx(p.gross)]); }
    band=`<path class="ddband" d="M${top.map(p=>p.join(',')).join(' L ')} L ${bot.reverse().map(p=>p.join(',')).join(' L ')} Z"/>`;
  }
  const lines=series.map(s=>`<path d="M${disp.map(p=>xOf(p)+','+yPx(p[s.key])).join(' L ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  const endDots=series.map(s=>{ const last=disp[disp.length-1];
    return `<circle cx="${xN}" cy="${yPx(last[s.key])}" r="3.2" fill="${s.color}"/>`;}).join('');
  const endLabels=series.map(s=>{ const last=disp[disp.length-1];
    return `<text x="${W-padR}" y="${yPx(last[s.key])-7}" text-anchor="end" style="fill:${s.color};font-weight:600">${usd(last[s.key])}</text>`;}).join('');

  // selected-date marker
  let sel='';
  if(selectedDate){ const sms=new Date(selectedDate+'T00:00:00').getTime();
    if(sms>=d0ms && sms<=d1ms){ const x=xMs(sms);
      sel=`<line class="selmark" x1="${x}" x2="${x}" y1="${padT}" y2="${H-padB}"/>`;
      const sp=disp.find(p=>p.date===selectedDate);
      if(sp) sel+=series.map(s=>`<circle cx="${x}" cy="${yPx(sp[s.key])}" r="3.5" fill="${s.color}"/>`).join('');
    }
  }
  // day-note indicators: a small blue dot on the curve at each date that has a note (CH16)
  let noteDots='';
  if(JOURNAL_DATES && JOURNAL_DATES.size){
    for(const nd of JOURNAL_DATES){
      const t=new Date(nd+'T00:00:00').getTime();
      if(t<d0ms || t>d1ms) continue;
      const sp=disp.find(p=>p.date===nd);
      let val;
      if(sp){ val=sp[prim.key]; }
      else { // no trade that day → put the dot on the carried/interpolated equity line
        let prev=null;
        for(const p of disp){ const pms=new Date(p.date+'T00:00:00').getTime();
          if(pms>t){ if(prev){ const pp=new Date(prev.date+'T00:00:00').getTime(); const f=(t-pp)/((pms-pp)||1); val=prev[prim.key]+(p[prim.key]-prev[prim.key])*f; } else val=p[prim.key]; break; }
          prev=p; val=p[prim.key];
        }
      }
      noteDots+=`<circle class="notedot" cx="${xMs(t)}" cy="${yPx(val||0)}" r="3" fill="var(--accent)" stroke="var(--bg)" stroke-width="1"><title>Note · ${nd}</title></circle>`;
    }
  }
  // axis titles
  const axis=`<text class="axt" x="${padL+(W-padL-padR)/2}" y="${H-4}" text-anchor="middle">Date</text>
    <text class="axt" transform="rotate(-90)" x="${-(padT+(H-padB)/2)}" y="15" text-anchor="middle">Cumulative PnL ($)</text>`;

  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.innerHTML=defs+grid+area+band
    +`<line class="zero" x1="${padL}" x2="${W-padR}" y1="${zeroY}" y2="${zeroY}"/>`
    +lines+endDots+noteDots+endLabels+sel+axis;

  // hover guide
  const g=document.createElementNS(SVGNS,'g'); g.style.display='none';
  const gline=document.createElementNS(SVGNS,'line'); gline.setAttribute('class','cguide'); g.appendChild(gline);
  const dots=series.map(s=>{ const c=document.createElementNS(SVGNS,'circle');
    c.setAttribute('r','3.5'); c.setAttribute('fill',s.color); g.appendChild(c); return c; });
  svg.appendChild(g);

  // shared guide+tooltip painter, driven by either the mouse or the keyboard cursor (B10)
  function showGuideAt(best){
    const x=xOf(best), r=svg.getBoundingClientRect();
    g.style.display=''; gline.setAttribute('x1',x); gline.setAttribute('x2',x);
    gline.setAttribute('y1',padT); gline.setAttribute('y2',H-padB);
    series.forEach((s,i)=>{ dots[i].setAttribute('cx',x); dots[i].setAttribute('cy',yPx(best[s.key])); });
    tip.style.display='block'; tip.style.left=(x/W*r.width)+'px'; tip.style.top='4px';
    tip.innerHTML=`<div class="td">${best.date}</div>`+series.map(s=>
      `<div class="tr"><span class="sw" style="background:${s.color}"></span>${s.label} <b>${usd(best[s.key])}</b></div>`).join('');
  }
  const hideGuide=()=>{ g.style.display='none'; tip.style.display='none'; };
  const nearestTo=mx=>{ let best=disp[0], bd=1e9; for(const p of disp){ const d=Math.abs(xOf(p)-mx); if(d<bd){bd=d;best=p;} } return best; };

  svg.onmousemove=ev=>{
    const r=svg.getBoundingClientRect(); const mx=(ev.clientX-r.left)/r.width*W;
    if(mx<padL-2 || mx>W-padR+2){ hideGuide(); return; }
    showGuideAt(nearestTo(mx));
  };
  svg.onmouseleave=hideGuide;

  // click the graph → select that date and jump the calendar to its month
  svg.style.cursor='crosshair';
  svg.onclick=ev=>{
    const r=svg.getBoundingClientRect(); const mx=(ev.clientX-r.left)/r.width*W;
    if(mx<padL-2 || mx>W-padR+2) return;
    selectFromGraph(nearestTo(mx).date);
  };

  // keyboard parity (B10): focus the curve, arrow across dates, Enter/Space to mark one.
  svg.setAttribute('tabindex','0');
  svg.setAttribute('role','button');
  svg.setAttribute('aria-label','Equity curve. Use Left and Right arrows to move across dates and read each day’s value; press Enter to mark the focused date on the calendar.');
  let kcur=disp.length-1;
  svg.onkeydown=ev=>{
    if(ev.key==='ArrowRight'||ev.key==='ArrowLeft'){
      ev.preventDefault(); kcur=Math.max(0,Math.min(disp.length-1,kcur+(ev.key==='ArrowRight'?1:-1))); showGuideAt(disp[kcur]);
    } else if(ev.key==='Home'){ ev.preventDefault(); kcur=0; showGuideAt(disp[kcur]); }
    else if(ev.key==='End'){ ev.preventDefault(); kcur=disp.length-1; showGuideAt(disp[kcur]); }
    else if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); selectFromGraph(disp[kcur].date); }
  };
  svg.onfocus=()=>{ kcur=Math.max(0,Math.min(disp.length-1,kcur)); showGuideAt(disp[kcur]); };
  svg.onblur=hideGuide;
}

/* ============================================================
   Rendering — calendar (Sunday-first; click to mark on graph)
   ============================================================ */
const MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
function renderCalendar(){
  const m=METRICS_ALL; if(!m) return;
  // Preserve keyboard focus across the wholesale innerHTML rebuild: if a day cell is focused,
  // remember its date and restore focus to the same cell afterwards (B10 follow-on, B15).
  const calEl=document.getElementById('cal'), ae=document.activeElement;
  const refocusDate=(ae && calEl && calEl.contains(ae) && ae.dataset)?ae.dataset.date:null;
  const byDate=new Map(m.days.map(d=>[d.date,d]));
  document.getElementById('mlabel').textContent=`${MON[calMonth]} ${calYear}`;
  let html='<div class="dow wk">Week</div>'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="dow">${d}</div>`).join('');
  const first=new Date(calYear,calMonth,1);
  const offset=first.getDay();               // 0=Sun → Sunday-first grid
  let cur=new Date(calYear,calMonth,1-offset);
  for(let w=0;w<6;w++){
    const weekCells=[]; let weekPnl=0, weekDays=0, monthHit=false;
    for(let d=0;d<7;d++){
      const y=cur.getFullYear(), mo=cur.getMonth(), da=cur.getDate();
      const key=`${y}-${pad2(mo+1)}-${pad2(da)}`;
      const inMonth=mo===calMonth;
      if(inMonth)monthHit=true;
      const rec=byDate.get(key);
      const selc = key===selectedDate?' selday':'';
      const note = JOURNAL_DATES.has(key)?' hasnote':'';
      if(!inMonth){
        weekCells.push(`<div class="cell off"></div>`);
      } else if(rec){
        weekPnl+=rec.pnl; weekDays++;
        const k=rec.pnl>0?'win':rec.pnl<0?'loss':'';
        const wr=rec.trades?(100*rec.wins/rec.trades).toFixed(0):'0';
        const lbl=`${MON[mo]} ${da}: ${rec.trades} trade${rec.trades===1?'':'s'}, ${usd(rec.pnl)}`;
        weekCells.push(`<div class="cell ${k}${selc}${note}" data-date="${key}" tabindex="0" role="button" aria-label="${lbl}"><span class="dnum">${da}</span>
          <div class="pnl ${cls(rec.pnl)}">${usd(rec.pnl)}</div>
          <div class="meta">${rec.trades} tr · ${wr}%</div></div>`);
      } else {
        weekCells.push(`<div class="cell${selc}${note}" data-date="${key}" tabindex="0" role="button" aria-label="${MON[mo]} ${da}: no trades"><span class="dnum">${da}</span></div>`);
      }
      cur.setDate(cur.getDate()+1);
    }
    if(w>0 && !monthHit) break;
    const weekNo=isoWeek(new Date(cur.getTime()-4*864e5));   // Wednesday of this row
    html+=`<div class="cell wkcell"><div class="wl">Wk ${weekNo}</div>
        <div class="wp ${cls(weekPnl)}">${weekDays?usd(weekPnl):'$0.00'}</div>
        <div class="wd">${weekDays} day${weekDays===1?'':'s'}</div></div>`+weekCells.join('');
  }
  calEl.innerHTML=html;
  if(refocusDate){ const c=calEl.querySelector(`.cell[data-date="${refocusDate}"]`); if(c) c.focus(); }
  // F11: keep the notes box hidden unless a day is selected (without touching its text).
  const journal=document.getElementById('journal');
  if(journal) journal.style.display = selectedDate ? '' : 'none';
}
function isoWeek(d){ const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const dn=(t.getUTCDay()+6)%7; t.setUTCDate(t.getUTCDate()-dn+3);
  const y0=new Date(Date.UTC(t.getUTCFullYear(),0,4));
  return 1+Math.round(((t-y0)/864e5-3+((y0.getUTCDay()+6)%7))/7); }

/* ============================================================
   Rendering — advanced statistics
   ============================================================ */
function fmtDur(ms){
  const s=Math.round(ms/1000);
  if(s<90) return s+'s';
  const mn=Math.round(s/60);
  if(mn<90) return mn+'m';
  const h=Math.floor(mn/60), rem=mn%60;
  if(h<24) return h+'h'+(rem?' '+rem+'m':'');
  const d=Math.floor(h/24); return d+'d'+(h%24?' '+(h%24)+'h':'');
}
function renderAdv(m, c=costModel(m)){
  // hold time is only available for fills-based platform exports (round-trip matched)
  const held=(m.trades||[]).filter(t=>t.holdMs!=null && t.holdMs>0);
  const avgHold=held.length? held.reduce((a,t)=>a+t.holdMs,0)/held.length : null;
  const rows=[
    ['head','Performance Metrics'],
    ['Avg Daily PnL', `<span class="av ${cls(m.avgDaily)}">${usd(m.avgDaily)}</span>`],
    ['Best Trade', `<span class="av pos">${usd(m.best)}</span>`],
    ['Worst Trade', `<span class="av neg">${usd(m.worst)}</span>`],
    ['Winning Days', `<span class="av">${m.winDayPct.toFixed(1)}%</span>`],
    ['Total Commissions', `<span class="av ${c.totalComm?'neg':'na'}">${usd(-c.totalComm)}</span>`],
    ['Sharpe (daily)', `<span class="av">${isNaN(m.sharpe)?'—':m.sharpe.toFixed(2)}</span>`],
    ['head','Edge & Distribution'],
    ['Expectancy / Trade', `<span class="av ${cls(m.expectancy)}">${usd(m.expectancy)}</span>`],
    ['Std Dev / Trade', `<span class="av">${usd(m.tStd,false)}</span>`],
    ['Long PnL', `<span class="av ${cls(m.long.pnl)}">${usd(m.long.pnl)}</span> <span class="av na">· ${m.long.n}</span>`],
    ['Short PnL', `<span class="av ${cls(m.short.pnl)}">${usd(m.short.pnl)}</span> <span class="av na">· ${m.short.n}</span>`],
    ['Best Day', m.bestDay?`<span class="av pos">${usd(m.bestDay.pnl)}</span> <span class="av na">· ${m.bestDay.date}</span>`:`<span class="av na">—</span>`],
    ['Worst Day', m.worstDay?`<span class="av neg">${usd(m.worstDay.pnl)}</span> <span class="av na">· ${m.worstDay.date}</span>`:`<span class="av na">—</span>`],
    ['Best Weekday', m.bestDow?`<span class="av ${cls(m.bestDow.pnl)}">${usd(m.bestDow.pnl)}</span> <span class="av na">· ${DOW_LABEL[m.bestDow.i]}</span>`:`<span class="av na">—</span>`],
    ['Worst Weekday', m.worstDow?`<span class="av ${cls(m.worstDow.pnl)}">${usd(m.worstDow.pnl)}</span> <span class="av na">· ${DOW_LABEL[m.worstDow.i]}</span>`:`<span class="av na">—</span>`],
    ['head','Trading Patterns'],
    ['Avg Trades/Day', `<span class="av">${m.avgTrades.toFixed(1)}</span>`],
    ['Recovery Factor', `<span class="av ${cls(m.recovery)}">${m.recovery===Infinity?'∞':(isNaN(m.recovery)?'—':m.recovery.toFixed(2))}</span>`],
    ['Max Consecutive Wins', `<span class="av pos">${m.mcw}</span>`],
    ['Max Consecutive Losses', `<span class="av neg">${m.mcl}</span>`],
    ['head','Account Information'],
    ['Active Days', `<span class="av">${m.active}</span>`],
    ['First Trade Date', `<span class="av">${m.firstDate}</span>`],
    ['Last Trade Date', `<span class="av">${m.lastDate}</span>`],
  ];
  if(avgHold!=null){
    rows.splice(rows.indexOf(rows.find(r=>r[0]==='Max Consecutive Losses'))+1, 0,
      ['Avg Hold Time', `<span class="av">${fmtDur(avgHold)}</span> <span class="av na">· ${held.length}/${m.n}</span>`]);
  }
  document.getElementById('adv').innerHTML=rows.map(([a,b])=>
    a==='head'?`<div class="subhead">${b}</div>`
    :`<div class="arow"><span class="al">${a}</span>${b}</div>`).join('');
}

/* ============================================================
   Rendering — break-even / cost budget
   ============================================================ */
function renderCalc(m, c=costModel(m)){
  const tbl=document.getElementById('c_comm_table'),
        head=document.getElementById('c_head'),
        rowsEl=document.getElementById('c_rows'),
        cap=document.getElementById('c_cap');
  if(!m || !m.n){ tbl.innerHTML=''; head.innerHTML=''; rowsEl.innerHTML=''; cap.innerHTML=''; return; }
  const bePer= c.n>0 ? (c.totalComm+c.fixedPeriod)/c.n : 0;

  cap.innerHTML=`Broker: <b>${BROKERS[c.broker].name}</b> &nbsp;·&nbsp; Feed: ${feedName()} &nbsp;·&nbsp; Platform $${c.platform}/mo`;

  const body=c.bySym.map(s=>
    `<tr><td>${esc(s.root)}${s.known?'':' <span class="flag">*</span>'}</td>
      <td>${s.count}</td><td>${s.qty}</td><td>${money(s.rate)}</td><td>${money(s.rate*2)}</td><td>${money(s.total)}</td></tr>`).join('');
  const anyUnknown=c.bySym.some(s=>!s.known);
  const commHtml=
    `<table class="commtab"><thead><tr><th>Symbol</th><th>Trades</th><th>Cts</th><th>$/side</th><th>$/RT</th><th>Commission</th></tr></thead>
     <tbody>${body}<tr class="tot"><td>Total</td><td>${c.n}</td><td>${c.contracts}</td><td></td><td></td><td>${money(c.totalComm)}</td></tr></tbody></table>`
    + (anyUnknown?`<div class="cnote"><span class="flag">*</span> No published exchange fee on file — priced with a fallback estimate. Add the symbol to <code>data/exchange-fees.json</code> for an exact figure.</div>`:'');
  // F6 (CH16): the per-symbol table lives in a collapsible subsection nested under the
  // "Commissions (all-in)" line below, so the standalone table here is empty.
  tbl.innerHTML = '';

  head.innerHTML=
    `<div class="k">Net P&L after costs &middot; ${scopeLabel()}</div>
     <div class="v ${cls(c.netPreTax)}">${money(c.netPreTax)}</div>
     <div class="sub">${c.n} trades &middot; ${c.months} month${c.months===1?'':'s'} of subscriptions &middot; gross ${money(c.gross)}</div>
     <div class="tax">After 1256 tax (${(c.tEff*100).toFixed(1)}%): ${money(c.afterTax)} &nbsp;&middot;&nbsp; break-even ${money(bePer)}/trade</div>`;

  const row=(l,v,cl='')=>`<div class="crow ${cl}"><span class="cl">${l}</span><span class="cv">${v}</span></div>`;
  rowsEl.innerHTML=
     row('Gross P&L', `<span class="${cls(c.gross)}">${money(c.gross)}</span>`)
    +row('Commissions (all-in)', `<span class="neg">${money(-c.totalComm)}</span>`)
    +`<details class="csubtable"><summary>Per-symbol breakdown</summary><div class="csubbody">${commHtml}</div></details>`
    +row('Subscriptions ('+money(c.fixedMo)+'/mo &times; '+c.months+')', `<span class="neg">${money(-c.fixedPeriod)}</span>`)
    +row('Net P&L (pre-tax)', `<span class="${cls(c.netPreTax)}">${money(c.netPreTax)}</span>`,'tot')
    // 1256 tax (F10/CH16): one headline line with the total, the rate detail tucked into a
    // collapsible breakdown (like the per-symbol commissions above).
    +row('Est. 1256 tax (net profit only)', `<span class="neg">${money(-c.tax)}</span>`)
    +`<details class="csubtable"><summary>Tax breakdown</summary><div class="csubbody">`
    +  row('State top rate', stateRate().toFixed(2)+'%','sub')
    +  row('Blended 1256 rate', (c.tEff*100).toFixed(1)+'%','sub')
    +`</div></details>`
    +row('After-tax take-home', `<span class="${cls(c.afterTax)}">${money(c.afterTax)}</span>`,'tot');
}

/* ============================================================
   Scope + filters + driver
   ============================================================ */
let TRADES=[], METRICS_ALL=null, SCOPE='all', calYear, calMonth;
let JOURNAL_DATES=new Set();   // dates with a saved note (for calendar dots)
let TRADE_META=new Map();      // trade id -> { id, tags:[], note, shots:[] }
let DEMO_MODE=false;           // demo data is never persisted

const tradeKey=t=> t.id || (window.Store ? Store.tradeId(t) : '');
async function loadTradeMeta(){
  if(!Store.available()){ TRADE_META=new Map(); return; }
  try{ const all=await Store.allTradeMeta(); TRADE_META=new Map(all.map(m=>[m.id,m])); }
  catch(_){ TRADE_META=new Map(); }
}

const FILTERS={from:'',to:'',symbol:'',side:'',session:'',tag:'',dows:new Set()};
function filtersActive(){ return !!(FILTERS.from||FILTERS.to||FILTERS.symbol||FILTERS.side||FILTERS.session||FILTERS.tag||FILTERS.dows.size); }
/* RTH = 09:30–16:00 by the timestamp's clock time as exported; everything else ETH. */
function sessionOf(t){ const hm=t.time.slice(11,16); if(!hm) return 'eth';
  return (hm>='09:30' && hm<'16:00')?'rth':'eth'; }
function applyFilters(arr){
  return arr.filter(t=>{
    if(FILTERS.from && t.date<FILTERS.from) return false;
    if(FILTERS.to   && t.date>FILTERS.to)   return false;
    if(FILTERS.symbol && t.root!==FILTERS.symbol) return false;
    if(FILTERS.side && t.side!==FILTERS.side) return false;
    if(FILTERS.session && sessionOf(t)!==FILTERS.session) return false;
    if(FILTERS.tag){ const m=TRADE_META.get(tradeKey(t)); if(!m || !(m.tags||[]).includes(FILTERS.tag)) return false; }
    if(FILTERS.dows.size && !FILTERS.dows.has(new Date(t.date+'T00:00:00').getDay())) return false;
    return true;
  });
}
/* Filters apply to the performance graph ONLY — the calendar, cards, cost, and stats always
   use the full (unfiltered) dataset (promoted from staging, CH16). */
function graphBase(){ return applyFilters(TRADES); }
function baseTrades(){ return TRADES.slice(); }

function scopeLabel(){ return SCOPE==='all' ? 'all time' : `${MON[calMonth]} ${calYear}`; }
function activeMetrics(){
  if(SCOPE==='all') return METRICS_ALL;
  const mk=`${calYear}-${pad2(calMonth+1)}`;
  return compute(baseTrades().filter(t=>t.date.startsWith(mk)));
}
/* Filtered metrics for the staging performance graph (scope + filters). */
function activeGraphMetrics(){
  const arr=graphBase();
  if(SCOPE==='all') return compute(arr);
  const mk=`${calYear}-${pad2(calMonth+1)}`;
  return compute(arr.filter(t=>t.date.startsWith(mk)));
}
/* Metrics the performance graph should draw — filtered (scope + filter bar), CH16. */
function curveMetrics(){ return activeGraphMetrics(); }
function renderDash(){
  if(!METRICS_ALL) return;
  const m=activeMetrics(), c=costModel(m);   // compute the cost model once, share it (CH11)
  renderCards(m,c); renderAdv(m,c); renderCalc(m,c);
  renderCurve(activeGraphMetrics());
  document.getElementById('scopenote').textContent =
    SCOPE==='all' ? `all ${METRICS_ALL.n} trades` : `${MON[calMonth]} ${calYear}`;
}
function setScope(s){
  SCOPE=s;
  document.querySelectorAll('#scope button').forEach(b=>b.classList.toggle('on',b.dataset.s===s));
  renderDash();
}
function setDashVisible(v){
  document.getElementById('dash').style.display = v?'':'none';
  document.getElementById('scoperow').style.display = v?'':'none';
  document.body.classList.toggle('loaded', v);          // drives top-bar / setup visibility
  // Broker & Costs starts minimized on a populated dashboard; expanded on the landing.
  const setup=document.getElementById('setup'); if(setup) setup.classList.toggle('collapsed', v);
}
/* The not-loaded view is the centered landing block (#landing) in the markup,
   shown via the body:not(.loaded) rule; the cards row stays empty until load. */
function showEmpty(){ const c=$('cards'); if(c) c.innerHTML=''; }
function resetApp(){
  TRADES=[]; METRICS_ALL=null; selectedDate=null;
  const f=$('file'); if(f) f.value='';
  setDashVisible(false);
  $('srcmeta').innerHTML='';
  $('srcname').textContent='no data loaded';
  updateJournalEditor();
  showEmpty();
}

/* Render whatever is in TRADES (already the full, merged set). */
function renderLoaded(name, metaHtml){
  if(!TRADES.length){ resetApp(); return; }
  setDashVisible(true);
  selectedDate=null;
  METRICS_ALL=compute(baseTrades());
  if(name) document.getElementById('srcname').textContent=name;
  document.getElementById('srcmeta').innerHTML=metaHtml||'';
  const ld = METRICS_ALL.lastDate!=='—' ? METRICS_ALL.lastDate : fmtDate(new Date());
  const [yy,mm]=ld.split('-').map(Number); calYear=yy; calMonth=mm-1;
  syncFilterOptions();
  updateJournalEditor();
  renderCalendar();
  renderDash();
}
