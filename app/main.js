"use strict";
/* Blotterbook app · main — DOM event wiring + boot()
   Loaded in order: core → render → data → ui → export → datamanager → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime). */

/* ============================================================
   Wiring
   ============================================================ */
const on=(id,ev,fn)=>{ const el=$(id); if(el) el.addEventListener(ev,fn); };

// Route through the null-safe on() like every other handler — a direct $('prev').onclick
// throws at module load if the id is ever absent, which would kill boot() entirely (B12).
on('prev','click',()=>{ if(!METRICS_ALL)return;
  if(--calMonth<0){calMonth=11;calYear--;} renderCalendar(); if(SCOPE==='month') renderDash(); });
on('next','click',()=>{ if(!METRICS_ALL)return;
  if(++calMonth>11){calMonth=0;calYear++;} renderCalendar(); if(SCOPE==='month') renderDash(); });
on('caltoday','click',jumpToLatest);
// A picked file is staged (parsed + platform-detected), not loaded immediately.
on('file','change',e=>{ const f=e.target.files[0]; e.target.value=''; if(!f)return; stageFile(f, FILE_CTX); });
on('c_platform','change',()=>onPlatformChange('landing'));
on('dm_platform','change',()=>onPlatformChange('manage'));
on('startBtn','click',()=>{
  // F5 (staging): with data preloaded and nothing newly staged, Start just opens the dashboard.
  if(STAGING_PAGE && STAGING_DATA_READY && !PENDING){ enterStagingDashboard(); return; }
  commitPending('landing');
});
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
on('cal','keydown',e=>{   // keyboard parity for day cells (B10)
  if(e.key!=='Enter' && e.key!==' ') return;
  const cell=e.target.closest('.cell[data-date]'); if(!cell)return;
  e.preventDefault(); selectDay(cell.dataset.date);
});
// F11: a click outside the Trading Calendar module deselects the active day. The calendar
// module (cells + notes editor) and the equity curve (the other day-selection surface) keep
// the selection; clicking anywhere else dismisses it. Runs in the CAPTURE phase so it reads
// the click target while it's still attached — selectFromGraph re-renders the curve on click,
// which would otherwise detach the target and make the in-curve check miss.
document.addEventListener('click',e=>{
  if(!selectedDate) return;
  // also ignore clicks inside any open modal (data-manager / export) — interacting there
  // shouldn't drop the selected day, which is exactly where you delete that day's note (B18).
  if(e.target.closest('.panel[data-key="cal"]') || e.target.closest('#curve') || e.target.closest('.modal')) return;
  deselectDay();
}, true);

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
    emit('data:erased');
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
  emit('app:ready');   // staging.js (if loaded) sets up its terminal / session pill / workspace controls
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
