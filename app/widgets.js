"use strict";
/* Blotterbook app · widgets — activity terminal, session-status pill, and save/load/revert
   workspace templates, plus the subscriptions that turn shared app events into terminal log
   lines. Promoted from the staging sandbox to every surface (CH16) — loaded on app, demo, and
   staging. Loaded AFTER datamanager.js and BEFORE main.js, so its event subscriptions are
   registered before boot() emits app:ready. */

const WS_KEY='tj_ws_templates';
const DEFAULT_DASH_ORDER=['perf','cal','cost','adv','defs','term'];

function logAction(msg, kind){
  const win=document.getElementById('termwin'); if(!win) return;
  const line=document.createElement('div');
  line.className='tl'+(kind?(' evt-'+kind):'');
  const ts=document.createElement('span'); ts.className='ts'; ts.textContent=new Date().toTimeString().slice(0,8)+'  ';
  const tm=document.createElement('span'); tm.className='tm'; tm.textContent=msg;
  line.appendChild(ts); line.appendChild(tm);
  win.insertBefore(line, win.firstChild);                      // newest on top (F12)
  while(win.children.length>200) win.removeChild(win.lastChild);   // trim oldest (now last)
  win.scrollTop=0;                                             // keep the newest line in view
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
  saveOrder(); saveCollapsed();   // (shared, in ui.js)
  if(METRICS_ALL) renderCurve(curveMetrics());
}
function readWsTemplates(){ try{ return JSON.parse(localStorage.getItem(WS_KEY)||'{}')||{}; }catch(e){ return {}; } }
function writeWsTemplates(o){ try{ localStorage.setItem(WS_KEY,JSON.stringify(o)); }catch(e){} }
function refreshWsSelect(sel){
  const el=document.getElementById('ws_tpl'); if(!el) return;
  const tpls=readWsTemplates();
  el.innerHTML='<option value="">— Default —</option>'
    + Object.keys(tpls).map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if(sel) el.value=sel;
}
function initWidgets(){
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
  on('ws_tpl','change',e=>{ const n=e.target.value;
    if(!n){   // "— Default —" → drop saved layout and reset to the default arrangement
      try{ localStorage.removeItem(LS_ORDER); localStorage.removeItem(LS_COLLAPSE); }catch(_){}
      applyWorkspace({ order:DEFAULT_DASH_ORDER, collapsed:{} });
      logAction('Layout reverted to default'); return;
    }
    const t=readWsTemplates()[n];
    if(t){ applyWorkspace(t); logAction('Workspace template loaded · '+n); } });
  // redraw the performance graph on resize so it re-measures its (grid) width
  let _rsz=null; window.addEventListener('resize',()=>{ clearTimeout(_rsz);
    _rsz=setTimeout(()=>{ if(METRICS_ALL) renderCurve(curveMetrics()); }, 160); });
  // Read the version from the page badge rather than hardcoding it (single source — CH8).
  // Wait for the runtime version fetch to populate the badge first (CH12) so the log line
  // shows the live version, not the baked offline fallback.
  Promise.resolve(window.__versionsReady).then(()=>{
    const ver=(document.querySelector('.ver')||{}).textContent||'';
    logAction('Session ready'+(ver?' · '+ver.trim():''));
  });
}

/* Subscribe to shared app-action events → terminal log lines (all surfaces, CH16). */
onEvent('app:ready',     initWidgets);
onEvent('data:imported', d=>logAction('CSV imported · '+((d&&d.name)||'file')+' · now '+(d&&d.count)+' trades'));
onEvent('note:saved',    d=>logAction('Day note saved · '+(d&&d.date)));
onEvent('trade:deleted', d=>logAction('Trade deleted · '+(d&&d.id), 'warn'));
onEvent('backup:created',()=>logAction('Session backup created'));
onEvent('data:erased',   ()=>logAction('All local data erased', 'err'));
