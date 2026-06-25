"use strict";
const SVGNS='http://www.w3.org/2000/svg';
const pad2 = n => String(n).padStart(2,'0');
const fmtDate = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const $ = id => document.getElementById(id);
/* Page modes (document.body[data-mode]):
     ''        — the main app
     'demo'    — in-memory sample data, never persists (its own trimmed top bar)
     'staging' — a clone of the main app on an ISOLATED IndexedDB, plus experimental
                 features (web-grid dashboard, graph-only filters, note dots, saved filters) */
const PAGE_MODE = (document.body && document.body.dataset.mode) || '';
const STAGING_PAGE = PAGE_MODE === 'staging';

/* CSV parsing now lives in adapters.js (window.Adapters) — platform-specific
   format detection + normalization to the internal trade shape below. */

/* ============================================================
   Metrics
   ============================================================ */
function compute(tr){
  const n=tr.length, pnls=tr.map(t=>t.pnl);
  const wins=pnls.filter(p=>p>0), losses=pnls.filter(p=>p<0), scratch=pnls.filter(p=>p===0);
  const net=pnls.reduce((a,b)=>a+b,0);
  const gp=wins.reduce((a,b)=>a+b,0), gl=losses.reduce((a,b)=>a+b,0);
  const pf= gl!==0 ? gp/Math.abs(gl) : Infinity;
  const avgW= wins.length? gp/wins.length : 0;
  const avgL= losses.length? gl/losses.length : 0;
  const wl= losses.length? avgW/Math.abs(avgL) : Infinity;
  let eq=0,peak=0,maxDD=0; const curve=[0];
  for(const p of pnls){ eq+=p; peak=Math.max(peak,eq); maxDD=Math.max(maxDD,peak-eq); curve.push(eq); }
  const dayMap=new Map();
  for(const t of tr){ if(!dayMap.has(t.date))dayMap.set(t.date,[]); dayMap.get(t.date).push(t.pnl); }
  const days=[...dayMap.entries()].map(([d,arr])=>({date:d,pnl:arr.reduce((a,b)=>a+b,0),
      trades:arr.length,wins:arr.filter(p=>p>0).length})).sort((a,b)=>a.date<b.date?-1:1);
  const active=days.length;
  const winDays=days.filter(d=>d.pnl>0).length;
  let mcw=0,mcl=0,cw=0,cl=0;
  for(const p of pnls){ if(p>0){cw++;cl=0;} else if(p<0){cl++;cw=0;} else {cw=0;cl=0;} mcw=Math.max(mcw,cw); mcl=Math.max(mcl,cl); }
  const dv=days.map(d=>d.pnl);
  const mean=dv.reduce((a,b)=>a+b,0)/(dv.length||1);
  const variance=dv.length? dv.reduce((a,b)=>a+(b-mean)**2,0)/dv.length : 0;
  const sd=Math.sqrt(variance);
  const sharpe= sd>0 ? mean/sd : NaN;
  const months=new Set(tr.map(t=>t.date.slice(0,7))).size;
  // expectancy + per-trade dispersion
  const expectancy = n? net/n : 0;
  const tmean = expectancy;
  const tStd = n? Math.sqrt(pnls.reduce((a,p)=>a+(p-tmean)**2,0)/n) : 0;
  // long / short split
  const side=k=>{ const s=tr.filter(t=>t.side===k); const p=s.reduce((a,t)=>a+t.pnl,0);
    return {n:s.length,pnl:p,wins:s.filter(t=>t.pnl>0).length}; };
  const long=side('long'), short=side('short');
  // day-of-week aggregation (0=Sun..6=Sat)
  const dow=Array.from({length:7},()=>({pnl:0,n:0}));
  for(const t of tr){ const wd=new Date(t.date+'T00:00:00').getDay(); dow[wd].pnl+=t.pnl; dow[wd].n++; }
  const dowActive=dow.map((d,i)=>({i,...d})).filter(d=>d.n);
  const bestDow = dowActive.length? dowActive.reduce((a,b)=>b.pnl>a.pnl?b:a) : null;
  const worstDow= dowActive.length? dowActive.reduce((a,b)=>b.pnl<a.pnl?b:a) : null;
  return {n,trades:tr,wins:wins.length,losses:losses.length,scratch:scratch.length,
    net,gp,gl,pf,avgW,avgL,wl,maxDD,curve,pnls,months,
    best:n?Math.max(...pnls):0, worst:n?Math.min(...pnls):0,
    days,active,winDays,avgDaily:active?net/active:0,avgTrades:active?n/active:0,
    winDayPct:active?100*winDays/active:0, mcw,mcl,
    recovery: maxDD>0? net/maxDD : NaN, sharpe,
    expectancy,tStd,long,short,bestDow,worstDow,
    bestDay: days.length? days.reduce((a,b)=>b.pnl>a.pnl?b:a) : null,
    worstDay: days.length? days.reduce((a,b)=>b.pnl<a.pnl?b:a) : null,
    lastDate: tr.length? tr[tr.length-1].date : '—',
    firstDate: tr.length? tr[0].date : '—'};
}
const DOW_LABEL=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* ============================================================
   Formatting
   ============================================================ */
