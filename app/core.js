"use strict";
/* Blotterbook app · core — globals, DOM helpers, metrics, formatting, broker/cost model, reference-data loading
   Loaded in order: core → render → data → ui → export → datamanager → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime). */

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

/* ------------------------------------------------------------------
   Orientation — how the split scripts fit together (read this first)

   Load order (plain <script>s sharing ONE global scope — not ES modules):
     core         this file: state, DOM helpers, metrics, formatting, cost model, refdata
     render       cards, equity curve, calendar, advanced stats, break-even +
                  the scope/filter/render driver
     data         CSV import, demo data, filters, day-notes journal, session, setup
     ui           collapsible/drag panels, staging flair, file download
     export       performance report
     datamanager  Manage-data modal + per-trade editor
     main         DOM event wiring + boot() — runs LAST, so everything it calls exists

   Mode flags (derived from document.body[data-mode] above):
     STAGING_PAGE  gates the staging-only UI (web-grid dashboard, graph-only filters,
                   note dots, saved filters, activity terminal, session pill, workspace
                   templates). The main app and demo never render these.
     DEMO_MODE     (declared in render.js) true while the demo's in-memory dataset is
                   loaded; suppresses ALL persistence (nothing is written to IndexedDB).

   Shared mutable state (globals, mostly first assigned in render.js / data.js):
     TRADES, METRICS_ALL, FILTERS, SCOPE, calYear/calMonth, selectedDate,
     JOURNAL_DATES, TRADE_META, SAVED_FILTERS. Persistence is ALWAYS via Store
     (store.js) — never call indexedDB directly from app/render code.
   ------------------------------------------------------------------ */

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
  // equity curve + REALIZED max drawdown: walk closed-trade PnL, track running peak and the largest peak-to-trough drop
  let eq=0,peak=0,maxDD=0; const curve=[0];
  for(const p of pnls){ eq+=p; peak=Math.max(peak,eq); maxDD=Math.max(maxDD,peak-eq); curve.push(eq); }
  const dayMap=new Map();
  for(const t of tr){ if(!dayMap.has(t.date))dayMap.set(t.date,[]); dayMap.get(t.date).push(t.pnl); }
  const days=[...dayMap.entries()].map(([d,arr])=>({date:d,pnl:arr.reduce((a,b)=>a+b,0),
      trades:arr.length,wins:arr.filter(p=>p>0).length})).sort((a,b)=>a.date<b.date?-1:1);
  const active=days.length;
  const winDays=days.filter(d=>d.pnl>0).length;
  // longest run of consecutive winning (mcw) / losing (mcl) trades; a scratch (0) breaks both runs
  let mcw=0,mcl=0,cw=0,cl=0;
  for(const p of pnls){ if(p>0){cw++;cl=0;} else if(p<0){cl++;cw=0;} else {cw=0;cl=0;} mcw=Math.max(mcw,cw); mcl=Math.max(mcl,cl); }
  // daily-PnL dispersion → Sharpe: population std of per-day PnL (NOT annualized — see Definitions panel caveat)
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
