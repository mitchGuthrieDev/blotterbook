<script>
  // App root (A27 staging; A31 made it mode-aware for the coming prod/demo migration). Boots by
  // REUSING the vanilla pure-logic core verbatim (A29): loadRefData + a Store + Adapters + compute().
  // The view layer (this component + children) is the only thing rewritten in Svelte.
  //
  // A31: the persistence backend is chosen by PAGE_MODE and provided to the children via context
  // ('bb:store'), so the same components work on every surface:
  //   app      → real IndexedDB Store (blotterbook DB), no seed (real user data; landing flow is A32)
  //   demo     → in-memory DemoStore (never persists), seeded
  //   staging  → real IndexedDB Store (isolated blotterbookStaging DB), seeded
  // Today this app is still mounted only on staging.html; app/demo mounts land in A33.
  import { onMount, setContext } from 'svelte';
  import { loadRefData, compute, emit, PAGE_MODE, STATES, DEMO_BROKER, DEMO_FEED, DEMO_STATE } from '../core.js';
  import { Store } from '../store.js';
  import { createDemoStore } from '../demostore.js';
  import { Adapters } from '../adapters.js';
  import { demoCSV } from '../sampledata.js';

  // Pick the backend by mode and share it with every child (they read getContext('bb:store')).
  const store = PAGE_MODE === 'demo' ? createDemoStore() : Store;
  const SEEDED = PAGE_MODE === 'staging' || PAGE_MODE === 'demo';
  setContext('bb:store', store);
  import Overview from './components/Overview.svelte';
  import EquityCurve from './components/EquityCurve.svelte';
  import CalendarMonth from './components/CalendarMonth.svelte';
  import AdvancedStats from './components/AdvancedStats.svelte';
  import CostPanel from './components/CostPanel.svelte';
  import FilterBar from './components/FilterBar.svelte';
  import JournalEditor from './components/JournalEditor.svelte';
  import ManageData from './components/ManageData.svelte';
  import ActivityTerminal from './components/ActivityTerminal.svelte';
  import Definitions from './components/Definitions.svelte';
  import Landing from './components/Landing.svelte';

  let allTrades = $state([]);
  let loaded = $state(false);
  let status = $state('Loading…');
  let error = $state('');
  let manageOpen = $state(false);
  let landingMsg = $state('');
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine); // A38 session pill

  // Day-notes journal: the selected calendar day + the set of dates carrying a saved note.
  let selectedDate = $state(null);
  let journalDates = $state(new Set());
  // Per-trade metadata (id -> {tags,note,...}) for the tag filter + manage-data table.
  let tradeMeta = $state(new Map());
  // Saved filter views ([{id,name,f}]), persisted to Store meta in the vanilla-compatible shape.
  let savedFilters = $state([]);
  // Cost setup (broker/feed/state/platform), lifted here (A32) so BOTH the cost panel and the
  // curve overlays share it. Persisted to the 'setup' meta.
  let setup = $state({ broker: '', feed: '', stateAbbr: '', platform: 0 });

  // Filters drive the whole dashboard (a shared reactive object). scope = all-time vs the
  // calendar's current month. The cursor (calYear/calMonth) lives here so scope can read it.
  let filters = $state({ scope: 'all', from: '', to: '', root: '', side: '', session: '', tag: '', dows: [] });
  let calYear = $state(new Date().getFullYear());
  let calMonth = $state(new Date().getMonth());

  const inMonth = (t, y, m) => {
    const d = new Date(t.date + 'T00:00:00');
    return d.getFullYear() === y && d.getMonth() === m;
  };
  // RTH = 09:30–16:00 by the exported clock time, else ETH (matches render.js sessionOf).
  const sessionOf = t => {
    const hm = (t.time || '').slice(11, 16);
    return hm && hm >= '09:30' && hm < '16:00' ? 'rth' : 'eth';
  };

  function applyFilters(trades, f) {
    return trades.filter(t => {
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.root && t.root !== f.root) return false;
      if (f.side && t.side !== f.side) return false;
      if (f.session && sessionOf(t) !== f.session) return false;
      if (f.tag) {
        const m = tradeMeta.get(store.tradeId(t));
        if (!m || !(m.tags || []).includes(f.tag)) return false;
      }
      if (f.dows.length && !f.dows.includes(new Date(t.date + 'T00:00:00').getDay())) return false;
      return true;
    });
  }

  // metricsAll = filtered, all-time → feeds the curve + calendar (calendar colors ignore scope).
  // metricsActive = metricsAll, or just the calendar month when scope='month' → feeds the cards,
  // advanced stats, and cost panel. Mirrors the vanilla baseTrades()/activeMetrics() split.
  const filtered = $derived(applyFilters(allTrades, filters));
  const metricsAll = $derived(compute(filtered));
  const metricsActive = $derived(
    filters.scope === 'month' ? compute(filtered.filter(t => inMonth(t, calYear, calMonth))) : metricsAll
  );
  const roots = $derived([...new Set(allTrades.map(t => t.root).filter(Boolean))].sort());
  const tags = $derived([...new Set([...tradeMeta.values()].flatMap(m => m.tags || []))].sort());
  // Cost/tax inputs derived from the setup (feed value is "name|cost"; rate from the STATES table).
  const costInputs = $derived({
    broker: setup.broker,
    platform: setup.platform,
    feedCost: setup.feed ? parseFloat(setup.feed.split('|')[1]) || 0 : 0,
    stateRate: (STATES.find(s => s[0] === setup.stateAbbr) || [, 0])[1] || 0,
  });
  const dateRange = $derived(allTrades.length ? `${allTrades[0].date} → ${allTrades[allTrades.length - 1].date}` : '');

  // Persist the cost setup whenever it changes (after the initial load).
  $effect(() => {
    if (!loaded) return;
    void [setup.broker, setup.feed, setup.stateAbbr, setup.platform];
    store.setMeta('setup', { broker: setup.broker, feed: setup.feed, state: setup.stateAbbr, platform: String(setup.platform) });
  });

  // Seed the dataset once if the backend is empty (seeded surfaces only: staging + demo).
  async function seedIfEmpty() {
    if ((await store.tradeCount()) > 0) return;
    const r = Adapters.parse(demoCSV(), 'tradingview');
    if (r.ok && r.trades.length) {
      await store.addTrades(r.trades);
      await store.setMeta('setup', { broker: DEMO_BROKER, feed: DEMO_FEED, state: DEMO_STATE, platform: '35' });
    }
  }

  async function boot() {
    await loadRefData();
    if (!store.available()) throw new Error('Local storage is unavailable in this browser');
    await store.init();
    if (SEEDED) await seedIfEmpty();
    const trades = await store.getAllTrades();
    allTrades = trades;
    journalDates = await store.journalDates();
    tradeMeta = new Map((await store.allTradeMeta()).map(m => [m.id, m]));
    savedFilters = (await store.getMeta('savedFilters')) || [];
    const su = (await store.getMeta('setup')) || {};
    setup = { broker: su.broker || '', feed: su.feed || '', stateAbbr: su.state || '', platform: Number(su.platform) || 0 };
    const last = trades.length ? trades[trades.length - 1].date : null;
    calYear = last ? +last.slice(0, 4) : new Date().getFullYear();
    calMonth = last ? +last.slice(5, 7) - 1 : new Date().getMonth();
    loaded = true;
    status = '';
    emit('data:loaded', { count: trades.length });
  }

  async function refreshNotes() {
    journalDates = await store.journalDates(); // reassign → reactive
  }

  // After manage-data changes the dataset (import / restore / erase / per-trade edit), reload
  // everything the dashboard derives from.
  async function reloadAll() {
    allTrades = await store.getAllTrades();
    journalDates = await store.journalDates();
    tradeMeta = new Map((await store.allTradeMeta()).map(m => [m.id, m]));
  }

  // App-mode landing: parse + persist a CSV, then the dashboard takes over (allTrades non-empty).
  // platformId overrides auto-detect when the user picks a platform in the landing dropdown.
  async function loadCSV(file, platformId) {
    landingMsg = '';
    const r = Adapters.parse(await file.text(), platformId || undefined);
    if (!r.ok) {
      landingMsg = r.error || 'Could not parse that CSV.';
      return;
    }
    await store.addTrades(r.trades);
    emit('data:imported', { added: r.trades.length });
    await reloadAll();
  }

  function navMonth(delta) {
    let m = calMonth + delta;
    let y = calYear;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    calMonth = m;
    calYear = y;
  }

  // A38: jump the calendar cursor to the most recent trade's month.
  function jumpToLatest() {
    const last = allTrades.length ? allTrades[allTrades.length - 1].date : null;
    if (last) {
      calYear = +last.slice(0, 4);
      calMonth = +last.slice(5, 7) - 1;
    }
  }

  function clearFilters() {
    filters.from = '';
    filters.to = '';
    filters.root = '';
    filters.side = '';
    filters.session = '';
    filters.tag = '';
    filters.dows = [];
  }

  // Saved filter views — persisted in the vanilla-compatible {id,name,f} shape (f.symbol holds the
  // root value, matching render.js + the Store.importAll sanitizer's FILTER_FIELDS).
  async function saveView(name) {
    const f = { from: filters.from, to: filters.to, symbol: filters.root, side: filters.side, session: filters.session, tag: filters.tag, dows: [...filters.dows] };
    const id = Date.now().toString(36) + savedFilters.length;
    savedFilters = [...savedFilters, { id, name: (name || '').trim() || `View ${savedFilters.length + 1}`, f }];
    await store.setMeta('savedFilters', $state.snapshot(savedFilters)); // plain clone — IndexedDB can't clone a $state proxy
  }
  function applyView(sf) {
    const f = sf.f || {};
    filters.from = f.from || '';
    filters.to = f.to || '';
    filters.root = f.symbol || '';
    filters.side = f.side || '';
    filters.session = f.session || '';
    filters.tag = f.tag || '';
    filters.dows = Array.isArray(f.dows) ? [...f.dows] : [];
  }
  async function deleteView(id) {
    savedFilters = savedFilters.filter(s => s.id !== id);
    await store.setMeta('savedFilters', $state.snapshot(savedFilters));
  }

  onMount(() => {
    boot().catch(e => {
      console.error('staging boot failed', e);
      error = String(e && e.message ? e.message : e);
      status = '';
    });
    const on = () => (online = true);
    const off = () => (online = false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });
</script>

<main id="sv-app">
  <header class="topbar">
    <div class="brand">
      Blotterbook <span class="badge">Staging</span>
    </div>
    <div class="meta">
      Svelte&nbsp;5 proving ground · isolated local data{#if dateRange} · {dateRange}{/if}
    </div>
    <div class="topactions">
      <span class="pill" class:off={!online} title={online ? 'Online' : 'Offline'}>{online ? 'online' : 'offline'}</span>
      <a class="link" href="../changelog.html">Changelog</a>
      <a class="link" href="mailto:contact@blotterbook.com?subject=Blotterbook">Contact</a>
      {#if loaded}<button type="button" class="managebtn" onclick={() => (manageOpen = true)}>Manage data</button>{/if}
    </div>
  </header>

  {#if error}
    <p class="msg error" role="alert">Could not start the staging app: {error}</p>
  {:else if loaded && PAGE_MODE === 'app' && !allTrades.length}
    <Landing {setup} onload={loadCSV} msg={landingMsg} />
  {:else if loaded}
    <FilterBar {filters} {roots} {tags} {savedFilters} count={metricsActive.n} onclear={clearFilters} onsave={saveView} onapply={applyView} ondelete={deleteView} />
    <Overview metrics={metricsActive} tradeCount={metricsActive.n} />
    <EquityCurve metrics={metricsAll} {costInputs} {journalDates} {selectedDate} onselect={d => (selectedDate = d)} />
    <CalendarMonth
      metrics={metricsAll}
      year={calYear}
      month={calMonth}
      onnav={navMonth}
      onjump={jumpToLatest}
      {selectedDate}
      {journalDates}
      onselect={d => (selectedDate = d)}
    />
    {#if selectedDate}
      <JournalEditor date={selectedDate} onsaved={refreshNotes} onclose={() => (selectedDate = null)} />
    {/if}
    <AdvancedStats metrics={metricsActive} />
    <CostPanel metrics={metricsActive} {setup} {costInputs} />
    <Definitions />
    <ActivityTerminal />
    <p class="note">
      Svelte 5 app — core dashboard (A32): Overview, performance curve (overlays + day-notes),
      trading calendar, advanced statistics, break-even/cost, filters/scope (incl. session/tag/saved
      views), manage-data, screenshots, activity terminal. Closing the remaining prod-parity gaps
      (A34–A38: export report, stat-card modals, panel/workspace system, Definitions & Caveats,
      Tier-2) before the prod/demo cutover (A33).
    </p>
  {:else}
    <p class="msg">{status}</p>
  {/if}

  {#if manageOpen}
    <ManageData onclose={() => (manageOpen = false)} onchanged={reloadAll} />
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--txt);
    font-family: var(--sans);
  }
  #sv-app {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px 16px 48px;
  }
  .topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 20px;
  }
  .brand {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .badge {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--warn);
    border: 1px solid var(--warn);
    border-radius: 5px;
    padding: 2px 6px;
    vertical-align: middle;
  }
  .meta {
    font-size: 12px;
    color: var(--faint);
    font-family: var(--mono);
  }
  .topactions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pill {
    font-size: 11px;
    font-family: var(--mono);
    color: var(--green);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 9px;
  }
  .pill::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
    margin-right: 5px;
    vertical-align: middle;
  }
  .pill.off {
    color: var(--faint);
  }
  .pill.off::before {
    background: var(--faint);
  }
  .link {
    font-size: 13px;
    color: var(--accent);
    text-decoration: none;
  }
  .link:hover {
    text-decoration: underline;
  }
  .managebtn {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .managebtn:hover {
    border-color: var(--hover-line);
  }
  .msg {
    color: var(--dim);
    padding: 24px 4px;
  }
  .error {
    color: var(--red);
  }
  .note {
    margin-top: 22px;
    font-size: 12px;
    color: var(--faint);
    line-height: 1.5;
  }
</style>