const usd=(v,s=true)=>{ if(v===Infinity)return '∞'; const sign=v<0?'-':(s&&v>0?'+':'');
  return sign+'$'+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
const money=v=>usd(v,false);
const cls=v=> v>0?'pos':v<0?'neg':'';

/* ============================================================
   Broker / commission / cost model
   ------------------------------------------------------------
   All-in per-side = broker commission (by micro/standard tier)
   + CME exchange/clearing/NFA fee (by root). Both are editable
   snapshot estimates (mid-2026). See README for sources.
   ============================================================ */

/* Reference data — loaded at runtime from /data/*.json (see loadRefData).
   Populated before any setup/render runs, so call-time access is safe. */
let EXCH = {};                 // root -> exchange/clearing/NFA $ per side
let MICRO = new Set();         // roots priced at the micro tier
let EXCH_FALLBACK = {micro:0.37, std:1.50};
let BROKERS = {};              // key -> {name, comm:{micro,std}}
let BROKER_ORDER = [];
let BROKER_FEEDS = {};         // key -> {group: [[label,$/mo],...]}
let STATES = [];              // [abbr, ratePct, name]
let TAXMODEL = {fedOrdinary:24, ltcg:15, ltcgWeight:0.6, ordinaryWeight:0.4};

function tierOf(root){ if(EXCH[root]!=null) return MICRO.has(root)?'micro':'std';
  return (root[0]==='M' && root.length>=3)?'micro':'std'; }
function exchOf(root,tier){ return EXCH[root]!=null?EXCH[root]:(tier==='micro'?EXCH_FALLBACK.micro:EXCH_FALLBACK.std); }

const DEMO_BROKER='AMP', DEMO_FEED='Bundle — All CME markets|15', DEMO_STATE='AR';

/* ------------------------------------------------------------
   Runtime fetch of reference data, cache-busted by content hash.
   manifest.json (no-cache) maps each file to a short hash; each
   data file is then fetched as `<file>?v=<hash>` so it can be
   cached indefinitely yet still update the instant its bytes change.
   ------------------------------------------------------------ */
async function loadRefData(){
  const man = await fetch('../data/manifest.json?t='+Date.now(), {cache:'no-cache'})
    .then(r=>{ if(!r.ok) throw new Error('manifest '+r.status); return r.json(); });
  const v = f => man.files && man.files[f] ? '?v='+man.files[f] : '';
  const get = f => fetch(`../data/${f}${v(f)}`).then(r=>{ if(!r.ok) throw new Error(f+' '+r.status); return r.json(); });
  const [exch, brokers, feeds, tax] = await Promise.all([
    get('exchange-fees.json'), get('brokers.json'), get('feeds.json'), get('state-tax.json')
  ]);

  EXCH = exch.exchange || {};
  MICRO = new Set(exch.micro || []);
  EXCH_FALLBACK = exch.fallback || EXCH_FALLBACK;

  BROKERS = brokers.brokers || {};
  BROKER_ORDER = brokers.order || Object.keys(BROKERS);

  // resolve string aliases (e.g. "AMP": "CQG") against feeds.shared
  const shared = feeds.shared || {};
  BROKER_FEEDS = {};
  for(const k in (feeds.brokerFeeds||{})){
    const v = feeds.brokerFeeds[k];
    BROKER_FEEDS[k] = (typeof v==='string') ? (shared[v]||{}) : v;
  }

  STATES = tax.states || [];
  TAXMODEL = Object.assign(TAXMODEL, tax.model||{});
}

function curBroker(){ const e=document.getElementById('c_broker'); return (e&&e.value)?e.value:'AMP'; }
function rateFor(brokerKey, root){
  const b=BROKERS[brokerKey]||BROKERS.AMP;
  const tier=tierOf(root), exch=exchOf(root,tier);
  return {rate:+(b.comm[tier]+exch).toFixed(4), known:EXCH[root]!=null};
}

function numIn(id){ const e=document.getElementById(id); const v=e?parseFloat(e.value):NaN; return isNaN(v)?0:v; }
function feedCost(){ const o=document.getElementById('c_feed'); const x=o&&o.selectedOptions[0]?parseFloat(o.selectedOptions[0].dataset.cost):NaN; return isNaN(x)?0:x; }
function feedName(){ const o=document.getElementById('c_feed'); return (o&&o.value)?o.value.split('|')[0]:'—'; }
function stateRate(){ const o=document.getElementById('c_state_sel'); const x=o&&o.selectedOptions[0]?parseFloat(o.selectedOptions[0].dataset.rate):NaN; return isNaN(x)?0:x; }
function blendedRate(){ return TAXMODEL.ltcgWeight*TAXMODEL.ltcg/100 + TAXMODEL.ordinaryWeight*TAXMODEL.fedOrdinary/100 + stateRate()/100; }

function costModel(m){
  const broker=curBroker(), platform=numIn('c_tv'), data=feedCost(), fixedMo=platform+data;
  const trades=(m&&m.trades)?m.trades:[];
  const bySym=new Map(); let totalComm=0, gp=0, gl=0;
  for(const t of trades){
    const {rate,known}=rateFor(broker,t.root); const rt=rate*2;
    totalComm+=rt;
    if(!bySym.has(t.root)) bySym.set(t.root,{root:t.root,count:0,rate,known,total:0});
    const e=bySym.get(t.root); e.count++; e.total+=rt;
    const x=t.pnl-rt; if(x>0)gp+=x; else if(x<0)gl+=x;
  }
  const months=m?m.months:0;
  const fixedPeriod=fixedMo*months;
  const gross=m?m.net:0;
  const netPreTax=gross-totalComm-fixedPeriod;
  const tEff=blendedRate();
  const tax= netPreTax>0 ? netPreTax*tEff : 0;
  const afterTax=netPreTax-tax;
  const pf= gl!==0 ? gp/Math.abs(gl) : (gp>0?Infinity:0);
  return {broker,platform,data,fixedMo,totalComm,months,fixedPeriod,gross,netPreTax,tEff,tax,afterTax,
    pfGP:gp,pfGL:gl,pf,n:trades.length,
    bySym:[...bySym.values()].sort((a,b)=>b.total-a.total)};
}

/* ============================================================
   Rendering — cards
   ============================================================ */
function renderCards(m){
  const c=costModel(m);
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
    const e=map.get(t.date); e.gross+=t.pnl; e.comm+=rateFor(broker,t.root).rate*2;
  }
  const c=costModel(m), subs=c.fixedPeriod, tEff=c.tEff;
  let cg=0,cn=0; const pts=[];
  for(const d of [...map.keys()].sort()){
    const e=map.get(d); cg+=e.gross; cn+=e.gross-e.comm;
    const net=cn-subs, take=net-(net>0?net*tEff:0);
    pts.push({date:d,gross:cg,net,take});
  }
  return {pts,subs,tEff};
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
  // staging draws at the SVG's real pixel width (viewBox = pixel width) so labels aren't
  // horizontally stretched on a wide grid column; elsewhere keep the fixed 1000-unit box.
  const W = STAGING_PAGE ? Math.max(600, Math.round((svg.getBoundingClientRect().width)||1000)) : 1000;
  const H=260,padL=62,padR=20,padT=18,padB=46;
  if(!m || !m.n){ svg.innerHTML=''; if(tip)tip.style.display='none'; return; }

  const [rd0,rd1]=dateRange(m);
  const d0ms=rd0.getTime(), d1ms=Math.max(rd1.getTime(), d0ms+864e5);
  const {pts,subs}=dailySeries(m);
  const disp=[{date:fmtDate(rd0),gross:0,net:-subs,take:-subs}, ...pts];

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
  // day-note indicators: a small blue dot on the curve at each date that has a note (staging)
  let noteDots='';
  if(STAGING_PAGE && JOURNAL_DATES && JOURNAL_DATES.size){
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

  svg.onmousemove=ev=>{
    const r=svg.getBoundingClientRect(); const mx=(ev.clientX-r.left)/r.width*W;
    if(mx<padL-2 || mx>W-padR+2){ g.style.display='none'; tip.style.display='none'; return; }
    let best=disp[0], bd=1e9;
    for(const p of disp){ const d=Math.abs(xOf(p)-mx); if(d<bd){bd=d;best=p;} }
    const x=xOf(best);
    g.style.display=''; gline.setAttribute('x1',x); gline.setAttribute('x2',x);
    gline.setAttribute('y1',padT); gline.setAttribute('y2',H-padB);
    series.forEach((s,i)=>{ dots[i].setAttribute('cx',x); dots[i].setAttribute('cy',yPx(best[s.key])); });
    tip.style.display='block'; tip.style.left=(x/W*r.width)+'px'; tip.style.top='4px';
    tip.innerHTML=`<div class="td">${best.date}</div>`+series.map(s=>
      `<div class="tr"><span class="sw" style="background:${s.color}"></span>${s.label} <b>${usd(best[s.key])}</b></div>`).join('');
  };
  svg.onmouseleave=()=>{ g.style.display='none'; tip.style.display='none'; };

  // click the graph → select that date and jump the calendar to its month
  svg.style.cursor='crosshair';
  svg.onclick=ev=>{
    const r=svg.getBoundingClientRect(); const mx=(ev.clientX-r.left)/r.width*W;
    if(mx<padL-2 || mx>W-padR+2) return;
    let best=disp[0], bd=1e9;
    for(const p of disp){ const d=Math.abs(xOf(p)-mx); if(d<bd){bd=d;best=p;} }
    selectFromGraph(best.date);
  };
}

/* ============================================================
   Rendering — calendar (Sunday-first; click to mark on graph)
   ============================================================ */
const MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
function renderCalendar(){
  const m=METRICS_ALL; if(!m) return;
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
        weekCells.push(`<div class="cell ${k}${selc}${note}" data-date="${key}"><span class="dnum">${da}</span>
          <div class="pnl ${cls(rec.pnl)}">${usd(rec.pnl)}</div>
          <div class="meta">${rec.trades} tr · ${wr}%</div></div>`);
      } else {
        weekCells.push(`<div class="cell${selc}${note}" data-date="${key}"><span class="dnum">${da}</span></div>`);
      }
      cur.setDate(cur.getDate()+1);
    }
    if(w>0 && !monthHit) break;
    const weekNo=isoWeek(new Date(cur.getTime()-4*864e5));   // Wednesday of this row
    html+=`<div class="cell wkcell"><div class="wl">Wk ${weekNo}</div>
        <div class="wp ${cls(weekPnl)}">${weekDays?usd(weekPnl):'$0.00'}</div>
        <div class="wd">${weekDays} day${weekDays===1?'':'s'}</div></div>`+weekCells.join('');
  }
  document.getElementById('cal').innerHTML=html;
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
function renderAdv(m){
  const c=costModel(m);
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
    ['Recovery Factor', `<span class="av ${cls(m.recovery)}">${isNaN(m.recovery)?'—':m.recovery.toFixed(2)}</span>`],
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
function renderCalc(m){
  const tbl=document.getElementById('c_comm_table'),
        head=document.getElementById('c_head'),
        rowsEl=document.getElementById('c_rows'),
        cap=document.getElementById('c_cap');
  if(!m || !m.n){ tbl.innerHTML=''; head.innerHTML=''; rowsEl.innerHTML=''; cap.innerHTML=''; return; }
  const c=costModel(m);
  const bePer= c.n>0 ? (c.totalComm+c.fixedPeriod)/c.n : 0;

  cap.innerHTML=`Broker: <b>${BROKERS[c.broker].name}</b> &nbsp;·&nbsp; Feed: ${feedName()} &nbsp;·&nbsp; Platform $${c.platform}/mo`;

  const body=c.bySym.map(s=>
    `<tr><td>${s.root}${s.known?'':' <span class="flag">*</span>'}</td>
      <td>${s.count}</td><td>${money(s.rate)}</td><td>${money(s.rate*2)}</td><td>${money(s.total)}</td></tr>`).join('');
  const anyUnknown=c.bySym.some(s=>!s.known);
  tbl.innerHTML=
    `<table class="commtab"><thead><tr><th>Symbol</th><th>Trades</th><th>$/side</th><th>$/RT</th><th>Commission</th></tr></thead>
     <tbody>${body}<tr class="tot"><td>Total</td><td>${c.n}</td><td></td><td></td><td>${money(c.totalComm)}</td></tr></tbody></table>`
    + (anyUnknown?`<div class="cnote"><span class="flag">*</span> No published exchange fee on file — priced with a fallback estimate. Add the symbol to <code>data/exchange-fees.json</code> for an exact figure.</div>`:'');

  head.innerHTML=
    `<div class="k">Net P&L after costs &middot; ${scopeLabel()}</div>
     <div class="v ${cls(c.netPreTax)}">${money(c.netPreTax)}</div>
     <div class="sub">${c.n} trades &middot; ${c.months} month${c.months===1?'':'s'} of subscriptions &middot; gross ${money(c.gross)}</div>
     <div class="tax">After 1256 tax (${(c.tEff*100).toFixed(1)}%): ${money(c.afterTax)} &nbsp;&middot;&nbsp; break-even ${money(bePer)}/trade</div>`;

  const row=(l,v,cl='')=>`<div class="crow ${cl}"><span class="cl">${l}</span><span class="cv">${v}</span></div>`;
  rowsEl.innerHTML=
     row('Gross P&L', `<span class="${cls(c.gross)}">${money(c.gross)}</span>`)
    +row('Commissions (all-in)', `<span class="neg">${money(-c.totalComm)}</span>`)
    +row('Subscriptions ('+money(c.fixedMo)+'/mo &times; '+c.months+')', `<span class="neg">${money(-c.fixedPeriod)}</span>`)
    +row('Net P&L (pre-tax)', `<span class="${cls(c.netPreTax)}">${money(c.netPreTax)}</span>`,'tot')
    +`<div class="csub">Tax — Section 1256</div>`
    +row('State top rate', stateRate().toFixed(2)+'%','sub')
    +row('Blended 1256 rate', (c.tEff*100).toFixed(1)+'%','sub')
    +row('Est. 1256 tax (net profit only)', `<span class="neg">${money(-c.tax)}</span>`,'sub')
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
/* In STAGING, filters apply to the performance graph ONLY — the calendar, cards, cost,
   and stats always use the full (unfiltered) dataset. Elsewhere filters apply to all. */
function graphBase(){ return applyFilters(TRADES); }
function baseTrades(){ return STAGING_PAGE ? TRADES.slice() : applyFilters(TRADES); }

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
/* Metrics the performance graph should draw — filtered in staging, scoped elsewhere. */
function curveMetrics(){ return STAGING_PAGE ? activeGraphMetrics() : activeMetrics(); }
function renderDash(){
  if(!METRICS_ALL) return;
  const m=activeMetrics();
  renderCards(m); renderAdv(m); renderCalc(m);
  renderCurve(STAGING_PAGE ? activeGraphMetrics() : m);
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

/* ============================================================
   CSV staging → parse/detect → import
   ------------------------------------------------------------
   A picked file is parsed and held in PENDING (not committed). The user
   confirms the auto-detected Platform, then commits: landing → enter the
   app; manage panel → merge into the existing data. The Platform choice is
   per-upload only — after import, the dropdown resets.
   ============================================================ */
let PENDING=null;      // { ctx:'landing'|'manage', rawText, name, result }
let FILE_CTX='landing';

const stageEls=ctx=> ctx==='manage'
  ? { sel:$('dm_platform'), status:$('dm_parsestatus'), btn:$('dm_import') }
  : { sel:$('c_platform'),  status:$('landingStatus'),  btn:$('startBtn') };

function isCsvFile(file){
  if(!file) return false;
  // require a .csv extension or an explicit CSV mime type (exports always have one)
  return /\.csv$/i.test(file.name) || /csv/i.test(file.type||'');
}
function setStageStatus(ctx,msg,kind){
  const {status}=stageEls(ctx); if(!status) return;
  status.textContent=msg||''; status.className='parsestatus'+(kind?' '+kind:'');
}
function resetStage(ctx){
  if(PENDING && PENDING.ctx===ctx) PENDING=null;
  const {sel,btn}=stageEls(ctx);
  if(sel) sel.value='';
  if(btn) btn.disabled=true;
  setStageStatus(ctx,'');
  const f=$('file'); if(f) f.value='';
}
function stageFile(file,ctx){
  if(!isCsvFile(file)){ setStageStatus(ctx,'Please choose a .csv file.','err'); return; }
  const r=new FileReader();
  r.onerror=()=>setStageStatus(ctx,'Could not read that file.','err');
  r.onload=()=>stageText(String(r.result||''), file.name, ctx);
  r.readAsText(file);
}
function stageText(text,name,ctx){
  PENDING={ctx,rawText:text,name};
  reparseStage(ctx, /*isAuto*/true);
}
function reparseStage(ctx,isAuto){
  if(!PENDING || PENDING.ctx!==ctx){ return; }
  const {sel}=stageEls(ctx);
  const override = sel ? sel.value : '';
  let r;
  try{ r=Adapters.parse(PENDING.rawText, override||undefined); }
  catch(e){ r={ok:false,error:'Could not read that file.'}; }
  PENDING.result=r;
  if(r.ok && isAuto && !override && sel) sel.value=r.platform;   // reflect the auto-detected platform
  applyStageUI(ctx);
}
/* Update the status line + commit button from the current PENDING result.
   On the landing, Start Blotterbook also requires broker/feed/state to be chosen
   (Load CSV itself is never gated). */
function applyStageUI(ctx){
  const {btn}=stageEls(ctx);
  const r=(PENDING && PENDING.ctx===ctx)?PENDING.result:null;
  if(!r){ setStageStatus(ctx,''); if(btn) btn.disabled=true; return; }
  if(!r.ok){ setStageStatus(ctx, r.error||'Could not parse this file.', 'err'); if(btn) btn.disabled=true; return; }
  const n=r.trades.length, beta=r.beta?' (beta — verify the numbers)':'';
  const base=`Detected ${r.label}${beta} · ${n} trade${n===1?'':'s'}`;
  if(ctx==='landing' && !gateOk()){
    setStageStatus(ctx, `${base} — choose broker, data feed & state to start`, 'ok');
    if(btn) btn.disabled=true;
  } else {
    setStageStatus(ctx, `${base} ready to import`, 'ok');
    if(btn) btn.disabled=false;
  }
}
function onPlatformChange(ctx){ reparseStage(ctx,/*isAuto*/false); }

async function commitPending(ctx){
  if(!PENDING || PENDING.ctx!==ctx || !PENDING.result || !PENDING.result.ok) return;
  const trades=PENDING.result.trades, name=PENDING.name;
  DEMO_MODE=false;
  let metaHtml;
  if(Store.available()){
    const {added,duplicate,total}=await Store.addTrades(trades);
    TRADES=await Store.getAllTrades();
    JOURNAL_DATES=await Store.journalDates();
    await loadTradeMeta();
    metaHtml=`<b>${total}</b> trades &nbsp;·&nbsp; +${added} new · ${duplicate} dup &nbsp;·&nbsp; ${TRADES[0].date} → ${TRADES[TRADES.length-1].date}`;
  } else {
    TRADES=trades;
    metaHtml=`<b>${TRADES.length}</b> trades &nbsp;·&nbsp; ${TRADES[0].date} → ${TRADES[TRADES.length-1].date}`;
  }
  logAction('CSV imported · '+(name||'file')+' · now '+TRADES.length+' trades');
  const manage = ctx==='manage';
  resetStage(ctx);                       // clear the staging UI + platform select (per-upload only)
  if(manage){
    await reloadFromStore();
    renderDataManager();
  } else {
    renderLoaded(name, metaHtml);        // enter the populated app
  }
}

function platformOptionsHtml(){
  return '<option value="">Auto-detect</option>'
    + Adapters.list().map(a=>`<option value="${a.id}">${a.label}${a.beta?' (beta)':''}</option>`).join('');
}
function initPlatformSelects(){
  const html=platformOptionsHtml();
  ['c_platform','dm_platform'].forEach(id=>{ const el=$(id); if(el) el.innerHTML=html; });
}

/* ============================================================
   Demo dataset (deterministic, generated — no external file)
   ============================================================ */
function demoCSV(){
  let seed=246813579; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  const syms=['MESM2025','MESM2025','MESM2025','MNQM2025','MNQM2025','MCLN2025'];
  const rows=[['Time','Action','Realized PnL (value)']];
  const start=new Date(2024,6,1), end=new Date(2026,5,30);   // two years: Jul 1 2024 → Jun 30 2026
  for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
    const dow=d.getDay(); if(dow===0||dow===6) continue;       // weekdays only
    if(rnd()<0.15) continue;                                    // a few days flat/off
    const nt=2+Math.floor(rnd()*4);                             // 2–5 trades/day
    for(let i=0;i<nt;i++){
      const sym=syms[Math.floor(rnd()*syms.length)];
      const side=rnd()<0.5?'long':'short';
      const base=sym.startsWith('MNQ')?14:sym.startsWith('MCL')?11:8;
      // positive expectancy: ~58% winners, winners larger than losers → a profitable month
      const win=rnd()<0.58;
      let pnl = win ? base*(3+rnd()*20) : -base*(1.5+rnd()*9);
      pnl=Math.round(pnl*4)/4;                                  // quarter-point ticks
      const hh=pad2(9+Math.floor(rnd()*6)), mm=pad2(Math.floor(rnd()*60));
      const ts=`${fmtDate(d)} ${hh}:${mm}:00`;
      rows.push([ts, `"Close ${side} position for symbol ${sym} at price 100.00"`, String(pnl)]);
    }
  }
  return rows.map(r=>r.join(',')).join('\n');
}
function runDemo(){
  const bs=document.getElementById('c_broker'); bs.value=DEMO_BROKER; populateFeeds(DEMO_BROKER);
  document.getElementById('c_feed').value=DEMO_FEED;
  document.getElementById('c_state_sel').value=DEMO_STATE;
  document.getElementById('c_tv').value=35;
  updateGate();
  // demo data is in-memory only — it never touches local storage
  DEMO_MODE=true;
  const dr=Adapters.parse(demoCSV(),'tradingview');
  TRADES=dr.ok?dr.trades:[];
  // no source label on the demo (the DEMO badge already says it); just the meta
  renderLoaded('', `<b>${TRADES.length}</b> trades &nbsp;·&nbsp; sample data, not saved`);
}

/* ============================================================
   Filters
   ============================================================ */
function onFiltersChanged(){
  if(!TRADES.length){ updateFilterCount(); return; }
  if(STAGING_PAGE){
    // filters only re-render the performance graph; dashboard/calendar stay full
    updateFilterCount();
    if(METRICS_ALL) renderCurve(activeGraphMetrics());
    return;
  }
  METRICS_ALL=compute(baseTrades());
  updateFilterCount();
  renderCalendar();
  renderDash();
}
function updateFilterCount(){
  const el=document.getElementById('f_count'); if(!el) return;
  const base = STAGING_PAGE ? graphBase() : baseTrades();
  el.textContent = filtersActive() ? `${base.length} / ${TRADES.length} trades` : `${TRADES.length} trades`;
}
function syncFilterOptions(){
  const sel=document.getElementById('f_symbol'); const cur=sel.value;
  const roots=[...new Set(TRADES.map(t=>t.root))].sort();
  sel.innerHTML='<option value="">All</option>'+roots.map(r=>`<option value="${r}">${r}</option>`).join('');
  sel.value = roots.includes(cur)?cur:''; FILTERS.symbol=sel.value;
  syncTagFilter();
  updateFilterCount();
}
/* Populate the Tag filter from every tag in use; hide the field when none exist. */
function allTags(){
  const s=new Set(); for(const m of TRADE_META.values()) (m.tags||[]).forEach(t=>s.add(t));
  return [...s].sort();
}
function syncTagFilter(){
  const sel=document.getElementById('f_tag'); if(!sel) return;
  const tags=allTags(); const cur=sel.value;
  const fld=sel.closest('.fld'); if(fld) fld.style.display = tags.length? '' : 'none';
  sel.innerHTML='<option value="">All</option>'+tags.map(t=>`<option value="${t}">${t}</option>`).join('');
  if(tags.includes(cur)) sel.value=cur; else { sel.value=''; FILTERS.tag=''; }
}
function resetFilters(){
  FILTERS.from=FILTERS.to=FILTERS.symbol=FILTERS.side=FILTERS.session=FILTERS.tag=''; FILTERS.dows.clear();
  ['f_from','f_to','f_symbol','f_side','f_session','f_tag','f_saved'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  document.querySelectorAll('#f_dows button.on').forEach(b=>b.classList.remove('on'));
  onFiltersChanged();
}
function initFilters(){
  const dows=document.getElementById('f_dows');
  dows.innerHTML=DOW_LABEL.map((d,i)=>`<button type="button" data-d="${i}" title="${d}">${d[0]}</button>`).join('');
  dows.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return;
    const d=+b.dataset.d; if(FILTERS.dows.has(d)) FILTERS.dows.delete(d); else FILTERS.dows.add(d);
    b.classList.toggle('on'); onFiltersChanged(); });
  const bind=(id,key)=>{ const el=document.getElementById(id); if(el) el.addEventListener('change',e=>{ FILTERS[key]=e.target.value; onFiltersChanged(); }); };
  bind('f_from','from'); bind('f_to','to'); bind('f_symbol','symbol'); bind('f_side','side'); bind('f_session','session'); bind('f_tag','tag');
  document.getElementById('f_reset').addEventListener('click',resetFilters);
  // saved filters (staging — controls only exist there)
  on('f_save','click',saveCurrentFilter);
  on('f_saved','change',e=>{ const s=SAVED_FILTERS.find(x=>x.id===e.target.value); if(s) applyFilterObj(s.f); });
}

/* ---- saved filters (name, recall, manage) — staging-only UI ---- */
let SAVED_FILTERS=[];
async function loadSavedFilters(){
  if(!Store.available()){ SAVED_FILTERS=[]; return; }
  try{ SAVED_FILTERS=(await Store.getMeta('savedFilters'))||[]; }catch(_){ SAVED_FILTERS=[]; }
  syncSavedFilterSelect();
}
async function persistSavedFilters(){ if(Store.available()){ try{ await Store.setMeta('savedFilters', SAVED_FILTERS); }catch(_){} } }
function currentFilterObj(){ return { from:FILTERS.from, to:FILTERS.to, symbol:FILTERS.symbol, side:FILTERS.side, session:FILTERS.session, tag:FILTERS.tag, dows:[...FILTERS.dows] }; }
function syncSavedFilterSelect(){
  const sel=$('f_saved'); if(!sel) return; const cur=sel.value;
  sel.innerHTML='<option value="">— Saved filters —</option>'+SAVED_FILTERS.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  sel.value=SAVED_FILTERS.some(s=>s.id===cur)?cur:'';
}
function applyFilterObj(f){
  FILTERS.from=f.from||''; FILTERS.to=f.to||''; FILTERS.symbol=f.symbol||''; FILTERS.side=f.side||''; FILTERS.session=f.session||''; FILTERS.tag=f.tag||'';
  FILTERS.dows=new Set(f.dows||[]);
  const setv=(id,v)=>{ const e=$(id); if(e) e.value=v||''; };
  setv('f_from',FILTERS.from); setv('f_to',FILTERS.to); setv('f_symbol',FILTERS.symbol); setv('f_side',FILTERS.side); setv('f_session',FILTERS.session); setv('f_tag',FILTERS.tag);
  document.querySelectorAll('#f_dows button').forEach(b=>b.classList.toggle('on', FILTERS.dows.has(+b.dataset.d)));
  onFiltersChanged();
}
async function saveCurrentFilter(){
  const name=(prompt('Name this filter:')||'').trim(); if(!name) return;
  SAVED_FILTERS.push({ id:Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36), name, f:currentFilterObj() });
  await persistSavedFilters(); syncSavedFilterSelect();
}
async function deleteSavedFilter(id){ SAVED_FILTERS=SAVED_FILTERS.filter(s=>s.id!==id); await persistSavedFilters(); syncSavedFilterSelect(); }
async function renameSavedFilter(id){ const s=SAVED_FILTERS.find(x=>x.id===id); if(!s) return;
  const n=(prompt('Rename filter:', s.name)||'').trim(); if(!n) return; s.name=n; await persistSavedFilters(); syncSavedFilterSelect(); }

