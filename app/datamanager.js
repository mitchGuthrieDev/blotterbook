"use strict";
/* Blotterbook app · datamanager — Manage-data modal, per-trade editor, backup/restore
   Loaded in order: core → render → data → ui → export → datamanager → widgets → main. Split from the former single app.js (classic
   scripts share one global scope, so cross-file functions/state resolve at runtime). */

/* ============================================================
   Data manager — edit & manage locally stored data
   ============================================================ */
let DM_SEARCH='';
function openDataManager(){
  const demo = PAGE_MODE==='demo';
  if(!demo && !Store.available()){ alert('Local storage is not available in this browser.'); return; }
  const ov=$('dataModal'); if(!ov) return;
  ov.classList.add('open'); document.body.style.overflow='hidden';
  modalOpened(ov);   // aria-hidden + focus trap/restore (B9)
  if(!demo) resetStage('manage');   // platform select returns to "Auto-detect" each time it's opened
  renderDataManager();
}
function closeDataManager(){ const ov=$('dataModal'); if(!ov||!ov.classList.contains('open')) return; ov.classList.remove('open'); document.body.style.overflow=''; modalClosed(ov); }

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
  // Day notes (CH20): preview text + the same tag/image markers as trades; each row opens the day editor
  if($('dm_notes')) $('dm_notes').innerHTML = notes.length
    ? notes.map(j=>`<div class="dmrow"><span class="mono dmdate">${esc(j.date)}</span>
        <span class="dmnote">${esc((j.text||'').slice(0,120))}${journalChips(j)}</span>
        <button class="dmdel alt" data-dayopen="${esc(j.date)}" title="Open this day's notes on the calendar">Open</button>
        <button class="dmdel" data-note="${esc(j.date)}" title="Delete this note">Delete</button></div>`).join('')
    : '<div class="dmempty">No day notes saved.</div>';

  // Per-trade editor (tags / note / screenshots)
  renderTradeEditor();

  // Trades (filterable)
  const q=DM_SEARCH.trim().toLowerCase();
  const shown=q? trades.filter(t=>t.root.toLowerCase().includes(q)||t.date.includes(q)||(t.side||'').includes(q)) : trades;
  if($('dm_tcount')) $('dm_tcount').textContent = q? `${shown.length} / ${trades.length}` : `${trades.length}`;
  // Same 5-column row everywhere; in demo the Edit/Delete controls render disabled (the demo
  // mirrors prod 1:1, with data-mutating actions greyed out) — `dis` is the demo lock-down.
  const dis = demo ? ' disabled' : '';
  if($('dm_trades')) $('dm_trades').innerHTML = shown.length
    ? shown.slice().reverse().map(t=>{ const id=tradeKey(t);
        return `<tr><td class="mono">${esc(t.date)}</td>${tradeCells(t)}
        <td class="dmrowact"><button class="dmdel alt" data-edit="${id}"${dis} title="Tags, note & screenshots">Edit</button>
        <button class="dmdel" data-trade="${id}"${dis} title="Delete this trade">Delete</button></td></tr>`; }).join('')
    : `<tr><td colspan="5" class="dmempty">No matching trades.</td></tr>`;

  // Saved filters (shared section — all surfaces; empty on demo, which has no Store)
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
/* same chips for a day-note record {tags,shots} (CH20 — text is already previewed alongside) */
function journalChips(j){
  const tags=(j.tags||[]).map(t=>`<span class="dmtag">${esc(t)}</span>`).join('');
  const n=(j.shots||[]).length;
  return (tags||n) ? ' '+tags+(n?`<span class="dmmark">${n} img</span>`:'') : '';
}
/* shared trade-row cells (symbol · side+markers · P&L) — reused by the Manage-data trades table
   and the per-day intraday list (F16/CH23) so the markers/formatting can't drift between them */
