"use strict";
/* Blotterbook app · data — data lifecycle: CSV staging/parse/import, demo dataset, filters, day-notes journal, session restore, setup controls
   Loaded in order: core → render → data → ui → export → datamanager → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime). */

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
  // fire without a prior textarea blur, so cancel the pending debounce and persist now.
  clearTimeout(jSaveTimer);
  if(!DEMO_MODE && Store.available()){ const ta=document.getElementById('j_text'), d=selectedDate;
    if(ta) Store.saveJournal(d, ta.value); }
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
async function updateJournalEditor(){
  const journal=document.getElementById('journal'),
        ta=document.getElementById('j_text'), label=document.getElementById('j_date'),
        hint=document.getElementById('j_hint'), stat=document.getElementById('j_stat');
  if(!ta) return;
  // F11: the notes block only appears while a day is actively selected.
  if(journal) journal.style.display = selectedDate ? '' : 'none';
  if(!selectedDate){ ta.value=''; ta.disabled=true; stat.textContent=''; return; }
  if(DEMO_MODE || !Store.available()){
    ta.value=''; ta.disabled=true; label.textContent='Day notes'; stat.textContent='';
    hint.style.display=''; hint.textContent = DEMO_MODE ? 'Day-notes are disabled for the demo dataset.'
      : 'Local storage is unavailable in this browser, so notes can’t be saved.';
    return;
  }
  hint.style.display='none'; ta.disabled=false; label.textContent='Notes — '+selectedDate;
  ta.value=await Store.getJournal(selectedDate);
  stat.textContent = ta.value ? 'saved' : '';
}
function wireJournal(){
  const ta=document.getElementById('j_text'); if(!ta) return;
  // Capture the date + text at schedule time (CH11): the debounce/blur can fire after the
  // user has switched days, so binding to live selectedDate/ta.value would write the notes
  // to the wrong date. Save to the captured `d` instead.
  const save=async(d, v)=>{ if(d==null||DEMO_MODE||!Store.available()) return;
    await Store.saveJournal(d, v);
    JOURNAL_DATES=await Store.journalDates();
    if(d===selectedDate) document.getElementById('j_stat').textContent = v.trim()?'saved':'';  // only if still viewing it
    const cell=document.querySelector(`#cal .cell[data-date="${d}"]`);
    if(cell) cell.classList.toggle('hasnote', JOURNAL_DATES.has(d));
    emit('note:saved', { date: d });
    if(METRICS_ALL) renderCurve(activeMetrics());   // refresh note dots on the graph (CH16)
  };
  ta.addEventListener('input',()=>{ clearTimeout(jSaveTimer); const d=selectedDate, v=ta.value; jSaveTimer=setTimeout(()=>save(d,v),500); });
  ta.addEventListener('blur',()=>{ clearTimeout(jSaveTimer); save(selectedDate, ta.value); });
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