/* ============================================================
   Day-notes / journal (per-day, click a calendar day)
   ============================================================ */
let jSaveTimer=null;
async function selectDay(d){
  selectedDate = (selectedDate===d)? null : d;
  document.querySelectorAll('#cal .cell.selday').forEach(c=>c.classList.remove('selday'));
  if(selectedDate){ const cell=document.querySelector(`#cal .cell[data-date="${selectedDate}"]`); if(cell) cell.classList.add('selday'); }
  await updateJournalEditor();
  if(METRICS_ALL) renderCurve(curveMetrics());
}
/* Jump the calendar to the most recent month that has data ("present"). */
function jumpToLatest(){
  if(!METRICS_ALL || METRICS_ALL.lastDate==='—') return;
  const [yy,mm]=METRICS_ALL.lastDate.split('-').map(Number);
  calYear=yy; calMonth=mm-1;
  renderCalendar();
  if(SCOPE==='month') renderDash();
}
/* Clicking the performance graph selects that date and jumps the calendar to its month. */
function selectFromGraph(d){
  if(!d || !METRICS_ALL) return;
  selectedDate=d;
  const [yy,mm]=d.split('-').map(Number); calYear=yy; calMonth=mm-1;
  renderCalendar();
  renderDash();             // re-renders the curve marker + cards, respecting scope
  updateJournalEditor();
}
async function updateJournalEditor(){
  const ta=document.getElementById('j_text'), label=document.getElementById('j_date'),
        hint=document.getElementById('j_hint'), stat=document.getElementById('j_stat');
  if(!ta) return;
  if(!selectedDate || DEMO_MODE || !Store.available()){
    ta.value=''; ta.disabled=true; label.textContent='Day notes'; stat.textContent='';
    hint.style.display=''; hint.textContent = DEMO_MODE ? 'Day-notes are disabled for the demo dataset.'
      : 'Click a day on the calendar to add or read notes for that date. Notes are saved in this browser.';
    return;
  }
  hint.style.display='none'; ta.disabled=false; label.textContent='Notes — '+selectedDate;
  ta.value=await Store.getJournal(selectedDate);
  stat.textContent = ta.value ? 'saved' : '';
}
function wireJournal(){
  const ta=document.getElementById('j_text'); if(!ta) return;
  const save=async()=>{ if(!selectedDate||DEMO_MODE||!Store.available()) return;
    await Store.saveJournal(selectedDate, ta.value);
    JOURNAL_DATES=await Store.journalDates();
    document.getElementById('j_stat').textContent = ta.value.trim()?'saved':'';
    const cell=document.querySelector(`#cal .cell[data-date="${selectedDate}"]`);
    if(cell) cell.classList.toggle('hasnote', JOURNAL_DATES.has(selectedDate));
    logAction('Day note saved · '+selectedDate);
    if(STAGING_PAGE && METRICS_ALL) renderCurve(curveMetrics());   // refresh note dots on the graph
  };
  ta.addEventListener('input',()=>{ clearTimeout(jSaveTimer); jSaveTimer=setTimeout(save,500); });
  ta.addEventListener('blur',()=>{ clearTimeout(jSaveTimer); save(); });
}