function tradeCells(t){
  const id=tradeKey(t);
  return `<td>${esc(t.root)}</td><td>${esc(t.side||'—')}${metaChips(TRADE_META.get(id))}</td>`
    + `<td class="num mono ${cls(t.pnl)}">${usd(t.pnl)}</td>`;
}
/* CH20: open a day's notes from Manage data — close the modal, jump the calendar to that date,
   select it, and scroll the notes block into view. */
function dmOpenDay(date){
  closeDataManager();
  if(typeof selectFromGraph==='function' && METRICS_ALL){ selectFromGraph(date); }
  else { selectedDate=date;   // fallback: sync the calendar to the date's month so the highlight is visible (CH25)
    const [yy,mm]=date.split('-').map(Number); calYear=yy; calMonth=mm-1;
    if(typeof renderCalendar==='function') renderCalendar();
    if(typeof renderDash==='function') renderDash();
    if(typeof updateJournalEditor==='function') updateJournalEditor(); }
  const j=$('journal'); if(j) j.scrollIntoView({block:'center'});
}

/* ============================================================
   Shared annotation editor (CH19) — tags + text + screenshots, used by BOTH the per-trade editor
   (Manage data) and the per-day notes editor (calendar, data.js). State shape: {tags:[],text:'',shots:[]}.
   The screenshot downscale/encode + data-URI validation pipeline lives here, ONCE.
   ============================================================ */
const SHOT_MAX_DIM = 1600, SHOT_SOFT_BYTES = 600 * 1024;
function annTagsField(state, o){
  return `<label class="dmlbl" for="${o.prefix}_tags">Tags <span class="dmsublbl">comma-separated</span></label>
    <input id="${o.prefix}_tags" class="dminput" value="${esc((state.tags||[]).join(', '))}" placeholder="${esc(o.placeholder||'')}">`;
}
function annTextField(state, o){
  return (o.label?`<label class="dmlbl" for="${o.prefix}_note">${esc(o.label)}</label>`:'')
    + `<textarea id="${o.prefix}_note" class="dmtextarea" placeholder="${esc(o.placeholder||'')}">${esc(state.text||'')}</textarea>`;
}
function annShotsField(state, o){
  return `<label class="dmlbl">Screenshots</label>
    <div class="dmshots">
      ${(state.shots||[]).map((s,i)=>`<div class="dmshot"><img src="${esc(s)}" alt="screenshot ${i+1}"><button data-rmshot="${i}" title="Remove">&times;</button></div>`).join('')}
      <label class="dmaddshot">+ Add image<input type="file" accept="image/*" id="${o.prefix}_shotinput" hidden></label>
    </div>`;
}
// read the tags + text inputs (by id prefix) back into `state`
function annCapture(state, prefix){
  if(!state) return;
  const tg=$(prefix+'_tags'), nt=$(prefix+'_note');
  if(tg) state.tags=[...new Set(tg.value.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean))];
  if(nt) state.text=nt.value;
}
/* Screenshots are stored as data-URLs in IndexedDB, so a few raw phone-camera images would bloat
   the local DB fast. Downscale (longest side ≤ MAX_DIM) and re-encode to JPEG once an image is
   large, keeping each stored shot bounded. Pushes into state.shots, then onDone(message). Captures
   the live tags/text inputs first so a re-render after the async load can't drop unsaved edits. */
