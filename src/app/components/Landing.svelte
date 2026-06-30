<script lang="ts">
  // App-mode landing (A32). Shown only on the `app` surface when there's no data yet (staging/demo
  // seed instead). Set up costs (broker/feed/state/platform — bound to the shared setup) and load a
  // balance-history CSV; a successful load populates the Store and App switches to the dashboard.
  import { BROKERS, BROKER_ORDER, BROKER_FEEDS, STATES } from '../../lib/core/core.ts';
  import type { AppSetup } from '../../lib/core/types.ts';
  import { Adapters } from '../../lib/core/adapters.ts';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';

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

<section class="landing mx-auto mt-[6vh] max-w-[640px]">
  <h1 class="m-0 mb-1.5 text-[28px]">Blotterbook</h1>
  <p class="mt-0 mb-[22px] text-[14px] leading-[1.5] text-muted-foreground">Set up your trading costs, then load a balance-history CSV (TradingView and others) to begin. Everything stays in your browser.</p>

  <div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 rounded-[10px] border border-border bg-card p-4">
    <div class="field flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>Broker</span>
      <Select.Root type="single" value={setup.broker} onValueChange={onBroker} items={brokerItems}>
        <Select.Trigger aria-label="Broker"><Select.Value placeholder="— Select broker —" /></Select.Trigger>
        <Select.Content>
          {#each brokerItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="field flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>Data feed</span>
      <Select.Root type="single" bind:value={setup.feed} items={feedItems}>
        <Select.Trigger aria-label="Data feed"><Select.Value placeholder="— Select data feed —" /></Select.Trigger>
        <Select.Content>
          {#each Object.entries(feedGroups) as [grp, list] (grp)}
            <Select.Group>
              <Select.Label class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{grp}</Select.Label>
              {#each list as [name, c] (name)}<Select.Item value={`${name}|${c}`} label={`${name} — $${c}`} />{/each}
            </Select.Group>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="field flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>State</span>
      <Select.Root type="single" bind:value={setup.stateAbbr} items={stateItems}>
        <Select.Trigger aria-label="State"><Select.Value placeholder="— Select state —" /></Select.Trigger>
        <Select.Content>
          {#each stateItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <label class="flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>Platform fee ($/mo)</span>
      <input type="number" min="0" step="1" bind:value={setup.platform} class="rounded-md border border-border bg-secondary p-2 text-[13px] font-sans text-foreground focus:border-primary focus:outline-none" />
    </label>
  </div>

  <div class="mt-[18px] flex items-center gap-[14px]">
    <Button size="lg" onclick={() => fileInput.click()}>Load CSV</Button>
    <div class="field flex flex-col gap-1 text-[11px] text-muted-foreground">
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
    {#if !ready}<span class="text-[12px] text-muted-foreground">Tip: pick broker, data feed and state so the cost/tax model is complete.</span>{/if}
  </div>
  {#if msg}<p class="mt-3 text-[13px] text-destructive" role="alert">{msg}</p>{/if}
</section>