/* ============================================================
   Session restore (setup selections + persisted trades)
   ============================================================ */
async function persistSetup(){
  if(PAGE_MODE==='demo' || !Store.available()) return;   // demo is in-memory; staging persists to its own DB
  try{ await Store.setMeta('setup',{
    broker:document.getElementById('c_broker').value,
    feed:document.getElementById('c_feed').value,
    state:document.getElementById('c_state_sel').value,
    platform:document.getElementById('c_tv').value
  }); }catch(e){}
}
async function restoreSession(){
  const s=await Store.getMeta('setup');
  if(s){
    const bSel=document.getElementById('c_broker');
    if(s.broker && BROKERS[s.broker]){ bSel.value=s.broker; populateFeeds(s.broker); }
    if(s.feed){ const fSel=document.getElementById('c_feed'); fSel.value=s.feed; }
    if(s.state) document.getElementById('c_state_sel').value=s.state;
    if(s.platform!=null && s.platform!=='') document.getElementById('c_tv').value=s.platform;
    updateGate();
  }
  JOURNAL_DATES=await Store.journalDates();
  await loadTradeMeta();
  await loadSavedFilters();
  const all=await Store.getAllTrades();
  if(all.length){
    TRADES=all;
    renderLoaded('saved data', `<b>${all.length}</b> trades &nbsp;·&nbsp; ${all[0].date} → ${all[all.length-1].date} &nbsp;·&nbsp; <span style="color:var(--dim)">restored from this browser</span>`);
  } else {
    resetApp();
  }
  autoSelectState();   // fire-and-forget; no-ops if a state is already chosen
}

