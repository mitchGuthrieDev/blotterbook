<script>
  // Break-even & cost (A27). REUSES costModel() verbatim (A29) — no core.js change (the param
  // refactor is deferred to Phase 4). costModel reads its inputs from DOM elements by id
  // (#c_broker/#c_feed/#c_state_sel/#c_tv), so this panel renders exactly those controls (in the
  // formats core's curBroker/feedCost/stateRate/numIn expect) and calls costModel() against them.
  // Setup is loaded from / persisted to the isolated staging Store ('setup' meta), seeded already.
  import { onMount } from 'svelte';
  import { costModel, BROKERS, BROKER_ORDER, BROKER_FEEDS, STATES, usd, money } from '../../core.js';
  import { Store } from '../../store.js';

  let { metrics } = $props();

  let broker = $state('');
  let feed = $state('');
  let stateAbbr = $state('');
  let platform = $state(0);
  let ready = $state(false);
  let cost = $state(null);

  const feedGroups = $derived(BROKER_FEEDS[broker] || {});
  const stateOpts = $derived(STATES.slice().sort((a, b) => (a[2] < b[2] ? -1 : 1)));
  const pct = v => (v * 100).toFixed(1) + '%';

  onMount(async () => {
    const s = (await Store.getMeta('setup')) || {};
    broker = s.broker || '';
    feed = s.feed || '';
    stateAbbr = s.state || '';
    platform = Number(s.platform) || 0;
    ready = true;
  });

  // Recompute (and persist) whenever a setup control or the metrics change. Runs post-render, so
  // the bound <select>/<input> DOM already holds the new values that costModel() reads by id.
  $effect(() => {
    if (!ready || !metrics) return;
    void [broker, feed, stateAbbr, platform, metrics];
    cost = costModel(metrics);
    Store.setMeta('setup', { broker, feed, state: stateAbbr, platform: String(platform) });
  });

  function onBroker(e) {
    broker = e.currentTarget.value;
    feed = ''; // feed options depend on broker — reset like the vanilla populateFeeds()
  }
</script>

<section class="panel costpanel">
  <div class="phead"><h2>Break-even &amp; Cost</h2></div>

  <div class="setup">
    <label>
      <span>Broker</span>
      <select id="c_broker" value={broker} onchange={onBroker}>
        <option value="">— Select broker —</option>
        {#each BROKER_ORDER as k (k)}<option value={k}>{BROKERS[k].name}</option>{/each}
      </select>
    </label>
    <label>
      <span>Data feed</span>
      <select id="c_feed" bind:value={feed}>
        <option value="">— Select data feed —</option>
        {#each Object.entries(feedGroups) as [grp, list] (grp)}
          <optgroup label={grp}>
            {#each list as [name, c] (name)}<option value={`${name}|${c}`} data-cost={c}>{name} — ${c}</option>{/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <label>
      <span>State</span>
      <select id="c_state_sel" bind:value={stateAbbr}>
        <option value="">— Select state —</option>
        {#each stateOpts as [a, r, n] (a)}<option value={a} data-rate={r}>{n}</option>{/each}
      </select>
    </label>
    <label>
      <span>Platform fee ($/mo)</span>
      <input id="c_tv" type="number" min="0" step="1" bind:value={platform} />
    </label>
  </div>

  {#if cost}
    <div class="breakdown">
      <div class="takehome" class:neg={cost.afterTax < 0}>
        <span class="lbl">Estimated take-home</span>
        <span class="val" data-cost-takehome>{usd(cost.afterTax)}</span>
      </div>
      <div class="lines">
        <div class="line"><span>Gross P&amp;L</span><span class:neg={cost.gross < 0}>{usd(cost.gross)}</span></div>
        <div class="line"><span>Commissions ({cost.contracts} contracts)</span><span class="neg">-{money(cost.totalComm)}</span></div>
        <div class="line"><span>Platform + data ({money(cost.fixedMo)}/mo × {cost.months} mo)</span><span class="neg">-{money(cost.fixedPeriod)}</span></div>
        <div class="line sub"><span>Pre-tax net</span><span class:neg={cost.netPreTax < 0}>{usd(cost.netPreTax)}</span></div>
        <div class="line"><span>Est. tax (Section 1256 blend, {pct(cost.tEff)})</span><span class="neg">-{money(cost.tax)}</span></div>
        <div class="line"><span>Break-even / trade</span><span>{money(cost.bePer)}</span></div>
      </div>
    </div>

    {#if cost.bySym.length}
      <table class="bysym">
        <thead><tr><th>Symbol</th><th>Trades</th><th>Contracts</th><th>Rate/side</th><th>Commission</th></tr></thead>
        <tbody>
          {#each cost.bySym as r (r.root)}
            <tr>
              <td>{r.root}{#if !r.known}<span class="est" title="Exchange fee estimated (root not in fee table)">*</span>{/if}</td>
              <td>{r.count}</td>
              <td>{r.qty}</td>
              <td>{money(r.rate)}</td>
              <td>{money(r.total)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</section>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px 16px;
    margin-top: 16px;
  }
  .phead {
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
    font-weight: 700;
  }
  .setup {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--faint);
  }
  select,
  input {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 7px 8px;
    font-size: 13px;
    font-family: var(--sans);
  }
  input {
    font-family: var(--mono);
  }
  select:focus,
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .takehome {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding-bottom: 10px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .takehome .lbl {
    font-size: 12px;
    color: var(--dim);
  }
  .takehome .val {
    font-family: var(--mono);
    font-size: 24px;
    font-weight: 700;
    color: var(--take);
  }
  .takehome.neg .val {
    color: var(--red);
  }
  .lines {
    display: grid;
    gap: 2px;
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    font-size: 13px;
    border-bottom: 1px solid var(--line);
  }
  .line span:first-child {
    color: var(--dim);
  }
  .line span:last-child {
    font-family: var(--mono);
    font-weight: 700;
    color: var(--txt);
  }
  .line .neg {
    color: var(--red);
  }
  .line.sub span:last-child {
    color: var(--txt);
  }
  .bysym {
    width: 100%;
    border-collapse: collapse;
    margin-top: 14px;
    font-size: 12px;
  }
  .bysym th {
    text-align: right;
    color: var(--faint);
    font-weight: 600;
    padding: 4px 8px;
    border-bottom: 1px solid var(--line);
  }
  .bysym th:first-child {
    text-align: left;
  }
  .bysym td {
    text-align: right;
    padding: 5px 8px;
    font-family: var(--mono);
    border-bottom: 1px solid var(--line);
  }
  .bysym td:first-child {
    text-align: left;
  }
  .est {
    color: var(--warn);
    margin-left: 2px;
  }
</style>
