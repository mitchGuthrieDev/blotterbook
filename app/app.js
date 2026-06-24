"use strict";
const SVGNS='http://www.w3.org/2000/svg';
const pad2 = n => String(n).padStart(2,'0');
const fmtDate = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const $ = id => document.getElementById(id);
/* The demo runs on its own page (demo.html) with a trimmed top bar. */
const DEMO_PAGE = !!(document.body && document.body.dataset.mode === 'demo');

/* ============================================================
   CSV parsing → trades
   ============================================================ */
function parseCSV(text){
  const rows=[]; let i=0, field='', row=[], q=false; const n=text.length;
  const push=()=>{row.push(field);field='';};
  const eol=()=>{push();if(row.length>1||row[0]!=='')rows.push(row);row=[];};
  while(i<n){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else q=false; } else field+=c; }
    else { if(c==='"')q=true; else if(c===',')push(); else if(c==='\n')eol(); else if(c==='\r'){} else field+=c; }
    i++;
  }
  if(field!==''||row.length)eol();
  return rows;
}

/* derive the futures root ticker: MESM2025 → MES, M2KZ2025 → M2K, MES1! → MES */
function rootSym(s){
  if(!s) return '?';
  s = s.toUpperCase().replace(/^.*:/,'');
  s = s.replace(/[FGHJKMNQUVXZ]\d{1,4}$/,'').replace(/\d*!$/,'');
  return s || '?';
}

function toTrades(text){
  const rows=parseCSV(text); if(!rows.length) return [];
  const head=rows[0].map(h=>h.trim().toLowerCase());
  const ix=name=>head.findIndex(h=>h.includes(name));
  const cT=ix('time'),
        cP=ix('realized pnl (value)')>=0?ix('realized pnl (value)'):ix('realized pnl'),
        cA=ix('action');
  const out=[];
  for(let r=1;r<rows.length;r++){
    const row=rows[r]; if(!row||!row[cT]) continue;
    const t=row[cT].trim(); const pnl=parseFloat(row[cP]); if(isNaN(pnl)) continue;
    const action=cA>=0?row[cA]:'';
    const sm=action.match(/symbol\s+(\S+)\s+at price/i);
    const symbol=sm?sm[1]:'';
    const side= /close short/i.test(action)?'short' : /close long/i.test(action)?'long' : '';
    out.push({time:t, date:t.slice(0,10), pnl, symbol, root:rootSym(symbol), side});
  }
  out.sort((a,b)=> a.time<b.time?-1:a.time>b.time?1:0);
  return out;
}

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
  const W=1000,H=260,padL=62,padR=20,padT=18,padB=46;
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
  // axis titles
  const axis=`<text class="axt" x="${padL+(W-padL-padR)/2}" y="${H-4}" text-anchor="middle">Date</text>
    <text class="axt" transform="rotate(-90)" x="${-(padT+(H-padB)/2)}" y="15" text-anchor="middle">Cumulative PnL ($)</text>`;

  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.innerHTML=defs+grid+area+band
    +`<line class="zero" x1="${padL}" x2="${W-padR}" y1="${zeroY}" y2="${zeroY}"/>`
    +lines+endDots+endLabels+sel+axis;

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
function renderAdv(m){
  const c=costModel(m);
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
let DEMO_MODE=false;           // demo data is never persisted

const FILTERS={from:'',to:'',symbol:'',side:'',session:'',dows:new Set()};
function filtersActive(){ return !!(FILTERS.from||FILTERS.to||FILTERS.symbol||FILTERS.side||FILTERS.session||FILTERS.dows.size); }
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
    if(FILTERS.dows.size && !FILTERS.dows.has(new Date(t.date+'T00:00:00').getDay())) return false;
    return true;
  });
}
function baseTrades(){ return applyFilters(TRADES); }