/* Pre-select the US state for the tax model from the visitor's coarse region
   (Cloudflare edge geo via /api/geo). Convenience only — never overrides a
   chosen/saved state, and silently does nothing off-Cloudflare or outside the US. */
async function autoSelectState(){
  const sel=$('c_state_sel'); if(!sel || sel.value) return;
  try{
    const r=await fetch('/api/geo',{cache:'no-store'}); if(!r.ok) return;
    const g=await r.json();
    if(g.country && g.country!=='US') return;
    const code=(g.regionCode||'').toUpperCase();
    if(code && !sel.value && [...sel.options].some(o=>o.value===code)){
      sel.value=code; updateGate(); recalc(); persistSetup();
    }
  }catch(_){}
}

/* ============================================================
   Setup controls: brokers, feeds, states + gating
   (broker / feed / state lists come from /data/*.json via loadRefData)
   ============================================================ */
function populateFeeds(brokerKey){
  const fSel=document.getElementById('c_feed');
  const feeds=BROKER_FEEDS[brokerKey]||BROKER_FEEDS.AMP||{};
  let h='<option value="">— Select data feed —</option>';
  for(const grp in feeds){
    h+=`<optgroup label="${grp}">`;
    for(const [name,cost] of feeds[grp])
      h+=`<option value="${name}|${cost}" data-cost="${cost}">${name} — $${cost}</option>`;
    h+='</optgroup>';
  }
  fSel.innerHTML=h;
}
function gateOk(){ return !!($('c_broker').value && $('c_feed').value && $('c_state_sel').value); }
function updateGate(){
  // Load CSV is always available — a CSV can be parsed without cost settings.
  // The Broker/Feed/State requirement gates the Start Blotterbook button instead.
  const inp=$('file'); if(inp) inp.disabled=false;
  const lbl=$('loadlbl'); if(lbl) lbl.classList.remove('disabled');
  const sbtn=$('setupLoad'); if(sbtn){ sbtn.disabled=false; sbtn.classList.remove('disabled');
    sbtn.title='Load a CSV exported from your trading platform'; }
  if(PENDING && PENDING.ctx==='landing') applyStageUI('landing');   // re-evaluate Start vs. the gate
}
function recalc(){ if(METRICS_ALL) renderDash(); }
function initSetup(){
  const bSel=document.getElementById('c_broker');
  bSel.innerHTML='<option value="">— Select broker —</option>'
    +BROKER_ORDER.map(k=>`<option value="${k}">${BROKERS[k].name}</option>`).join('');
  bSel.addEventListener('change',()=>{ populateFeeds(bSel.value||'AMP'); updateGate(); recalc(); persistSetup(); });

  populateFeeds('AMP');
  document.getElementById('c_feed').addEventListener('change',()=>{ updateGate(); recalc(); persistSetup(); });

  const sSel=document.getElementById('c_state_sel');
  sSel.innerHTML='<option value="">— Select state —</option>'
    +STATES.slice().sort((a,b)=>a[2]<b[2]?-1:1).map(([a,r,n])=>`<option value="${a}" data-rate="${r}">${n}</option>`).join('');
  sSel.addEventListener('change',()=>{ updateGate(); recalc(); persistSetup(); });

  document.getElementById('c_tv').addEventListener('input',()=>{ recalc(); persistSetup(); });
  updateGate();
}

/* ============================================================
   Collapsible + drag-to-reorder panels (persisted)
   ============================================================ */
