<script lang="ts">
  // Cost setup selectors (broker / data-feed / state / platform $) — the inputs that drive costModel().
  // Reused by the dashboard Break-even & Cost module and the empty-state onboarding. Reports each change
  // back through `onsave` (the app persists via dash.saveSetup); disabled on demo (never mutates).
  import { BROKERS, BROKER_ORDER, BROKER_FEEDS, STATES } from '../../lib/core/core.ts';
  import type { AppSetup, StateRow } from '../../lib/core/types.ts';
  import * as Select from '$lib/components/ui/select';

  let {
    setup,
    onsave,
    disabled = false,
    showPlatform = true,
  }: {
    setup: AppSetup;
    onsave: (s: AppSetup) => void;
    disabled?: boolean;
    showPlatform?: boolean;
  } = $props();

  const feedGroups = $derived(BROKER_FEEDS[setup.broker] || {});
  const stateOpts = $derived(STATES.slice().sort((a: StateRow, b: StateRow) => (a[2] < b[2] ? -1 : 1)));
  const brokerItems = $derived(BROKER_ORDER.map(k => ({ value: k, label: BROKERS[k].name })));
  const feedItems = $derived(
    Object.entries(feedGroups).flatMap(([, list]) => list.map(([name, c]) => ({ value: `${name}|${c}`, label: `${name} — $${c}` })))
  );
  const stateItems = $derived(stateOpts.map(([a, , n]) => ({ value: a, label: n })));

  const commit = (patch: Partial<AppSetup>) => onsave({ ...setup, ...patch });
  // Broker change resets the feed (feed options depend on broker — matches the vanilla populateFeeds()).
  const onBroker = (v: string) => commit({ broker: v, feed: '' });
</script>

<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-[10px]">
  <label class="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
    <span>Broker</span>
    <Select.Root type="single" value={setup.broker} onValueChange={onBroker} items={brokerItems} {disabled}>
      <Select.Trigger class="w-full min-w-0" aria-label="Broker"><Select.Value placeholder="— Select broker —" /></Select.Trigger>
      <Select.Content>
        {#each brokerItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
      </Select.Content>
    </Select.Root>
  </label>

  <label class="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
    <span>Data feed</span>
    <Select.Root type="single" value={setup.feed} onValueChange={v => commit({ feed: v })} items={feedItems} {disabled}>
      <Select.Trigger class="w-full min-w-0" aria-label="Data feed"><Select.Value placeholder="— Select data feed —" /></Select.Trigger>
      <Select.Content>
        {#each Object.entries(feedGroups) as [grp, list] (grp)}
          <Select.Group>
            <Select.Label class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{grp}</Select.Label>
            {#each list as [name, c] (name)}<Select.Item value={`${name}|${c}`} label={`${name} — $${c}`} />{/each}
          </Select.Group>
        {/each}
      </Select.Content>
    </Select.Root>
  </label>

  <label class="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
    <span>State (tax)</span>
    <Select.Root type="single" value={setup.stateAbbr} onValueChange={v => commit({ stateAbbr: v })} items={stateItems} {disabled}>
      <Select.Trigger class="w-full min-w-0" aria-label="State"><Select.Value placeholder="— Select state —" /></Select.Trigger>
      <Select.Content>
        {#each stateItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
      </Select.Content>
    </Select.Root>
  </label>

  {#if showPlatform}
    <label class="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
      <span>Platform ($/mo)</span>
      <input
        type="number"
        min="0"
        step="1"
        value={setup.platform}
        {disabled}
        oninput={e => commit({ platform: Number((e.currentTarget as HTMLInputElement).value) || 0 })}
        class="rounded-md border border-border bg-secondary p-2 text-[13px] text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
      />
    </label>
  {/if}
</div>
