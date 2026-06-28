<script>
  // Staging app root (A27). Boots by REUSING the vanilla pure-logic core verbatim (A29):
  // loadRefData + Store (isolated staging IndexedDB) + Adapters + compute(). The view layer
  // (this component + children) is the only thing rewritten in Svelte. demoCSV is imported from
  // data.js (no logic duplicated); the seed mirrors main.js's seedStagingIfEmpty().
  import { onMount } from 'svelte';
  import { loadRefData, compute, DEMO_BROKER, DEMO_FEED, DEMO_STATE } from '../core.js';
  import { Store } from '../store.js';
  import { Adapters } from '../adapters.js';
  import { demoCSV } from '../sampledata.js';
  import Overview from './components/Overview.svelte';
  import EquityCurve from './components/EquityCurve.svelte';
  import CalendarMonth from './components/CalendarMonth.svelte';

  let metrics = $state(null);
  let tradeCount = $state(0);
  let dateRange = $state('');
  let status = $state('Loading…');
  let error = $state('');

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
    tradeCount = trades.length;
    metrics = compute(trades);
    dateRange = trades.length ? `${metrics.firstDate} → ${metrics.lastDate}` : '';
    status = '';
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
  </header>

  {#if error}
    <p class="msg error" role="alert">Could not start the staging app: {error}</p>
  {:else if metrics}
    <Overview {metrics} {tradeCount} />
    <EquityCurve {metrics} />
    <CalendarMonth {metrics} />
    <p class="note">
      Migration in progress (A27): Overview, performance curve and trading calendar are live in
      Svelte. Advanced stats, break-even, journal and manage-data are being ported next.
    </p>
  {:else}
    <p class="msg">{status}</p>
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
