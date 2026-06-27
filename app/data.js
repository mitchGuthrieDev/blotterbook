"use strict";
/* Blotterbook app · data — data lifecycle: CSV staging/parse/import, demo dataset, filters, day-notes journal, session restore, setup controls
   Loaded in order: core → render → data → ui → export → datamanager → widgets → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime). */

/* ============================================================
   Feature flags (F17) — admin-managed, served by /api/config and consumed at boot. The defaults
   here MUST mirror functions/api/config.js DEFAULTS.flags, so behaviour is unchanged when the
   config can't be fetched (static host / offline / pre-deploy). flag('x') reads the live value.
   ============================================================ */
let APP_FLAGS = { showBetaAdapters: true, maintenanceBanner: false, betaRibbon: false };
function flag(k){ return !!APP_FLAGS[k]; }
async function loadFlags(){
  try{ const r=await fetch('/api/config',{cache:'no-store'});
    if(r.ok){ const c=await r.json(); if(c && c.flags && typeof c.flags==='object') APP_FLAGS={ ...APP_FLAGS, ...c.flags }; }
  }catch(_){ /* no API (static/offline) → keep safe defaults */ }
  applyFlags();
}
function applyFlags(){
  const banner=document.getElementById('maintBanner');
  if(banner){ const on=flag('maintenanceBanner');
    banner.hidden=!on;
    if(on && !banner.textContent) banner.textContent='Blotterbook is undergoing maintenance — your local data is safe; some features may be briefly unavailable.';
  }
  const ribbon=document.getElementById('betaRibbon'); if(ribbon) ribbon.hidden=!flag('betaRibbon');
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
  emit('data:imported', { name, count: TRADES.length });
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
  // F17: the showBetaAdapters flag gates whether beta adapters appear in the manual picker
  // (auto-detect still works regardless). Default-true, so the picker is unchanged unless an
  // admin turns it off.
  return '<option value="">Auto-detect</option>'
    + Adapters.list().filter(a=>flag('showBetaAdapters')||!a.beta).map(a=>`<option value="${a.id}">${a.label}${a.beta?' (beta)':''}</option>`).join('');
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
  emit('data:loaded', { name: 'sample data', count: TRADES.length });   // B20: terminal reflects the load
}

/* ============================================================
   Filters
   ============================================================ */
function onFiltersChanged(){
  if(!TRADES.length){ updateFilterCount(); return; }
  // Filters apply to the whole dashboard: recompute the active dataset and re-render everything.
  METRICS_ALL=compute(baseTrades());
  updateFilterCount();
  renderCalendar();
  renderDash();
}
function updateFilterCount(){
  const el=document.getElementById('f_count'); if(!el) return;
  const base = baseTrades();
  el.textContent = filtersActive() ? `${base.length} / ${TRADES.length} trades` : `${TRADES.length} trades`;
}
function syncFilterOptions(){
  const sel=document.getElementById('f_symbol'); const cur=sel.value;
  const roots=[...new Set(TRADES.map(t=>t.root))].sort();
  sel.innerHTML='<option value="">All</option>'+roots.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
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
  sel.innerHTML='<option value="">All</option>'+tags.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
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
  // saved filters (shared — all surfaces; f_save is disabled on demo, which has no Store)
  on('f_save','click',saveCurrentFilter);
  on('f_saved','change',e=>{ const s=SAVED_FILTERS.find(x=>x.id===e.target.value); if(s) applyFilterObj(s.f); });
}

/* ---- saved filters (name, recall, manage) — shared UI, all surfaces (CH16) ---- */
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
  if(METRICS_ALL) renderCurve(activeMetrics());
}
/* Clear any active calendar selection (F11): drop the highlight, hide the notes box, and
   remove the graph marker. No-op when nothing is selected. */