const LS_ORDER='tj_order', LS_COLLAPSE='tj_collapsed';
function saveOrder(){
  const ord=[...document.querySelectorAll('#dash .panel')].map(p=>p.dataset.key);
  try{ localStorage.setItem(LS_ORDER,JSON.stringify(ord)); }catch(e){}
}
function saveCollapsed(){
  const col={};
  document.querySelectorAll('#dash .panel').forEach(p=>{ if(p.classList.contains('collapsed'))col[p.dataset.key]=1; });
  try{ localStorage.setItem(LS_COLLAPSE,JSON.stringify(col)); }catch(e){}
}
function panelAfter(dash,y){
  const els=[...dash.querySelectorAll('.panel:not(.dragging)')];
  let closest=null, off=-Infinity;
  for(const el of els){ const b=el.getBoundingClientRect(); const d=y-b.top-b.height/2;
    if(d<0 && d>off){ off=d; closest=el; } }
  return closest;
}
function initPanels(){
  const dash=document.getElementById('dash');
  try{ const ord=JSON.parse(localStorage.getItem(LS_ORDER)||'null');
    if(Array.isArray(ord)) ord.forEach(k=>{ const el=dash.querySelector(`.panel[data-key="${k}"]`); if(el)dash.appendChild(el); });
  }catch(e){}
  let col={}; try{ col=JSON.parse(localStorage.getItem(LS_COLLAPSE)||'{}')||{}; }catch(e){}
  dash.querySelectorAll('.panel').forEach(p=>{
    if(col[p.dataset.key]) p.classList.add('collapsed');
    const head=p.querySelector('.phead'), grip=p.querySelector('.grip');
    head.addEventListener('click',e=>{ if(e.target.closest('.grip'))return;
      p.classList.toggle('collapsed'); saveCollapsed(); });
    grip.addEventListener('mousedown',()=>p.setAttribute('draggable','true'));
    grip.addEventListener('mouseup',()=>p.removeAttribute('draggable'));
    p.addEventListener('dragstart',e=>{ p.classList.add('dragging'); e.dataTransfer.effectAllowed='move';
      try{ e.dataTransfer.setData('text/plain',p.dataset.key); }catch(_){} });
    p.addEventListener('dragend',()=>{ p.classList.remove('dragging'); p.removeAttribute('draggable'); saveOrder(); });
  });
  dash.addEventListener('dragover',e=>{
    e.preventDefault();
    const dragging=dash.querySelector('.panel.dragging'); if(!dragging)return;
    const after=panelAfter(dash,e.clientY);
    if(after==null) dash.appendChild(dragging); else dash.insertBefore(dragging,after);
  });
}

/* ============================================================
   Staging-only flair: activity terminal, session-status pill,
   and save/load/revert workspace templates. logAction() is a no-op
   on the main app and demo (those pages have no terminal element),
   so it is safe to call from shared code paths.
   ============================================================ */
const WS_KEY='tj_ws_templates';
const DEFAULT_DASH_ORDER=['perf','cal','cost','adv','defs','term'];
function logAction(msg, kind){
  const win=document.getElementById('termwin'); if(!win) return;   // staging only
  const line=document.createElement('div');
  line.className='tl'+(kind?(' evt-'+kind):'');
  const ts=document.createElement('span'); ts.className='ts'; ts.textContent=new Date().toTimeString().slice(0,8)+'  ';
  const tm=document.createElement('span'); tm.className='tm'; tm.textContent=msg;
  line.appendChild(ts); line.appendChild(tm);
  win.appendChild(line);
  while(win.children.length>200) win.removeChild(win.firstChild);
  win.scrollTop=win.scrollHeight;
}
function setSession(state){   // 'online' | 'offline' | 'degraded'
  const pill=document.getElementById('sesspill'); if(!pill) return;
  pill.classList.remove('online','offline','degraded'); pill.classList.add(state);
  const txt=pill.querySelector('.sesstxt');
  if(txt) txt.textContent={online:'Online',offline:'Offline',degraded:'Degraded'}[state]||'Session';
}
function currentWorkspace(){
  const order=[...document.querySelectorAll('#dash .panel')].map(p=>p.dataset.key);
  const collapsed={}; document.querySelectorAll('#dash .panel.collapsed').forEach(p=>collapsed[p.dataset.key]=1);
  return { order, collapsed };
}
function applyWorkspace(tpl){
  const dash=document.getElementById('dash'); if(!dash||!tpl) return;
  (tpl.order||DEFAULT_DASH_ORDER).forEach(k=>{ const el=dash.querySelector(`.panel[data-key="${k}"]`); if(el) dash.appendChild(el); });
  const col=tpl.collapsed||{};
  dash.querySelectorAll('.panel').forEach(p=>p.classList.toggle('collapsed', !!col[p.dataset.key]));
  saveOrder(); saveCollapsed();
  if(METRICS_ALL) renderCurve(curveMetrics());
}
function readWsTemplates(){ try{ return JSON.parse(localStorage.getItem(WS_KEY)||'{}')||{}; }catch(e){ return {}; } }
function writeWsTemplates(o){ try{ localStorage.setItem(WS_KEY,JSON.stringify(o)); }catch(e){} }
function refreshWsSelect(sel){
  const el=document.getElementById('ws_tpl'); if(!el) return;
  const tpls=readWsTemplates();
  el.innerHTML='<option value="">— Workspace —</option>'
    + Object.keys(tpls).map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if(sel) el.value=sel;
}
function initStaging(){
  if(!STAGING_PAGE) return;
  // session pill: state follows connectivity; click toggles the legend popup
  setSession(navigator.onLine===false ? 'offline' : 'online');
  window.addEventListener('online', ()=>{ setSession('online'); logAction('Connection restored'); });
  window.addEventListener('offline',()=>{ setSession('offline'); logAction('Connection lost — working offline','warn'); });
  const pill=document.getElementById('sesspill'), pop=document.getElementById('sesspop');
  if(pill && pop){
    pill.addEventListener('click',e=>{ e.stopPropagation();
      const willOpen=pop.hasAttribute('hidden');
      pop.toggleAttribute('hidden', !willOpen);
      pill.setAttribute('aria-expanded', willOpen?'true':'false'); });
    document.addEventListener('click',e=>{ if(!pop.hasAttribute('hidden') && !pill.contains(e.target) && !pop.contains(e.target)){
      pop.setAttribute('hidden',''); pill.setAttribute('aria-expanded','false'); } });
  }
  // workspace templates
  refreshWsSelect();
  on('ws_save','click',()=>{ const name=(prompt('Name this workspace layout:')||'').trim(); if(!name) return;
    const t=readWsTemplates(); t[name]=currentWorkspace(); writeWsTemplates(t); refreshWsSelect(name);
    logAction('Workspace template saved · '+name); });
  on('ws_tpl','change',e=>{ const n=e.target.value; if(!n) return; const t=readWsTemplates()[n];
    if(t){ applyWorkspace(t); logAction('Workspace template loaded · '+n); } });
  on('ws_default','click',()=>{ try{ localStorage.removeItem(LS_ORDER); localStorage.removeItem(LS_COLLAPSE); }catch(e){}
    applyWorkspace({ order:DEFAULT_DASH_ORDER, collapsed:{} });
    const el=document.getElementById('ws_tpl'); if(el) el.value='';
    logAction('Layout reverted to default'); });
  logAction('Staging session ready · v0.13');
}

/* ============================================================
   Helpers — file download, current setup labels
   ============================================================ */
