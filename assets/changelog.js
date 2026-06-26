(function(){
  var log=document.getElementById('log'), status=document.getElementById('clstatus');

  /* Baked-in fallback if our cached endpoint is unavailable (e.g. local dev). */
  var FALLBACK=[
    {sha:'',date:'2026-06-24',msg:'Format auto-detection phase 1: platform adapters, detection, fills matcher'},
    {sha:'',date:'2026-06-23',msg:'UI/UX pass: landing, graph, data manager, report, demo, homepage, changelog'},
    {sha:'',date:'2026-06-23',msg:'Rework app: shared CSS/JS, demo page, report export, data manager, UI fixes'},
    {sha:'',date:'2026-06-23',msg:'Add one-page Blotterbook homepage + Blotterlog changelog; rebrand'},
    {sha:'',date:'2026-06-23',msg:'Restructure into a multi-file app: JSON data, IndexedDB, filters, journal'},
    {sha:'',date:'2026-06-22',msg:'Add cost calculations to the dashboard'},
    {sha:'',date:'2026-06-22',msg:'Initial project commit'}
  ];

  function esc(s){ return (s||'').replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}); }
  function render(items, live){
    log.innerHTML=items.map(function(c,i){
      var hash=c.sha ? (c.url? '<a href="'+c.url+'" target="_blank" rel="noopener">'+c.sha+'</a>' : c.sha) : '';
      return '<div class="entry'+(i===0?' first':'')+'">'
        +'<div class="meta"><span class="date">'+c.date+'</span>'
        +(hash?'<span class="hash">'+hash+'</span>':'')
        +(i===0?'<span class="latest">Latest</span>':'')+'</div>'
        +'<h3>'+esc(c.msg)+'</h3></div>';
    }).join('');
    if(status) status.textContent = live ? 'Synced from GitHub (cached hourly)' : 'Showing the last saved snapshot';
  }

  render(FALLBACK, false);

  /* Read our own cached endpoint — it shields GitHub from per-visit traffic and
     refreshes about once an hour at the edge, with no redeploy. */
  fetch('/api/changelog', {headers:{'Accept':'application/json'}})
    .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(d){
      if(d && d.ok && Array.isArray(d.commits) && d.commits.length) render(d.commits, true);
    })
    .catch(function(){ /* keep the fallback already rendered */ });
})();