function deselectDay(){
  if(!selectedDate) return;
  // Flush any unsaved note before clearing the day (B18): a keyboard/synthetic deselect can
  // fire without a prior blur, so cancel the pending debounce and persist now.
  flushDayNow();
  selectedDate=null;
  document.querySelectorAll('#cal .cell.selday').forEach(c=>c.classList.remove('selday'));
  updateJournalEditor();
  if(METRICS_ALL) renderCurve(activeMetrics());
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
/* ---- per-day annotation editor (F16: text + tags + screenshots, sharing the annotation editor
   from datamanager.js) + a read-only intraday trades list for the selected day. ---- */
let DAY_EDIT=null;   // { date, text, tags:[], shots:[] }

// Snapshot the live inputs + DAY_EDIT so a debounced/blur save lands on the RIGHT day even after
// the user switches days (CH11 — persist the captured snapshot, never live state).
function daySnapshot(){
  if(!DAY_EDIT) return null;
  annCapture(DAY_EDIT,'j');
  return { date:DAY_EDIT.date, text:DAY_EDIT.text||'', tags:DAY_EDIT.tags.slice(), shots:DAY_EDIT.shots.slice() };
}
async function persistDay(snap){
  if(!snap || snap.date==null || DEMO_MODE || !Store.available()) return;
  await Store.saveJournal(snap.date, { text:snap.text, tags:snap.tags, shots:snap.shots });
  JOURNAL_DATES=await Store.journalDates();
  const nonEmpty = (snap.text||'').trim() || snap.tags.length || snap.shots.length;
  if(snap.date===selectedDate){ const st=document.getElementById('j_stat'); if(st) st.textContent = nonEmpty?'saved':''; }
  const cell=document.querySelector(`#cal .cell[data-date="${snap.date}"]`);
  if(cell) cell.classList.toggle('hasnote', JOURNAL_DATES.has(snap.date));
  emit('note:saved', { date: snap.date });
  if(METRICS_ALL) renderCurve(activeMetrics());   // refresh note dots on the graph (CH16)
}
function flushDayNow(){ clearTimeout(jSaveTimer); const s=daySnapshot(); if(s) persistDay(s); }
function scheduleDaySave(){ clearTimeout(jSaveTimer); const s=daySnapshot(); jSaveTimer=setTimeout(()=>persistDay(s),500); }
// B28: drop a pending debounced save WITHOUT persisting — used by reset/erase so a queued snapshot
// can't write a stale day-note row back into a just-cleared/purged store.
function cancelDaySave(){ clearTimeout(jSaveTimer); jSaveTimer=null; }

function renderDayBody(){
  const body=document.getElementById('j_body'); if(!body) return;
  if(!DAY_EDIT){ body.innerHTML=''; return; }
  const nT=DAY_EDIT.tags.length, nS=DAY_EDIT.shots.length, has=nT||nS;
  const sum='Tags &amp; screenshots'+(has?' · '+[nT?nT+' tag'+(nT===1?'':'s'):'', nS?nS+' img':''].filter(Boolean).join(' · '):'');
  body.innerHTML =
    annTextField(DAY_EDIT,{prefix:'j',placeholder:'Write notes for this day…'})
    + `<details class="jmore"${has?' open':''}><summary>${sum}</summary>`
    + annTagsField(DAY_EDIT,{prefix:'j',placeholder:'breakout day, fomc, calm'})
    + annShotsField(DAY_EDIT,{prefix:'j'})
    + `</details>`;
}
// read-only list of the selected day's intraday trades, honoring the active filter bar (R3/F16
// decision: respect filters/scope). Reuses tradeCells() so markers/formatting match the trades table.
function renderDayTrades(date){
  const box=document.getElementById('j_trades'); if(!box) return;
  if(!date || typeof baseTrades!=='function'){ box.innerHTML=''; return; }
  const list=baseTrades().filter(t=>t.date===date);
  if(!list.length){ box.innerHTML=`<div class="jtnone">No trades on this day${(typeof filtersActive==='function'&&filtersActive())?' (with the active filters)':''}.</div>`; return; }
  const net=list.reduce((a,t)=>a+t.pnl,0);
  box.innerHTML=`<div class="jthead">Trades · ${list.length} · <span class="${cls(net)}">${usd(net)}</span></div>`
    +`<table class="commtab jttab"><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th class="num">P&amp;L</th></tr></thead><tbody>`
    + list.map(t=>`<tr><td class="mono">${esc((t.time||'').slice(11,16)||'—')}</td>${tradeCells(t)}</tr>`).join('')
    + `</tbody></table>`;
}

async function updateJournalEditor(){
  const journal=document.getElementById('journal'); if(!journal) return;
  // F11: the notes block only appears while a day is actively selected.
  journal.style.display = selectedDate ? '' : 'none';
  const label=document.getElementById('j_date'), hint=document.getElementById('j_hint'),
        stat=document.getElementById('j_stat'), body=document.getElementById('j_body');
  if(!selectedDate){ DAY_EDIT=null; if(body) body.innerHTML=''; renderDayTrades(null); if(stat) stat.textContent=''; return; }
  renderDayTrades(selectedDate);   // read-only intraday list — shown on every surface, incl. demo
  if(DEMO_MODE || !Store.available()){
    DAY_EDIT=null; if(body) body.innerHTML='';
    if(label) label.textContent='Day notes'; if(stat) stat.textContent='';
    if(hint){ hint.style.display=''; hint.textContent = DEMO_MODE ? 'Day-notes are disabled for the demo dataset.'
      : 'Local storage is unavailable in this browser, so notes can’t be saved.'; }
    return;
  }
  if(hint) hint.style.display='none'; if(label) label.textContent='Notes — '+selectedDate;
  const d=selectedDate;
  const rec=await Store.getJournal(d);
  if(d!==selectedDate) return;   // a newer day was selected during the await (CH11)
  DAY_EDIT={ date:d, text:rec.text||'', tags:(rec.tags||[]).slice(), shots:(rec.shots||[]).slice() };
  renderDayBody();
  if(stat) stat.textContent = (DAY_EDIT.text.trim()||DAY_EDIT.tags.length||DAY_EDIT.shots.length) ? 'saved' : '';
}

// Delegated wiring (the editor body is re-rendered, so listeners live on the stable #journal).
function wireJournal(){
  const journal=document.getElementById('journal'); if(!journal) return;
  journal.addEventListener('input', e=>{ if(DAY_EDIT && (e.target.id==='j_note'||e.target.id==='j_tags')) scheduleDaySave(); });
  journal.addEventListener('blur', e=>{ if(DAY_EDIT && (e.target.id==='j_note'||e.target.id==='j_tags')) flushDayNow(); }, true);
  journal.addEventListener('change', e=>{ if(e.target.id==='j_shotinput' && DAY_EDIT){ const f=e.target.files[0]; if(f) annAddShot(DAY_EDIT, f, 'j', ()=>{ renderDayBody(); flushDayNow(); }); e.target.value=''; } });
  journal.addEventListener('click', e=>{ const rm=e.target.closest('[data-rmshot]'); if(rm && DAY_EDIT){ annCapture(DAY_EDIT,'j'); DAY_EDIT.shots.splice(+rm.dataset.rmshot,1); renderDayBody(); flushDayNow(); } });
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
    const meta=`<b>${all.length}</b> trades &nbsp;·&nbsp; ${all[0].date} → ${all[all.length-1].date} &nbsp;·&nbsp; <span style="color:var(--dim)">restored from this browser</span>`;
    if(STAGING_PAGE) armStagingLanding(meta);   // F5: staging always opens on the initial state
    else renderLoaded('saved data', meta);
    emit('data:loaded', { name: 'saved data', count: all.length });   // B20: terminal reflects the restore
  } else {
    resetApp();
  }
  autoSelectState();   // fire-and-forget; no-ops if a state is already chosen
}