function downloadFile(name, text, type='application/json'){
  const blob=new Blob([text],{type}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}
function stateLabel(){ const o=$('c_state_sel'); return (o&&o.selectedOptions[0])?o.selectedOptions[0].textContent:'—'; }

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
    `<tr><td>${s.root}${s.known?'':' *'}</td><td class="num">${s.count}</td>
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

/* ============================================================
   Data manager — edit & manage locally stored data
   ============================================================ */
let DM_SEARCH='';
function openDataManager(){
  const demo = PAGE_MODE==='demo';
  if(!demo && !Store.available()){ alert('Local storage is not available in this browser.'); return; }
  const ov=$('dataModal'); if(!ov) return;
  ov.classList.add('open'); document.body.style.overflow='hidden';
  if(!demo) resetStage('manage');   // platform select returns to "Auto-detect" each time it's opened
  renderDataManager();
}
function closeDataManager(){ const ov=$('dataModal'); if(ov) ov.classList.remove('open'); document.body.style.overflow=''; }

const esc=s=>(s||'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
async function renderDataManager(){
  // each section renders independently so one failure can't blank the rest
  const demo = PAGE_MODE==='demo';   // demo is in-memory: read TRADES, never touch the Store
  let trades=[], notes=[];
  if(demo){ trades=TRADES.slice(); }
  else {
    try{ trades=await Store.getAllTrades(); }catch(e){ console.error('getAllTrades', e); }
    try{ notes=await Store.getAllJournal(); }catch(e){ console.error('getAllJournal', e); }
  }

  // Overview
  const range = trades.length ? `${trades[0].date} → ${trades[trades.length-1].date}` : '—';
  let kb='—';
  if(demo){ try{ kb=(new Blob([JSON.stringify(trades)]).size/1024).toFixed(1)+' KB'; }catch(e){} }
  else { try{ kb=(new Blob([JSON.stringify(await Store.exportAll())]).size/1024).toFixed(1)+' KB'; }catch(e){ console.error('size', e); } }
  if($('dm_summary')) $('dm_summary').innerHTML=
     `<div class="dmstat"><div class="dk">Trades</div><div class="dv">${trades.length}</div></div>`
    +`<div class="dmstat"><div class="dk">Date range</div><div class="dv mono">${range}</div></div>`
    +`<div class="dmstat"><div class="dk">Day notes</div><div class="dv">${notes.length}</div></div>`
    +`<div class="dmstat"><div class="dk">Tagged trades</div><div class="dv">${TRADE_META.size}</div></div>`
    +`<div class="dmstat"><div class="dk">Local size</div><div class="dv mono">${kb}</div></div>`;

  // Notes
  if($('dm_notes')) $('dm_notes').innerHTML = notes.length
    ? notes.map(j=>`<div class="dmrow"><span class="mono dmdate">${j.date}</span>
        <span class="dmnote">${esc(j.text).slice(0,120)}</span>
        <button class="dmdel" data-note="${j.date}" title="Delete this note">Delete</button></div>`).join('')
    : '<div class="dmempty">No day notes saved.</div>';

  // Per-trade editor (tags / note / screenshots)
  renderTradeEditor();

  // Trades (filterable)
  const q=DM_SEARCH.trim().toLowerCase();
  const shown=q? trades.filter(t=>t.root.toLowerCase().includes(q)||t.date.includes(q)||(t.side||'').includes(q)) : trades;
  if($('dm_tcount')) $('dm_tcount').textContent = q? `${shown.length} / ${trades.length}` : `${trades.length}`;
  if($('dm_trades')) $('dm_trades').innerHTML = shown.length
    ? (demo
        ? shown.slice().reverse().map(t=>`<tr><td class="mono">${t.date}</td><td>${t.root}</td>
            <td>${t.side||'—'}</td><td class="num mono ${cls(t.pnl)}">${usd(t.pnl)}</td></tr>`).join('')
        : shown.slice().reverse().map(t=>{ const id=Store.tradeId(t);
            return `<tr><td class="mono">${t.date}</td><td>${t.root}</td>
            <td>${t.side||'—'}${metaChips(TRADE_META.get(id))}</td><td class="num mono ${cls(t.pnl)}">${usd(t.pnl)}</td>
            <td class="dmrowact"><button class="dmdel alt" data-edit="${id}" title="Tags, note & screenshots">Edit</button>
            <button class="dmdel" data-trade="${id}" title="Delete this trade">Delete</button></td></tr>`; }).join(''))
    : `<tr><td colspan="${demo?4:5}" class="dmempty">No matching trades.</td></tr>`;

  // Saved filters (staging — section only exists there)
  if($('dm_filters')) $('dm_filters').innerHTML = SAVED_FILTERS.length
    ? SAVED_FILTERS.map(s=>`<div class="dmrow"><span class="dmnote">${esc(s.name)}</span>
        <button class="dmdel alt" data-filterapply="${s.id}" title="Apply this filter">Apply</button>
        <button class="dmdel" data-filterrename="${s.id}" title="Rename">Rename</button>
        <button class="dmdel" data-filterdel="${s.id}" title="Delete">Delete</button></div>`).join('')
    : '<div class="dmempty">No saved filters yet — set filters and click “Save filter”.</div>';
}

/* compact tag chips + note/image markers shown on a trade row */
function metaChips(m){
  if(!m) return '';
  let s=' '+(m.tags||[]).map(t=>`<span class="dmtag">${esc(t)}</span>`).join('');
  const extra=[]; if(m.note) extra.push('note'); if((m.shots||[]).length) extra.push(m.shots.length+' img');
  if(extra.length) s+=`<span class="dmmark">${extra.join(' · ')}</span>`;
  return s;
}

/* ---- per-trade editor ---- */
let DM_EDIT=null;
function renderTradeEditor(){
  const box=$('dm_editor'); if(!box) return;
  if(!DM_EDIT){ box.innerHTML=''; box.style.display='none'; return; }
  box.style.display='';
  const e=DM_EDIT, t=e.trade;
  box.innerHTML=
   `<div class="dmeditcard">
      <div class="dmedit-head"><b>${t.date} · ${t.root} ${t.side||''}</b>
        <span class="mono ${cls(t.pnl)}">${usd(t.pnl)}</span>
        <button class="dmx" data-editclose title="Close">&times;</button></div>
      <label class="dmlbl" for="dm_tags">Tags <span class="dmsublbl">comma-separated</span></label>
      <input id="dm_tags" class="dminput" value="${esc(e.tags.join(', '))}" placeholder="breakout, A+, fomo">
      <label class="dmlbl" for="dm_note">Note</label>
      <textarea id="dm_note" class="dmtextarea" placeholder="What happened on this trade?">${esc(e.note)}</textarea>
      <label class="dmlbl">Screenshots</label>
      <div class="dmshots">
        ${e.shots.map((s,i)=>`<div class="dmshot"><img src="${s}" alt="screenshot ${i+1}"><button data-rmshot="${i}" title="Remove">&times;</button></div>`).join('')}
        <label class="dmaddshot">+ Add image<input type="file" accept="image/*" id="dm_shotinput" hidden></label>
      </div>
      <div class="dmedit-actions"><button class="dmbtn" data-editsave>Save</button>
        <button class="dmdel" data-editclear title="Remove all metadata for this trade">Clear</button>
        <span class="dmhint" id="dm_editmsg">${e._msg||''}</span></div>
    </div>`;
}
async function dmOpenTradeEditor(id){
  let trades=[]; try{ trades=await Store.getAllTrades(); }catch(_){}
  const trade=trades.find(t=>Store.tradeId(t)===id) || {date:'?',root:'?',side:'',pnl:0};
  const m=await Store.getTradeMeta(id);
  DM_EDIT={ id, trade, tags:(m.tags||[]).slice(), note:m.note||'', shots:(m.shots||[]).slice(), _msg:'' };
  renderTradeEditor();
  const box=$('dm_editor'); if(box) box.scrollIntoView({block:'nearest'});
}
function dmCaptureEdit(){
  if(!DM_EDIT) return;
  const tg=$('dm_tags'), nt=$('dm_note');
  if(tg) DM_EDIT.tags=[...new Set(tg.value.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean))];
  if(nt) DM_EDIT.note=nt.value;
}
function dmAddShot(file){
  if(!DM_EDIT || !file) return;
  if(!/^image\//.test(file.type||'')){ alert('Please choose an image file.'); return; }
  if(file.size>4*1024*1024 && !confirm('That image is over 4MB and will be stored as-is in your browser. Add it anyway?')) return;
  const r=new FileReader();
  r.onload=()=>{ dmCaptureEdit(); DM_EDIT.shots.push(String(r.result)); DM_EDIT._msg=''; renderTradeEditor(); };
  r.onerror=()=>alert('Could not read that image.');
  r.readAsDataURL(file);
}
async function dmSaveEdit(){
  if(!DM_EDIT) return;
  dmCaptureEdit();
  await Store.saveTradeMeta(DM_EDIT.id, { tags:DM_EDIT.tags, note:DM_EDIT.note, shots:DM_EDIT.shots });
  await loadTradeMeta();
  if(METRICS_ALL){ syncTagFilter(); renderDash(); }
  DM_EDIT._msg='Saved'; await renderDataManager();
}
async function dmClearEdit(){
  if(!DM_EDIT) return;
  if(!confirm('Remove all tags, note and screenshots for this trade?')) return;
  await Store.deleteTradeMeta(DM_EDIT.id);
  await loadTradeMeta();
  if(METRICS_ALL){ syncTagFilter(); renderDash(); }
  DM_EDIT=null; await renderDataManager();
}

async function dmDeleteTrade(id){
  await Store.deleteTrade(id);
  await reloadFromStore();
  await renderDataManager();
  logAction('Trade deleted · '+id, 'warn');
}
async function dmDeleteNote(date){
  await Store.deleteJournal(date);
  JOURNAL_DATES=await Store.journalDates();
  if(METRICS_ALL){ renderCalendar(); }
  await renderDataManager();
}
async function dmExport(){
  try{
    const data=await Store.exportAll();
    downloadFile(`blotterbook-backup-${fmtDate(new Date())}.json`, JSON.stringify(data,null,2));
    logAction('Session backup created');
  }catch(e){ console.error('backup export failed', e); alert('Could not create the backup file.'); }
}
async function dmImport(file){
  let data; try{ data=JSON.parse(await file.text()); }
  catch(_){ alert('That file is not valid JSON.'); return; }
  if(!data || (!Array.isArray(data.trades) && !Array.isArray(data.journal))){
    alert('This does not look like a Blotterbook backup.'); return;
  }
  const {added,dup}=await Store.importAll(data);
  await reloadFromStore();
  await renderDataManager();
  alert(`Restore complete — ${added} new trade${added===1?'':'s'} added${dup?`, ${dup} already present`:''}.`);
}

/* Re-pull local data into the live dashboard after edits (keeps the current view). */
async function reloadFromStore(){
  TRADES=await Store.getAllTrades();
  JOURNAL_DATES=await Store.journalDates();
  await loadTradeMeta();
  await loadSavedFilters();
  if(TRADES.length){
    METRICS_ALL=compute(baseTrades());
    syncFilterOptions(); updateJournalEditor(); renderCalendar(); renderDash();
    $('srcmeta').innerHTML=`<b>${TRADES.length}</b> trades &nbsp;·&nbsp; ${TRADES[0].date} → ${TRADES[TRADES.length-1].date} &nbsp;·&nbsp; <span style="color:var(--dim)">local data</span>`;
  } else {
    resetApp();
  }
}

/* ============================================================
   Wiring
   ============================================================ */
const on=(id,ev,fn)=>{ const el=$(id); if(el) el.addEventListener(ev,fn); };

$('prev').onclick=()=>{ if(!METRICS_ALL)return;
  if(--calMonth<0){calMonth=11;calYear--;} renderCalendar(); if(SCOPE==='month') renderDash(); };
$('next').onclick=()=>{ if(!METRICS_ALL)return;
  if(++calMonth>11){calMonth=0;calYear++;} renderCalendar(); if(SCOPE==='month') renderDash(); };
on('caltoday','click',jumpToLatest);
// A picked file is staged (parsed + platform-detected), not loaded immediately.
on('file','change',e=>{ const f=e.target.files[0]; e.target.value=''; if(!f)return; stageFile(f, FILE_CTX); });
on('c_platform','change',()=>onPlatformChange('landing'));
on('dm_platform','change',()=>onPlatformChange('manage'));
on('startBtn','click',()=>commitPending('landing'));
document.querySelectorAll('#scope button').forEach(b=>b.onclick=()=>setScope(b.dataset.s));

/* The demo lives on its own page (demo.html), reached from the homepage.
   On the demo page an "End demo" button returns to the homepage. */
on('endDemoBtn','click',()=>{ try{ window.close(); }catch(_){}
  // window.close() only works for script-opened tabs; navigate to the homepage as a fallback
  setTimeout(()=>{ location.href='../index.html'; }, 60); });

on('exportBtn','click',exportReport);
on('manageBtn','click',openDataManager);
on('setupLoad','click',()=>{ FILE_CTX='landing'; $('file').click(); });
on('setuphead','click',()=>$('setup').classList.toggle('collapsed'));
// The loaded-source text opens the data manager (only once data is loaded).
on('srcname','click',()=>{ if($('dataModal') && document.body.classList.contains('loaded')) openDataManager(); });

// Staging redraws the performance graph on resize so it re-measures its (grid) width.
if(STAGING_PAGE){ let _rsz=null; window.addEventListener('resize',()=>{ clearTimeout(_rsz);
  _rsz=setTimeout(()=>{ if(METRICS_ALL) renderCurve(curveMetrics()); }, 160); }); }

// Performance overlays are toggle buttons — at least one must stay selected.
document.querySelectorAll('.curvebtn').forEach(btn=>btn.addEventListener('click',()=>{
  const k=btn.dataset.k;
  const selected=Object.keys(curveSel).filter(x=>curveSel[x]);
  if(curveSel[k] && selected.length===1) return;   // can't deselect the last overlay
  curveSel[k]=!curveSel[k];
  btn.classList.toggle('on',curveSel[k]);
  if(METRICS_ALL) renderCurve(curveMetrics());
}));

on('cal','click',e=>{
  const cell=e.target.closest('.cell[data-date]'); if(!cell)return;
  selectDay(cell.dataset.date);
});

/* ---- data manager modal controls ---- */
if($('dataModal')){
  on('dm_close','click',closeDataManager);
  $('dataModal').addEventListener('click',e=>{ if(e.target.id==='dataModal') closeDataManager(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDataManager(); });
  on('dm_load','click',()=>{ FILE_CTX='manage'; $('file').click(); });
  on('dm_import','click',()=>commitPending('manage'));
  on('dm_export','click',dmExport);
  on('dm_importBtn','click',()=>$('dm_importFile').click());
  on('dm_importFile','change',e=>{ const f=e.target.files[0]; if(f) dmImport(f); e.target.value=''; });
  on('dm_search','input',e=>{ DM_SEARCH=e.target.value; renderDataManager(); });
  on('dm_clear','click',async()=>{
    if(!confirm('Erase ALL trades, day-notes and per-trade tags/notes saved in this browser? This cannot be undone.')) return;
    await Store.purge(); JOURNAL_DATES=new Set(); TRADE_META=new Map(); DM_EDIT=null; resetApp(); renderDataManager();
    logAction('All local data erased', 'err');
  });
  // delegated row actions: Edit opens the per-trade editor, Delete removes the trade
  on('dm_trades','click',e=>{
    const ed=e.target.closest('button[data-edit]'); if(ed){ dmOpenTradeEditor(ed.dataset.edit); return; }
    const b=e.target.closest('button[data-trade]'); if(b) dmDeleteTrade(b.dataset.trade);
  });
  on('dm_notes','click',e=>{ const b=e.target.closest('button[data-note]');
    if(b && confirm('Delete the note for '+b.dataset.note+'?')) dmDeleteNote(b.dataset.note); });
  // saved-filter controls (staging)
  on('dm_filters','click',e=>{
    const ap=e.target.closest('[data-filterapply]'); if(ap){ const s=SAVED_FILTERS.find(x=>x.id===ap.dataset.filterapply); if(s){ applyFilterObj(s.f); closeDataManager(); } return; }
    const rn=e.target.closest('[data-filterrename]'); if(rn){ renameSavedFilter(rn.dataset.filterrename).then(renderDataManager); return; }
    const dl=e.target.closest('[data-filterdel]'); if(dl){ if(confirm('Delete this saved filter?')) deleteSavedFilter(dl.dataset.filterdel).then(renderDataManager); }
  });
  // per-trade editor controls
  on('dm_editor','click',e=>{
    if(e.target.closest('[data-editclose]')){ DM_EDIT=null; renderTradeEditor(); return; }
    if(e.target.closest('[data-editsave]')){ dmSaveEdit(); return; }
    if(e.target.closest('[data-editclear]')){ dmClearEdit(); return; }
    const rm=e.target.closest('[data-rmshot]'); if(rm){ dmCaptureEdit(); DM_EDIT.shots.splice(+rm.dataset.rmshot,1); DM_EDIT._msg=''; renderTradeEditor(); }
  });
  on('dm_editor','change',e=>{ if(e.target.id==='dm_shotinput'){ const f=e.target.files[0]; if(f) dmAddShot(f); e.target.value=''; } });
}

/* ============================================================
   Boot
   ============================================================ */
(async function boot(){
  try{
    await loadRefData();
  }catch(err){
    console.error('Failed to load reference data', err);
    document.body.classList.remove('loaded');
    document.getElementById('cards').innerHTML='<div class="empty" style="grid-column:1/-1">'
      +'Could not load reference data (<code>data/*.json</code>).<br>'
      +'<span style="font-size:12px;color:var(--faint)">This app must be served over http(s) — opening the file directly will block the fetch.</span></div>';
    return;
  }
  initSetup();
  initPlatformSelects();
  initPanels();
  initFilters();
  wireJournal();
  initStaging();
  // Reflect the initial overlay selection on the toggle buttons.
  document.querySelectorAll('.curvebtn').forEach(b=>b.classList.toggle('on',!!curveSel[b.dataset.k]));

  if(PAGE_MODE==='demo'){ runDemo(); return; }   // demo: in-memory sample data, never persists

  // Main app AND staging use IndexedDB. Staging uses an isolated DB (set in store.js)
  // and seeds the sample dataset once so it opens in the loaded state.
  if(Store.available()){
    try{
      await Store.init();
      if(STAGING_PAGE) await seedStagingIfEmpty();
      await restoreSession();
      return;
    }
    catch(err){ console.error('IndexedDB unavailable — running in-memory', err); }
  }
  resetApp();
  autoSelectState();   // in-memory fallback: still pre-fill the state from region
})();

/* Staging sandbox: if its isolated DB is empty, seed the demo dataset + default
   setup so it lands in the loaded state. Erase all local data → initial state. */
async function seedStagingIfEmpty(){
  try{
    if(await Store.tradeCount() > 0) return;
    const r=Adapters.parse(demoCSV(),'tradingview');
    if(r.ok && r.trades.length){
      await Store.addTrades(r.trades);
      await Store.setMeta('setup',{ broker:DEMO_BROKER, feed:DEMO_FEED, state:DEMO_STATE, platform:'35' });
    }
  }catch(e){ console.error('staging seed failed', e); }
}
