<script lang="ts">
  // App-mode landing (A32). Shown only on the `app` surface when there's no data yet (staging/demo
  // seed instead). Set up costs (broker/feed/state/platform — bound to the shared setup) and load a
  // balance-history CSV; a successful load populates the Store and App switches to the dashboard.
  import { BROKERS, BROKER_ORDER, BROKER_FEEDS, STATES } from '../../lib/core.ts';
  import type { AppSetup } from '../../lib/types.ts';
  import { Adapters } from '../../lib/adapters.ts';
  import * as Select from '$ui/select';

  interface Props {
    setup: AppSetup;
    onload: (file: File, platformId: string) => void;
    msg?: string;
    /** A89: when false (admin showBetaAdapters flag off), hide beta adapters from the manual picker. */
    showBeta?: boolean;
  }
  let { setup, onload, msg = '', showBeta = true }: Props = $props();

  const feedGroups = $derived(BROKER_FEEDS[setup.broker] || {});
  const stateOpts = $derived(STATES.slice().sort((a, b) => (a[2] < b[2] ? -1 : 1)));
  const ready = $derived(!!(setup.broker && setup.feed && setup.stateAbbr));
  // [{id,label,beta}] for the override dropdown — beta adapters are hidden when the flag is off (A89).
  const platforms = $derived(Adapters.list().filter(p => showBeta || !p.beta));

  // A128: option/label arrays double as Root.items (Select.Value resolves labels while closed).
  const brokerItems = $derived(BROKER_ORDER.map(k => ({ value: k, label: BROKERS[k].name })));
  const feedItems = $derived(
    Object.entries(feedGroups).flatMap(([, list]) => list.map(([name, c]) => ({ value: `${name}|${c}`, label: `${name} — $${c}` })))
  );
  const stateItems = $derived(stateOpts.map(([a, , n]) => ({ value: a, label: n })));
  // The platform override's "Auto-detect" default is the empty string; bits-ui treats '' as no-value,
  // so map it to a sentinel internally.
  const AUTO = '__auto__';
  const platformItems = $derived([
    { value: AUTO, label: 'Auto-detect' },
    ...platforms.map(p => ({ value: p.id, label: `${p.label}${p.beta ? ' (beta)' : ''}` })),
  ]);

  let fileInput: HTMLInputElement;
  let platformId = $state(''); // '' = auto-detect
  function onBroker(v: string) {
    setup.broker = v;
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
    <div class="field">
      <span>Broker</span>
      <Select.Root type="single" value={setup.broker} onValueChange={onBroker} items={brokerItems}>
        <Select.Trigger aria-label="Broker"><Select.Value placeholder="— Select broker —" /></Select.Trigger>
        <Select.Content>
          {#each brokerItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="field">
      <span>Data feed</span>
      <Select.Root type="single" bind:value={setup.feed} items={feedItems}>
        <Select.Trigger aria-label="Data feed"><Select.Value placeholder="— Select data feed —" /></Select.Trigger>
        <Select.Content>
          {#each Object.entries(feedGroups) as [grp, list] (grp)}
            <Select.Group>
              <Select.GroupHeading class="px-2 py-1 text-[10px] uppercase tracking-wide text-faint">{grp}</Select.GroupHeading>
              {#each list as [name, c] (name)}<Select.Item value={`${name}|${c}`} label={`${name} — $${c}`} />{/each}
            </Select.Group>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="field">
      <span>State</span>
      <Select.Root type="single" bind:value={setup.stateAbbr} items={stateItems}>
        <Select.Trigger aria-label="State"><Select.Value placeholder="— Select state —" /></Select.Trigger>
        <Select.Content>
          {#each stateItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <label>
      <span>Platform fee ($/mo)</span>
      <input type="number" min="0" step="1" bind:value={setup.platform} />
    </label>
  </div>

  <div class="load">
    <button type="button" class="cta" onclick={() => fileInput.click()}>Load CSV</button>
    <div class="platform field">
      <span>Platform</span>
      <Select.Root
        type="single"
        value={platformId || AUTO}
        onValueChange={v => (platformId = v === AUTO ? '' : v)}
        items={platformItems}
      >
        <Select.Trigger aria-label="Platform"><Select.Value /></Select.Trigger>
        <Select.Content>
          {#each platformItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
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
  label,
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--faint);
  }
  input {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px;
    font-size: 13px;
    font-family: var(--sans);
  }
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