function scopeLabel(){ return SCOPE==='all' ? 'all time' : `${MON[calMonth]} ${calYear}`; }
function activeMetrics(){
  if(SCOPE==='all') return METRICS_ALL;
  const mk=`${calYear}-${pad2(calMonth+1)}`;
  return compute(baseTrades().filter(t=>t.date.startsWith(mk)));
}
function renderDash(){
  if(!METRICS_ALL) return;
  const m=activeMetrics();
  renderCards(m); renderCurve(m); renderAdv(m); renderCalc(m);
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
  if(v) document.getElementById('setup').classList.remove('collapsed');   // expand on fresh load
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

/* Import a CSV, merging only the delta into local storage. */
async function importCSV(text,name){
  const parsed=toTrades(text);
  if(!parsed.length){
    alert('No trades found. Expected TradingView balance-history columns: Time · Realized PnL (value) · Action.');
    return;
  }
  DEMO_MODE=false;
  let metaHtml;
  if(Store.available()){
    const {added,duplicate,total}=await Store.addTrades(parsed);
    TRADES=await Store.getAllTrades();
    JOURNAL_DATES=await Store.journalDates();
    metaHtml=`<b>${total}</b> trades &nbsp;·&nbsp; +${added} new · ${duplicate} dup &nbsp;·&nbsp; ${TRADES[0].date} → ${TRADES[TRADES.length-1].date}`;
  } else {
    TRADES=parsed;
    metaHtml=`<b>${TRADES.length}</b> trades &nbsp;·&nbsp; ${TRADES[0].date} → ${TRADES[TRADES.length-1].date}`;
  }
  renderLoaded(name, metaHtml);
}

/* ============================================================
   Demo dataset (deterministic, generated — no external file)
   ============================================================ */
function demoCSV(){
  let seed=246813579; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  const syms=['MESM2025','MESM2025','MESM2025','MNQM2025','MNQM2025','MCLN2025'];
  const rows=[['Time','Action','Realized PnL (value)']];
  const start=new Date(2026,5,1), end=new Date(2026,5,30);   // a full month: Jun 1 → Jun 30 2026
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
  TRADES=toTrades(demoCSV());
  // no source label on the demo (the DEMO badge already says it); just the meta
  renderLoaded('', `<b>${TRADES.length}</b> trades &nbsp;·&nbsp; sample data, not saved`);
}

/* ============================================================
   Filters
   ============================================================ */
function onFiltersChanged(){
  if(!TRADES.length){ updateFilterCount(); return; }
  METRICS_ALL=compute(baseTrades());
  updateFilterCount();
  renderCalendar();
  renderDash();
}
function updateFilterCount(){
  const el=document.getElementById('f_count'); if(!el) return;
  el.textContent = filtersActive() ? `${baseTrades().length} / ${TRADES.length} trades` : `${TRADES.length} trades`;
}
function syncFilterOptions(){
  const sel=document.getElementById('f_symbol'); const cur=sel.value;
  const roots=[...new Set(TRADES.map(t=>t.root))].sort();
  sel.innerHTML='<option value="">All</option>'+roots.map(r=>`<option value="${r}">${r}</option>`).join('');
  sel.value = roots.includes(cur)?cur:''; FILTERS.symbol=sel.value;
  updateFilterCount();
}
function resetFilters(){
  FILTERS.from=FILTERS.to=FILTERS.symbol=FILTERS.side=FILTERS.session=''; FILTERS.dows.clear();
  ['f_from','f_to','f_symbol','f_side','f_session'].forEach(id=>document.getElementById(id).value='');
  document.querySelectorAll('#f_dows button.on').forEach(b=>b.classList.remove('on'));
  onFiltersChanged();
}
function initFilters(){
  const dows=document.getElementById('f_dows');
  dows.innerHTML=DOW_LABEL.map((d,i)=>`<button type="button" data-d="${i}" title="${d}">${d[0]}</button>`).join('');
  dows.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return;
    const d=+b.dataset.d; if(FILTERS.dows.has(d)) FILTERS.dows.delete(d); else FILTERS.dows.add(d);
    b.classList.toggle('on'); onFiltersChanged(); });
  const bind=(id,key)=>document.getElementById(id).addEventListener('change',e=>{ FILTERS[key]=e.target.value; onFiltersChanged(); });
  bind('f_from','from'); bind('f_to','to'); bind('f_symbol','symbol'); bind('f_side','side'); bind('f_session','session');
  document.getElementById('f_reset').addEventListener('click',resetFilters);
}