/* F5 (staging-only): always open on the initial/landing state, even when the
   isolated DB already has data. When data exists we stay on the landing but flip
   it into a "data ready" mode — swap the headline/blurb, show a loaded note, and
   enable Start (which opens the existing dashboard). With no data the normal
   load-CSV flow is untouched (Start stays gated). Main app + demo are unaffected. */
let STAGING_DATA_READY=false, STAGING_META='';
function armStagingLanding(metaHtml){
  STAGING_DATA_READY=true; STAGING_META=metaHtml||'';
  setDashVisible(false);                       // stay on the landing (body not .loaded)
  $('srcname').textContent='saved data';
  const t=document.querySelector('.ltitle'); if(t) t.textContent='Start Blotterbook to access your dashboard';
  const lead=document.querySelector('.llead');
  if(lead) lead.innerHTML='Your saved trade data is already loaded in this browser. <b>Start Blotterbook</b> to open your dashboard, or load a new CSV below to merge more trades.';
  const st=$('landingStatus'); if(st){ st.className='parsestatus ok'; st.innerHTML='&#10003; Dashboard data already loaded — '+(metaHtml||''); }
  const btn=$('startBtn'); if(btn){ btn.disabled=false; btn.textContent='Start Blotterbook →'; }
}
function enterStagingDashboard(){
  STAGING_DATA_READY=false;
  renderLoaded('saved data', STAGING_META);
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
    h+=`<optgroup label="${esc(grp)}">`;
    for(const [name,cost] of feeds[grp])
      h+=`<option value="${esc(name)}|${esc(cost)}" data-cost="${esc(cost)}">${esc(name)} — $${esc(cost)}</option>`;
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
