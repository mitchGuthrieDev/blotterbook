(function(){
  var KEYLS='bb_admin_key';
  var keyInput=document.getElementById('adminkey');
  var labelInput=document.getElementById('label');
  var msg=document.getElementById('amsg');
  var cur=document.getElementById('curstate');
  var authnote=document.getElementById('authnote');
  try{ keyInput.value=localStorage.getItem(KEYLS)||''; }catch(_){}

  function setMsg(t,kind){ msg.textContent=t||''; msg.className='amsg'+(kind?' '+kind:''); }
  function mark(mode){ document.querySelectorAll('.modebtn').forEach(function(b){ b.classList.toggle('on', b.dataset.mode===mode); }); }

  // Reached through Cloudflare Access: fetch a SHORT-LIVED signed token (S3) — the raw
  // ADMIN_KEY never reaches the browser. The token is sent as x-admin-key for writes and
  // carried in the bb_staging cookie for launching staging, exactly like the key was.
  function autoKey(){
    fetch('/api/admin-key',{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; }).then(function(d){
      if(d && d.token){ keyInput.value=d.token; try{ localStorage.setItem(KEYLS,d.token); }catch(_){}
        var until=d.exp?(' — expires '+new Date(d.exp).toLocaleTimeString()):'';
        authnote.textContent='Authenticated'+(d.email?(' as '+d.email):'')+' — admin token issued'+until+'.'; }
    }).catch(function(){});
  }

  function loadStatus(){
    fetch('/api/status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
      var when=d.updatedAt?(' · updated '+new Date(d.updatedAt).toLocaleString()):'';
      cur.innerHTML='Current: <b>'+(d.mode||'auto')+'</b>'+(d.label?(' — “'+d.label+'”'):'')+when;
      mark(d.mode||'auto');
      if(d.label && !labelInput.value) labelInput.value=d.label;
    }).catch(function(){ cur.textContent='Current: unavailable (deploy on Cloudflare to use)'; });
  }

  function save(mode){
    var key=(keyInput.value||'').trim();
    try{ localStorage.setItem(KEYLS,key); }catch(_){}
    if(!key){ setMsg('Enter the admin key first.','err'); return; }
    setMsg('Saving…');
    fetch('/api/status',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':key},
      body:JSON.stringify({mode:mode,label:(labelInput.value||'').trim()})})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        if(res.ok){ setMsg('Saved: '+res.d.mode+(res.d.label?(' (“'+res.d.label+'”)'):''),'ok'); loadStatus(); }
        else setMsg('Error: '+(res.d.error||'request failed'),'err');
      })
      .catch(function(){ setMsg('Network error — is this deployed on Cloudflare?','err'); });
  }

  document.querySelectorAll('#modes .modebtn').forEach(function(b){
    if(b.dataset.mode) b.addEventListener('click',function(){ save(b.dataset.mode); });
  });

  // ---- feature flags + reference data (/api/config) ----
  var flagmsg=document.getElementById('flagmsg'), refmsg=document.getElementById('refmsg'), refstate=document.getElementById('refstate');
  function setFlagMsg(t,k){ flagmsg.textContent=t||''; flagmsg.className='amsg'+(k?' '+k:''); }
  function setRefMsg(t,k){ refmsg.textContent=t||''; refmsg.className='amsg'+(k?' '+k:''); }
  var verstate=document.getElementById('verstate'), vermsg=document.getElementById('vermsg');
  function setVerMsg(t,k){ vermsg.textContent=t||''; vermsg.className='amsg'+(k?' '+k:''); }
  function loadConfig(){
    fetch('/api/config',{cache:'no-store'}).then(function(r){return r.json();}).then(function(c){
      var f=c.flags||{};
      document.querySelectorAll('[data-flag]').forEach(function(el){ el.checked=!!f[el.dataset.flag]; });
      refstate.innerHTML='Cache version: <b>'+(c.refDataVersion?new Date(c.refDataVersion).toLocaleString():'never')+'</b>';
      var v=c.versions||{};
      document.getElementById('v_main').value=v.main||'';
      document.getElementById('v_demo').value=v.demo||'';
      document.getElementById('v_staging').value=v.staging||'';
      document.getElementById('v_platform').value=v.platform||'';
      verstate.innerHTML='Main <b>'+(v.main||'—')+'</b> · Demo <b>'+(v.demo||'—')+'</b> · Staging <b>'+(v.staging||'—')+'</b> · Platform <b>'+(v.platform||'—')+'</b>';
    }).catch(function(){ refstate.textContent='Config unavailable (deploy on Cloudflare to use)'; verstate.textContent='Versions: unavailable (deploy on Cloudflare to use)'; });
  }
  function postConfig(body,onMsg){
    var key=(keyInput.value||'').trim();
    if(!key){ onMsg('Enter the admin key first.','err'); return; }
    onMsg('Saving…');
    fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){ if(res.ok){ onMsg('Saved','ok'); loadConfig(); } else onMsg('Error: '+(res.d.error||'request failed'),'err'); })
      .catch(function(){ onMsg('Network error — is this deployed on Cloudflare?','err'); });
  }
  document.getElementById('saveflags').addEventListener('click',function(){
    var flags={}; document.querySelectorAll('[data-flag]').forEach(function(el){ flags[el.dataset.flag]=el.checked; });
    postConfig({flags:flags}, setFlagMsg);
  });
  document.getElementById('bumpref').addEventListener('click',function(){ postConfig({bumpRefData:true}, setRefMsg); });
  document.getElementById('saveversions').addEventListener('click',function(){
    postConfig({versions:{
      main:(document.getElementById('v_main').value||'').trim(),
      demo:(document.getElementById('v_demo').value||'').trim(),
      staging:(document.getElementById('v_staging').value||'').trim(),
      platform:(document.getElementById('v_platform').value||'').trim()
    }}, setVerMsg);
  });

  // Launch staging: carry the admin key as a short-lived cookie so the middleware gate passes,
  // then open the gated page. (Browsers can't set request headers on a navigation; the Cookie
  // header is the navigation-safe equivalent.)
  document.getElementById('launchstaging').addEventListener('click',function(){
    var key=(keyInput.value||'').trim();
    var sm=document.getElementById('stagemsg');
    if(key){ document.cookie='bb_staging='+encodeURIComponent(key)+';path=/app/;SameSite=Strict;Secure;max-age=3600';
      sm.textContent=''; }
    else { sm.textContent='No admin key — staging will only open if ADMIN_KEY is unset on the server.'; sm.className='amsg err'; }
    window.open('/app/staging.html','_blank','noopener');
  });

  // ---- backlog (read-only view of data/backlog.json) ----
  function bkesc(s){ return (s||'').replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}); }
  var bkData=null;
  var bkFStatus=document.getElementById('bk_fstatus'), bkFEffort=document.getElementById('bk_feffort');

  // Renders only the item LIST, honoring the status + effort filters. The per-category
  // counts above always reflect full totals (project health), not the active filter.
  function bkRenderList(){
    var list=document.getElementById('bk_list');
    if(!bkData){ list.innerHTML=''; return; }
    var fs=bkFStatus.value, fe=bkFEffort.value;
    var cats=bkData.categories||[], items=bkData.items||[];
    var html=cats.map(function(c){
      var its=items.filter(function(i){return i.category===c
        && (!fs || i.status===fs) && (!fe || i.effort===fe);});
      if(!its.length) return '';
      return '<div class="bkgroup">'+bkesc(c)+'</div>'+its.map(function(i){
        var badge=i.status==='done'?'done':(i.status==='guardrail'?'guard':'open');
        return '<div class="bkrow is-'+i.status+'"><span class="bk-id">'+bkesc(i.id)+'</span>'
          +'<span class="bk-title">'+bkesc(i.title)+'</span>'
          +'<span class="bk-eff">'+bkesc(i.effort)+'</span>'
          +'<span class="bk-badge '+i.status+'">'+badge+'</span></div>';
      }).join('');
    }).join('');
    list.innerHTML=html || '<div class="bktotal">No items match these filters.</div>';
  }
  function bkFillOptions(items){
    var statuses={}, efforts={};
    items.forEach(function(i){ if(i.status) statuses[i.status]=1; if(i.effort) efforts[i.effort]=1; });
    function fill(sel,vals){ var keep=sel.value;
      sel.innerHTML='<option value="">All</option>'+Object.keys(vals).sort().map(function(k){
        return '<option value="'+bkesc(k)+'">'+bkesc(k)+'</option>'; }).join('');
      sel.value=keep; }
    fill(bkFStatus,statuses); fill(bkFEffort,efforts);
  }
  function loadBacklog(){
    var counts=document.getElementById('bk_counts'), total=document.getElementById('bk_total'),
        bmsg=document.getElementById('bk_msg');
    fetch('/data/backlog.json',{cache:'no-store'}).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }).then(function(b){
      bkData=b;
      var items=b.items||[], cats=b.categories||[];
      var tDone=0, tOpen=0, tGuard=0;
      // per-category counts (prompt/doneNote intentionally NOT rendered)
      counts.innerHTML=cats.map(function(c){
        var its=items.filter(function(i){return i.category===c;});
        var done=its.filter(function(i){return i.status==='done';}).length;
        var open=its.filter(function(i){return i.status==='open';}).length;
        var guard=its.filter(function(i){return i.status==='guardrail';}).length;
        var tot=done+open; tDone+=done; tOpen+=open; tGuard+=guard;
        var pct= tot? Math.round(100*done/tot):0;
        return '<div class="bkcount"><div class="bk-cat">'+bkesc(c)+'</div>'
          +'<div class="bk-nums"><span class="bk-done">'+done+'</span><span class="bk-of">/ '+tot+' done</span>'
          +'<span class="bk-rem">'+open+' left'+(guard?(' · '+guard+' guard'):'')+'</span></div>'
          +'<div class="bkbar"><i style="width:'+pct+'%"></i></div></div>';
      }).join('');
      var grand=tDone+tOpen;
      total.innerHTML='Overall: <b>'+tDone+'</b> done · <b>'+tOpen+'</b> remaining'
        +(tGuard?(' · '+tGuard+' guardrail'):'')+' · <b>'+(grand?Math.round(100*tDone/grand):0)+'%</b> complete ('+items.length+' items)';
      bkFillOptions(items);
      bkRenderList();
      bmsg.textContent='';
    }).catch(function(){ bmsg.textContent='Could not load data/backlog.json.'; bmsg.className='amsg err'; });
  }
  bkFStatus.addEventListener('change',bkRenderList);
  bkFEffort.addEventListener('change',bkRenderList);
  document.getElementById('bk_fclear').addEventListener('click',function(){ bkFStatus.value=''; bkFEffort.value=''; bkRenderList(); });

  autoKey();
  loadStatus();
  loadConfig();
  loadBacklog();
})();
