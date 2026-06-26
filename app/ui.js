"use strict";
/* Blotterbook app · ui — collapsible/drag-to-reorder panels + file-download/setup-label helpers
   Loaded in order: core → render → data → ui → export → datamanager → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime).
   (Staging-only flair — terminal, session pill, workspace templates — moved to staging.js, loaded only by staging.html.) */

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
// Accepts a string (wrapped in a Blob of `type`) OR a ready-made Blob (CH11: replaces the
// old export-only expDlBlob helper).
function downloadFile(name, data, type='application/json'){
  const blob = data instanceof Blob ? data : new Blob([data], {type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}
function stateLabel(){ const o=$('c_state_sel'); return (o&&o.selectedOptions[0])?o.selectedOptions[0].textContent:'—'; }

/* ============================================================
   Modal a11y (B9) — shared by the data-manager and export modals.
   modalOpened(): flip aria-hidden, remember the trigger, move focus inside,
   and trap Tab within the dialog. modalClosed(): reverse it and restore focus.
   State is stashed on the element so the two modals never clobber each other.
   ============================================================ */
function modalFocusables(root){
  return [...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el=>el.offsetParent!==null);   // visible only
}
function modalOpened(ov){
  if(!ov) return;
  ov.setAttribute('aria-hidden','false');
  ov._prevFocus=document.activeElement;
  const f=modalFocusables(ov);
  if(f[0]) f[0].focus();
  ov._trap=e=>{
    if(e.key!=='Tab') return;
    const items=modalFocusables(ov); if(!items.length) return;
    const first=items[0], last=items[items.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  };
  ov.addEventListener('keydown',ov._trap);
}
function modalClosed(ov){
  if(!ov) return;
  ov.setAttribute('aria-hidden','true');
  if(ov._trap){ ov.removeEventListener('keydown',ov._trap); ov._trap=null; }
  if(ov._prevFocus && ov._prevFocus.focus) ov._prevFocus.focus();
  ov._prevFocus=null;
}
