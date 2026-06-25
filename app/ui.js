"use strict";
/* Blotterbook app · ui — collapsible/drag panels, staging-only flair (activity terminal, session pill, workspace templates), file-download helper
   Loaded in order: core → render → data → ui → export → datamanager → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime). */

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