/* ============================================================
   Day-notes / journal (per-day, click a calendar day)
   ============================================================ */
let jSaveTimer=null;
async function selectDay(d){
  selectedDate = (selectedDate===d)? null : d;
  document.querySelectorAll('#cal .cell.selday').forEach(c=>c.classList.remove('selday'));
  if(selectedDate){ const cell=document.querySelector(`#cal .cell[data-date="${selectedDate}"]`); if(cell) cell.classList.add('selday'); }
  await updateJournalEditor();
  if(METRICS_ALL) renderCurve(activeMetrics());
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
  };
  ta.addEventListener('input',()=>{ clearTimeout(jSaveTimer); jSaveTimer=setTimeout(save,500); });
  ta.addEventListener('blur',()=>{ clearTimeout(jSaveTimer); save(); });
}

/* ============================================================
   Session restore (setup selections + persisted trades)
   ============================================================ */
async function persistSetup(){
  if(DEMO_PAGE || !Store.available()) return;   // demo shares the DB but must not overwrite real setup
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
  const all=await Store.getAllTrades();
  if(all.length){
    TRADES=all;
    renderLoaded('saved data', `<b>${all.length}</b> trades &nbsp;·&nbsp; ${all[0].date} → ${all[all.length-1].date} &nbsp;·&nbsp; <span style="color:var(--dim)">restored from this browser</span>`);
  } else {
    resetApp();
  }
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
function updateGate(){
  const ok = !!($('c_broker').value && $('c_feed').value && $('c_state_sel').value);
  const inp=$('file'), lbl=$('loadlbl'), sbtn=$('setupLoad');
  const title = ok? 'Load a balance-history CSV' : 'Select broker, data feed, and state first';
  if(inp) inp.disabled=!ok;
  if(lbl){ lbl.classList.toggle('disabled',!ok); lbl.title=title; }
  if(sbtn){ sbtn.disabled=!ok; sbtn.classList.toggle('disabled',!ok); sbtn.title=title; }
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
  if(!Store.available()){ alert('Local storage is not available in this browser.'); return; }
  const ov=$('dataModal'); if(!ov) return;
  ov.classList.add('open'); document.body.style.overflow='hidden';
  renderDataManager();
}
function closeDataManager(){ const ov=$('dataModal'); if(ov) ov.classList.remove('open'); document.body.style.overflow=''; }

const esc=s=>(s||'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
async function renderDataManager(){
  // each section renders independently so one failure can't blank the rest
  let trades=[], notes=[];
  try{ trades=await Store.getAllTrades(); }catch(e){ console.error('getAllTrades', e); }
  try{ notes=await Store.getAllJournal(); }catch(e){ console.error('getAllJournal', e); }

  // Overview
  const range = trades.length ? `${trades[0].date} → ${trades[trades.length-1].date}` : '—';
  let kb='—'; try{ kb=(new Blob([JSON.stringify(await Store.exportAll())]).size/1024).toFixed(1)+' KB'; }catch(e){ console.error('size', e); }
  if($('dm_summary')) $('dm_summary').innerHTML=
     `<div class="dmstat"><div class="dk">Trades</div><div class="dv">${trades.length}</div></div>`
    +`<div class="dmstat"><div class="dk">Date range</div><div class="dv mono">${range}</div></div>`
    +`<div class="dmstat"><div class="dk">Day notes</div><div class="dv">${notes.length}</div></div>`
    +`<div class="dmstat"><div class="dk">Local size</div><div class="dv mono">${kb}</div></div>`;

  // Notes
  if($('dm_notes')) $('dm_notes').innerHTML = notes.length
    ? notes.map(j=>`<div class="dmrow"><span class="mono dmdate">${j.date}</span>
        <span class="dmnote">${esc(j.text).slice(0,120)}</span>
        <button class="dmdel" data-note="${j.date}" title="Delete this note">Delete</button></div>`).join('')
    : '<div class="dmempty">No day notes saved.</div>';

  // Trades (filterable)
  const q=DM_SEARCH.trim().toLowerCase();
  const shown=q? trades.filter(t=>t.root.toLowerCase().includes(q)||t.date.includes(q)||(t.side||'').includes(q)) : trades;
  if($('dm_tcount')) $('dm_tcount').textContent = q? `${shown.length} / ${trades.length}` : `${trades.length}`;
  if($('dm_trades')) $('dm_trades').innerHTML = shown.length
    ? shown.slice().reverse().map(t=>`<tr><td class="mono">${t.date}</td><td>${t.root}</td>
        <td>${t.side||'—'}</td><td class="num mono ${cls(t.pnl)}">${usd(t.pnl)}</td>
        <td><button class="dmdel" data-trade="${Store.tradeId(t)}" title="Delete this trade">Delete</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="dmempty">No matching trades.</td></tr>';
}

async function dmDeleteTrade(id){
  await Store.deleteTrade(id);
  await reloadFromStore();
  await renderDataManager();
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
on('file','change',e=>{ const f=e.target.files[0]; if(!f)return;
  const r=new FileReader(); r.onload=async()=>{ await importCSV(r.result,f.name);
    // if the data manager is open (Load CSV came from there), refresh its lists
    if($('dataModal') && $('dataModal').classList.contains('open')) renderDataManager();
  };
  r.readAsText(f); e.target.value=''; });   // allow re-selecting the same file
document.querySelectorAll('#scope button').forEach(b=>b.onclick=()=>setScope(b.dataset.s));

/* The demo lives on its own page (demo.html), reached from the homepage.
   On the demo page an "End demo" button returns to the homepage. */
on('endDemoBtn','click',()=>{ try{ window.close(); }catch(_){}
  // window.close() only works for script-opened tabs; navigate to the homepage as a fallback
  setTimeout(()=>{ location.href='../index.html'; }, 60); });

on('exportBtn','click',exportReport);
on('manageBtn','click',openDataManager);
on('setupLoad','click',()=>$('file').click());
on('setuphead','click',()=>$('setup').classList.toggle('collapsed'));
// The loaded-source text opens the data manager (only once data is loaded).
on('srcname','click',()=>{ if($('dataModal') && document.body.classList.contains('loaded')) openDataManager(); });

// Performance overlays are toggle buttons — at least one must stay selected.
document.querySelectorAll('.curvebtn').forEach(btn=>btn.addEventListener('click',()=>{
  const k=btn.dataset.k;
  const selected=Object.keys(curveSel).filter(x=>curveSel[x]);
  if(curveSel[k] && selected.length===1) return;   // can't deselect the last overlay
  curveSel[k]=!curveSel[k];
  btn.classList.toggle('on',curveSel[k]);
  if(METRICS_ALL) renderCurve(activeMetrics());
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
  on('dm_load','click',()=>$('file').click());
  on('dm_export','click',dmExport);
  on('dm_importBtn','click',()=>$('dm_importFile').click());
  on('dm_importFile','change',e=>{ const f=e.target.files[0]; if(f) dmImport(f); e.target.value=''; });
  on('dm_search','input',e=>{ DM_SEARCH=e.target.value; renderDataManager(); });
  on('dm_clear','click',async()=>{
    if(!confirm('Erase ALL trades and day-notes saved in this browser? This cannot be undone.')) return;
    await Store.purge(); JOURNAL_DATES=new Set(); resetApp(); renderDataManager();
  });
  // delegated delete buttons (trades + notes)
  on('dm_trades','click',e=>{ const b=e.target.closest('button[data-trade]'); if(b) dmDeleteTrade(b.dataset.trade); });
  on('dm_notes','click',e=>{ const b=e.target.closest('button[data-note]');
    if(b && confirm('Delete the note for '+b.dataset.note+'?')) dmDeleteNote(b.dataset.note); });
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
  initPanels();
  initFilters();
  wireJournal();
  // Reflect the initial overlay selection on the toggle buttons.
  document.querySelectorAll('.curvebtn').forEach(b=>b.classList.toggle('on',!!curveSel[b.dataset.k]));

  if(DEMO_PAGE){ runDemo(); return; }   // demo page: load sample data, never persist

  if(Store.available()){
    try{ await Store.init(); await restoreSession(); return; }
    catch(err){ console.error('IndexedDB unavailable — running in-memory', err); }
  }
  resetApp();
})();
