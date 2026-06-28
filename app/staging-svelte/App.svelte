<script>
  // Staging app root (A27). Boots by REUSING the vanilla pure-logic core verbatim (A29):
  // loadRefData + Store (isolated staging IndexedDB) + Adapters + compute(). The view layer
  // (this component + children) is the only thing rewritten in Svelte. demoCSV is imported from
  // data.js (no logic duplicated); the seed mirrors main.js's seedStagingIfEmpty().
  import { onMount } from 'svelte';
  import { loadRefData, compute, emit, DEMO_BROKER, DEMO_FEED, DEMO_STATE } from '../core.js';
  import { Store } from '../store.js';
  import { Adapters } from '../adapters.js';
  import { demoCSV } from '../sampledata.js';
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

  // Filters drive the whole dashboard (a shared reactive object). scope = all-time vs the
  // calendar's current month. The cursor (calYear/calMonth) lives here so scope can read it.
  let filters = $state({ scope: 'all', from: '', to: '', root: '', side: '' });
  let calYear = $state(new Date().getFullYear());
  let calMonth = $state(new Date().getMonth());

  const inMonth = (t, y, m) => {
    const d = new Date(t.date + 'T00:00:00');
    return d.getFullYear() === y && d.getMonth() === m;
  };

  function applyFilters(trades, f) {
    return trades.filter(t => {
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.root && t.root !== f.root) return false;
      if (f.side && t.side !== f.side) return false;
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
  const dateRange = $derived(allTrades.length ? `${allTrades[0].date} → ${allTrades[allTrades.length - 1].date}` : '');

  // Seed the isolated staging DB once (same dataset + setup as the vanilla seedStagingIfEmpty).
  async function seedIfEmpty() {
    if ((await Store.tradeCount()) > 0) return;
    const r = Adapters.parse(demoCSV(), 'tradingview');
    if (r.ok && r.trades.length) {
      await Store.addTrades(r.trades);
      await Store.setMeta('setup', { broker: DEMO_BROKER, feed: DEMO_FEED, state: DEMO_STATE, platform: '35' });
    }
  }

  async function boot() {
    await loadRefData();
    if (!Store.available()) throw new Error('IndexedDB is unavailable in this browser');
    await Store.init();
    await seedIfEmpty();
    const trades = await Store.getAllTrades();
    allTrades = trades;
    journalDates = await Store.journalDates();
    const last = trades.length ? trades[trades.length - 1].date : null;
    calYear = last ? +last.slice(0, 4) : new Date().getFullYear();
    calMonth = last ? +last.slice(5, 7) - 1 : new Date().getMonth();
    loaded = true;
    status = '';
    emit('data:loaded', { count: trades.length });
  }

  async function refreshNotes() {
    journalDates = await Store.journalDates(); // reassign → reactive
  }

  // After manage-data changes the dataset (import / restore / erase / per-trade edit), reload
  // everything the dashboard derives from.
  async function reloadAll() {
    allTrades = await Store.getAllTrades();
    journalDates = await Store.journalDates();
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
    <FilterBar {filters} {roots} onclear={clearFilters} />
    <Overview metrics={metricsActive} tradeCount={metricsActive.n} />
    <EquityCurve metrics={metricsAll} />
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
