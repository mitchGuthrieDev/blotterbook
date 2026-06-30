<script lang="ts">
  // Filter + scope bar (A27). Drives the whole dashboard: App applies these filters to the trade
  // set and recomputes metrics. `filters` is a shared reactive object (mutated in place — Svelte 5
  // deep reactivity propagates to App's deriveds). Scope = all-time vs the calendar's current month.
  // Session + tag filters and saved-filter views from the vanilla bar are deferred to a later slice.
  import type { FilterState, SavedFilter } from '../../lib/core/types.ts';
  import * as Select from '$ui/select';
  import { Button } from '$ui/button';

  interface Props {
    filters: FilterState;
    roots: string[];
    tags?: string[];
    savedFilters?: SavedFilter[];
    count?: number;
    onclear?: () => void;
    onsave?: (name: string) => void;
    onapply?: (sf: SavedFilter) => void;
    ondelete?: (id: string) => void;
  }
  let { filters, roots, tags = [], savedFilters = [], count = 0, onclear, onsave = () => {}, onapply = () => {}, ondelete = () => {} }: Props = $props();
  let viewName = $state('');
  const save = () => {
    onsave(viewName);
    viewName = '';
  };
  const SIDES = [
    ['', 'Both sides'],
    ['long', 'Long'],
    ['short', 'Short'],
  ];
  const SESSIONS = [
    ['', 'All sessions'],
    ['rth', 'RTH'],
    ['eth', 'ETH'],
  ];
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  // bits-ui Select treats '' as no-value, so the "All / Both / All sessions / All tags" default
  // (filters.* === '') maps to a sentinel internally (A128). Callers + e2e key off the visible labels.
  const ALL = '__all__';
  // Item arrays double as Root.items so Select.Value resolves labels while the listbox is closed.
  const SIDE_ITEMS = SIDES.map(([v, l]) => ({ value: v || ALL, label: l }));
  const SESSION_ITEMS = SESSIONS.map(([v, l]) => ({ value: v || ALL, label: l }));
  const rootItems = $derived([{ value: ALL, label: 'All' }, ...roots.map(r => ({ value: r, label: r }))]);
  const tagItems = $derived([{ value: ALL, label: 'All tags' }, ...tags.map(t => ({ value: t, label: t }))]);
  const toggleDow = (d: number) => (filters.dows = filters.dows.includes(d) ? filters.dows.filter(x => x !== d) : [...filters.dows, d]);

  // A97 (R18 — promoted to all surfaces, CH16): the scope-toggle definition rides on the control as a
  // tooltip, distributed from the standalone Definitions panel.
  const SCOPE_HELP =
    'All time covers every trade; Calendar month restricts the cards, graph, and statistics to the month shown on the calendar. The calendar always shows the navigated month.';
</script>

