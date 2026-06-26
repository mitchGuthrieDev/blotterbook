  // Header border on scroll
  var hdr=document.getElementById('hdr');
  window.addEventListener('scroll',function(){
    hdr.classList.toggle('scrolled',window.scrollY>8);
  },{passive:true});

  // Close the mobile menu after tapping a link
  var navtoggle=document.getElementById('navtoggle');
  document.querySelectorAll('.navlinks a').forEach(function(a){
    a.addEventListener('click',function(){ if(navtoggle) navtoggle.checked=false; });
  });

  // Reveal-on-scroll
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} });
  },{threshold:.12});
  document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});

  // Features explorer (F7): click a feature in the list to show its detail on the right.
  (function(){
    var list=document.getElementById('featList'), detail=document.getElementById('featDetail');
    if(!list||!detail) return;
    var FEAT_BODY=[
      "Your CSV is parsed and stored entirely in your browser via IndexedDB. Trade data never leaves the page — the only network calls are the app's own reference data.",
      "Per-symbol, broker-aware commissions plus CME exchange, clearing, and NFA fees are modeled on every round turn — so Net and Take-home reflect what you actually keep, not gross PnL.",
      "A Section 1256 estimate blends 60/40 long/short-term federal rates with your state's top marginal rate, applied only to positive net profit. Pick your state and see take-home update instantly.",
      "Model AMP, EdgeClear, Tradovate / NinjaTrader, Optimus, thinkorswim, Interactive Brokers, and TradeStation. Switch broker or data feed and watch the cost — and your net — change.",
      "A cumulative performance graph with Gross / Net / Take-home overlays and hover detail, plus a Sunday-first monthly calendar of daily PnL with weekly summaries and day-notes.",
      "Filter by date, symbol, side, session (RTH/ETH), and weekday. Keep day-notes per session. Read expectancy, profit factor, drawdown, streaks, and an illustrative Sharpe — all after costs."
    ];
    var items=list.querySelectorAll('.feat-item');
    function show(i){
      var li=items[i]; if(!li) return;
      items.forEach(function(el){ el.classList.toggle('is-active', +el.dataset.i===i); });
      detail.innerHTML='<div class="ficon">'+li.querySelector('.ficon').innerHTML+'</div>'
        +'<h3>'+li.querySelector('.fl-t').innerHTML+'</h3><p>'+FEAT_BODY[i]+'</p>';
    }
    items.forEach(function(el){ el.addEventListener('click',function(){ show(+el.dataset.i); }); });
  })();

  // Live status — an admin override (set on the admin page) wins; otherwise auto-detect by pinging the app
  (function(){
    var pill=document.getElementById('livepill'), txt=document.getElementById('livetext');
    function set(state,label){ pill.classList.remove('live','down','maint'); pill.classList.add(state); txt.textContent=label; }
    function ping(){
      fetch('app/',{method:'GET',cache:'no-store'})
        .then(function(r){ set(r.ok?'live':'down', r.ok?'Live':'Offline'); })
        .catch(function(){ set('down','Offline'); });
    }
    fetch('/api/status',{cache:'no-store'})
      .then(function(r){ return r.ok?r.json():null; })
      .then(function(s){
        if(s && s.mode && s.mode!=='auto'){
          var st = s.mode==='live'?'live' : s.mode==='maintenance'?'maint' : 'down';
          set(st, s.label || (s.mode==='live'?'Live':s.mode==='maintenance'?'Maintenance':'Offline'));
        } else { ping(); }
      })
      .catch(ping);
  })();
