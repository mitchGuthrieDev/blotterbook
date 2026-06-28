<script lang="ts">
  // App-mode landing (A32). Shown only on the `app` surface when there's no data yet (staging/demo
  // seed instead). Set up costs (broker/feed/state/platform — bound to the shared setup) and load a
  // balance-history CSV; a successful load populates the Store and App switches to the dashboard.
  import { BROKERS, BROKER_ORDER, BROKER_FEEDS, STATES } from '../../lib/core.ts';
  import type { AppSetup } from '../../lib/types.ts';
  import { Adapters } from '../../lib/adapters.ts';

  interface Props {
    setup: AppSetup;
    onload: (file: File, platformId: string) => void;
    msg?: string;
  }
  let { setup, onload, msg = '' }: Props = $props();

  const feedGroups = $derived(BROKER_FEEDS[setup.broker] || {});
  const stateOpts = $derived(STATES.slice().sort((a, b) => (a[2] < b[2] ? -1 : 1)));
  const ready = $derived(!!(setup.broker && setup.feed && setup.stateAbbr));
  const platforms = Adapters.list(); // [{id,label,beta}] for the override dropdown

  let fileInput: HTMLInputElement;
  let platformId = $state(''); // '' = auto-detect
  function onBroker(e: Event) {
    setup.broker = (e.currentTarget as HTMLSelectElement).value;
    setup.feed = '';
  }
  function pick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (f) onload(f, platformId);
  }
</script>

<section class="landing">
  <h1>Blotterbook</h1>
  <p class="sub">Set up your trading costs, then load a balance-history CSV (TradingView and others) to begin. Everything stays in your browser.</p>

  <div class="setup">
    <label>
      <span>Broker</span>
      <select value={setup.broker} onchange={onBroker}>
        <option value="">— Select broker —</option>
        {#each BROKER_ORDER as k (k)}<option value={k}>{BROKERS[k].name}</option>{/each}
      </select>
    </label>
    <label>
      <span>Data feed</span>
      <select bind:value={setup.feed}>
        <option value="">— Select data feed —</option>
        {#each Object.entries(feedGroups) as [grp, list] (grp)}
          <optgroup label={grp}>
            {#each list as [name, c] (name)}<option value={`${name}|${c}`}>{name} — ${c}</option>{/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <label>
      <span>State</span>
      <select bind:value={setup.stateAbbr}>
        <option value="">— Select state —</option>
        {#each stateOpts as [a, r, n] (a)}<option value={a}>{n}</option>{/each}
      </select>
    </label>
    <label>
      <span>Platform fee ($/mo)</span>
      <input type="number" min="0" step="1" bind:value={setup.platform} />
    </label>
  </div>

  <div class="load">
    <button type="button" class="cta" onclick={() => fileInput.click()}>Load CSV</button>
    <label class="platform">
      <span>Platform</span>
      <select bind:value={platformId}>
        <option value="">Auto-detect</option>
        {#each platforms as p (p.id)}<option value={p.id}>{p.label}{p.beta ? ' (beta)' : ''}</option>{/each}
      </select>
    </label>
    <input bind:this={fileInput} type="file" accept=".csv,text/csv" hidden onchange={pick} />
    {#if !ready}<span class="gate">Tip: pick broker, data feed and state so the cost/tax model is complete.</span>{/if}
  </div>
  {#if msg}<p class="msg" role="alert">{msg}</p>{/if}
</section>

<style>
  .landing {
    max-width: 640px;
    margin: 6vh auto 0;
  }
  h1 {
    margin: 0 0 6px;
    font-size: 28px;
  }
  .sub {
    color: var(--dim);
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 22px;
  }
  .setup {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    padding: 16px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
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
    padding: 8px;
    font-size: 13px;
    font-family: var(--sans);
  }
  select:focus,
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .load {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 18px;
  }
  .cta {
    background: var(--accent);
    color: #0d1014;
    border: 0;
    border-radius: 8px;
    padding: 11px 22px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  .gate {
    font-size: 12px;
    color: var(--faint);
  }
  .msg {
    margin-top: 12px;
    color: var(--red);
    font-size: 13px;
  }
</style>