<section class="filterbar mb-4 flex flex-wrap items-end gap-x-3 gap-y-2.5 rounded-[10px] border border-line bg-panel px-3.5 py-3">
  <div class="scope flex" role="group" aria-label="Scope" title={SCOPE_HELP}>
    <button
      type="button"
      class="cursor-pointer rounded-l-md border px-3 py-[7px] text-xs {filters.scope === 'all' ? 'border-primary bg-primary font-bold text-bg' : 'border-line bg-panel2 text-dim'}"
      aria-pressed={filters.scope === 'all'}
      onclick={() => (filters.scope = 'all')}>All time</button
    >
    <button
      type="button"
      class="cursor-pointer rounded-r-md border border-l-0 px-3 py-[7px] text-xs {filters.scope === 'month' ? 'border-primary bg-primary font-bold text-bg' : 'border-line bg-panel2 text-dim'}"
      aria-pressed={filters.scope === 'month'}
      onclick={() => (filters.scope = 'month')}>Calendar month</button
    >
  </div>
  <label class="flex flex-col gap-[3px] text-[11px] text-faint"
    >From<input type="date" bind:value={filters.from} class="rounded-md border border-line bg-panel2 px-2 py-1.5 text-[13px] font-sans text-txt focus:border-primary focus:outline-none" /></label
  >
  <label class="flex flex-col gap-[3px] text-[11px] text-faint"
    >To<input type="date" bind:value={filters.to} class="rounded-md border border-line bg-panel2 px-2 py-1.5 text-[13px] font-sans text-txt focus:border-primary focus:outline-none" /></label
  >
  <div class="selfield flex flex-col gap-[3px] text-[11px] text-faint">
    <span>Symbol</span>
    <Select.Root type="single" value={filters.root || ALL} onValueChange={v => (filters.root = v === ALL ? '' : v)} items={rootItems}>
      <Select.Trigger aria-label="Symbol"><Select.Value /></Select.Trigger>
      <Select.Content>
        {#each rootItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
      </Select.Content>
    </Select.Root>
  </div>
  <div class="selfield">
    <span>Side</span>
    <Select.Root type="single" value={filters.side || ALL} onValueChange={v => (filters.side = v === ALL ? '' : v)} items={SIDE_ITEMS}>
      <Select.Trigger aria-label="Side"><Select.Value /></Select.Trigger>
      <Select.Content>
        {#each SIDE_ITEMS as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
      </Select.Content>
    </Select.Root>
  </div>
  <div class="selfield">
    <span>Session</span>
    <Select.Root type="single" value={filters.session || ALL} onValueChange={v => (filters.session = v === ALL ? '' : v)} items={SESSION_ITEMS}>
      <Select.Trigger aria-label="Session"><Select.Value /></Select.Trigger>
      <Select.Content>
        {#each SESSION_ITEMS as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
      </Select.Content>
    </Select.Root>
  </div>
  {#if tags.length}
    <div class="selfield">
      <span>Tag</span>
      <Select.Root type="single" value={filters.tag || ALL} onValueChange={v => (filters.tag = v === ALL ? '' : v)} items={tagItems}>
        <Select.Trigger aria-label="Tag"><Select.Value /></Select.Trigger>
        <Select.Content>
          {#each tagItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
  {/if}
  <div class="dows flex gap-[3px] self-end" role="group" aria-label="Day of week">
    {#each DOW as d, i (d)}
      <button
        type="button"
        class="cursor-pointer rounded-[5px] border px-[7px] py-1.5 font-mono text-[11px] {filters.dows.includes(i) ? 'border-primary bg-primary font-bold text-bg' : 'border-line bg-panel2 text-dim'}"
        aria-pressed={filters.dows.includes(i)}
        onclick={() => toggleDow(i)}>{d}</button
      >
    {/each}
  </div>
  <span class="count ml-auto self-center font-mono text-xs text-faint">{count} trade{count === 1 ? '' : 's'}</span>
  <Button variant="outline" class="clear text-dim" onclick={onclear}>Clear</Button>
</section>

<section class="saved mb-4 mt-[-8px] flex flex-wrap items-center gap-2">
  <input
    class="vname rounded-md border border-line bg-panel2 px-2 py-1.5 text-xs text-txt"
    type="text"
    placeholder="Name this view…"
    bind:value={viewName}
    onkeydown={e => e.key === 'Enter' && save()}
  />
  <Button size="sm" class="savebtn" onclick={save}>Save view</Button>
  {#each savedFilters as sf (sf.id)}
    <span class="chip inline-flex items-stretch overflow-hidden rounded-md border border-line">
      <button type="button" class="apply cursor-pointer border-0 bg-panel px-2.5 py-1.5 text-xs text-primary" onclick={() => onapply(sf)}>{sf.name}</button>
      <button
        type="button"
        class="del cursor-pointer border-0 border-l border-line bg-panel px-2 py-1.5 text-faint hover:text-red"
        aria-label="Delete view {sf.name}"
        onclick={() => ondelete(sf.id)}>×</button
      >
    </span>
  {/each}
</section>

