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
  import { loadRefData, compute, emit, PAGE_MODE, DEMO_BROKER, DEMO_FEED, DEMO_STATE } from '../core.js';
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

  let allTrades = $state([]);
  let loaded = $state(false);
  let status = $state('Loading…');
  let error = $state('');
  let manageOpen = $state(false);

  // Day-notes journal: the selected calendar day + the set of dates carrying a saved note.
  let selectedDate = $state(null);
  let journalDates = $state(new Set());
  // Per-trade metadata (id -> {tags,note,...}) for the tag filter + manage-data table.
  let tradeMeta = $state(new Map());
  // Saved filter views ([{id,name,f}]), persisted to Store meta in the vanilla-compatible shape.
  let savedFilters = $state([]);

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
  const dateRange = $derived(allTrades.length ? `${allTrades[0].date} → ${allTrades[allTrades.length - 1].date}` : '');

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
    await store.setMeta('savedFilters', savedFilters);
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
    await store.setMeta('savedFilters', savedFilters);
  }

  onMount(() => {
    boot().catch(e => {
      console.error('staging boot failed', e);
      error = String(e && e.message ? e.message : e);
      status = '';
    });
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
    {#if loaded}<button type="button" class="managebtn" onclick={() => (manageOpen = true)}>Manage data</button>{/if}
  </header>

  {#if error}
    <p class="msg error" role="alert">Could not start the staging app: {error}</p>
  {:else if loaded}
    <FilterBar {filters} {roots} {tags} {savedFilters} onclear={clearFilters} onsave={saveView} onapply={applyView} ondelete={deleteView} />
    <Overview metrics={metricsActive} tradeCount={metricsActive.n} />
    <EquityCurve metrics={metricsAll} {journalDates} {selectedDate} onselect={d => (selectedDate = d)} />
    <CalendarMonth
      metrics={metricsAll}
      year={calYear}
      month={calMonth}
      onnav={navMonth}
      {selectedDate}
      {journalDates}
      onselect={d => (selectedDate = d)}
    />
    {#if selectedDate}
      <JournalEditor date={selectedDate} onsaved={refreshNotes} onclose={() => (selectedDate = null)} />
    {/if}
    <AdvancedStats metrics={metricsActive} />
    <CostPanel metrics={metricsActive} />
    <ActivityTerminal />
    <p class="note">
      A27 staging migration: Overview, performance curve, trading calendar (with day notes),
      advanced statistics, break-even/cost, filters/scope, manage-data and the activity terminal are
      all live in Svelte 5. Next up (ADR-001 Phase 4): migrate prod + demo, then the source-tree
      reorg (A30).
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