function annAddShot(state, file, prefix, onDone){
  if(!state || !file) return;
  if(!/^image\//.test(file.type||'')){ alert('Please choose an image file.'); return; }
  const sizeLabel = n => n>=1048576 ? (n/1048576).toFixed(1)+' MB' : Math.round(n/1024)+' KB';
  const pushShot = (url, optimizedFromBytes) => {
    // S18: enforce the same data-URI allow-list as restore — rejects SVG / non-base64 images.
    if(!Store.validShot(url)){ alert('That image type isn’t supported — please use PNG, JPEG, WebP, or GIF.'); return; }
    annCapture(state, prefix);
    state.shots.push(url);
    onDone(optimizedFromBytes ? `Image optimized for local storage (${sizeLabel(optimizedFromBytes)} → ~${sizeLabel(url.length*0.75)}).` : '');
  };
  const r=new FileReader();
  r.onerror=()=>alert('Could not read that image.');
  r.onload=()=>{
    const dataUrl=String(r.result);
    const small = file.size<=SHOT_SOFT_BYTES;
    const img=new Image();
    img.onerror=()=>pushShot(dataUrl, 0);   // browser can't decode (e.g. some SVGs) → original (validShot still gates it)
    img.onload=()=>{
      const longest=Math.max(img.width,img.height);
      if(small && longest<=SHOT_MAX_DIM){ pushShot(dataUrl, 0); return; }   // already compact
      const scale=longest>SHOT_MAX_DIM ? SHOT_MAX_DIM/longest : 1;
      const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
      const c=document.createElement('canvas'); c.width=w; c.height=h;
      const ctx=c.getContext('2d');
      ctx.fillStyle='#0d1014'; ctx.fillRect(0,0,w,h);   // flatten transparency so JPEG looks right
      ctx.drawImage(img,0,0,w,h);
      let out; try{ out=c.toDataURL('image/jpeg',0.82); }catch(_){ out=dataUrl; }
      if(out.length>=dataUrl.length) pushShot(dataUrl, 0);   // re-encode didn't help → keep original
      else pushShot(out, file.size);
    };
    img.src=dataUrl;
  };
  r.readAsDataURL(file);
}

/* ---- per-trade editor (renders the shared annotation fields into the Manage-data card) ---- */
let DM_EDIT=null;
function renderTradeEditor(){
  const box=$('dm_editor'); if(!box) return;
  if(!DM_EDIT){ box.innerHTML=''; box.style.display='none'; return; }
  box.style.display='';
  const e=DM_EDIT, t=e.trade;
  box.innerHTML=
   `<div class="dmeditcard">
      <div class="dmedit-head"><b>${esc(t.date)} · ${esc(t.root)} ${esc(t.side||'')}</b>
        <span class="mono ${cls(t.pnl)}">${usd(t.pnl)}</span>
        <button class="dmx" data-editclose title="Close">&times;</button></div>
      ${annTagsField(e,{prefix:'dm',placeholder:'breakout, A+, fomo'})}
      ${annTextField(e,{prefix:'dm',label:'Note',placeholder:'What happened on this trade?'})}
      ${annShotsField(e,{prefix:'dm'})}
      <div class="dmedit-actions"><button class="dmbtn" data-editsave>Save</button>
        <button class="dmdel" data-editclear title="Remove all metadata for this trade">Clear</button>
        <span class="dmhint" id="dm_editmsg">${esc(e._msg||'')}</span></div>
    </div>`;
}
async function dmOpenTradeEditor(id){
  let trades=[]; try{ trades=await Store.getAllTrades(); }catch(_){}
  const trade=trades.find(t=>tradeKey(t)===id) || {date:'?',root:'?',side:'',pnl:0};
  const m=await Store.getTradeMeta(id);
  DM_EDIT={ id, trade, tags:(m.tags||[]).slice(), text:m.note||'', shots:(m.shots||[]).slice(), _msg:'' };
  renderTradeEditor();
  const box=$('dm_editor'); if(box) box.scrollIntoView({block:'nearest'});
}
function dmCaptureEdit(){ annCapture(DM_EDIT,'dm'); }   // thin wrapper (callers unchanged)
function dmAddShot(file){ if(DM_EDIT) annAddShot(DM_EDIT, file, 'dm', msg=>{ DM_EDIT._msg=msg; renderTradeEditor(); }); }
async function dmSaveEdit(){
  if(!DM_EDIT) return;
  dmCaptureEdit();
  await Store.saveTradeMeta(DM_EDIT.id, { tags:DM_EDIT.tags, note:DM_EDIT.text, shots:DM_EDIT.shots });
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
  emit('trade:deleted', { id });
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
    emit('backup:created');
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
