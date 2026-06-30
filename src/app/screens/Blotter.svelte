<script lang="ts" module>
  // A single blotter row. The wired staging app builds these from real trades; entry/exit prices,
  // hold time and fees aren't on every platform's export, so they're optional (rendered as "—").
  export type BlotterRow = {
    id: string;
    date: string;
    time: string;
    sym: string;
    side: 'Long' | 'Short';
    qty: number;
    entry?: number;
    exit?: number;
    holdMin?: number;
    pnl: number;
    fees?: number;
    tags: string[];
    note: boolean;
    session: 'RTH' | 'ETH';
  };
</script>

<script lang="ts">
  // Blotter — a full-width, feature-rich trade table on the shadcn-svelte primitives (Table/Badge/
  // Checkbox/Input/Card + Select/Popover/Button). Row click → a slide-over detail drawer; click-to-sort
  // headers, search + side filter, column-group toggle, group-by (day/symbol) with subtotals,
  // bulk-select, footer totals. Rows come from the `rows` prop (real trades on staging); the default
  // is the /dev mock for the preview harness. Color only in the P&L.
  import { Search, ArrowUpDown, ChevronUp, Columns3, X, Tag, Trash2, Paperclip, ImagePlus } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import * as Select from '$lib/components/ui/select';
  import * as Popover from '$lib/components/ui/popover';
  import { fade, fly } from 'svelte/transition';

  const MOCK: BlotterRow[] = [
    { id: 't1', date: '2026-06-24', time: '09:34', sym: 'ES', side: 'Long', qty: 2, entry: 5482.25, exit: 5486.0, holdMin: 12, pnl: 375, fees: 4.7, tags: ['breakout'], note: true, session: 'RTH' },
    { id: 't2', date: '2026-06-24', time: '10:18', sym: 'NQ', side: 'Short', qty: 1, entry: 19840.5, exit: 19852.0, holdMin: 7, pnl: -230, fees: 2.4, tags: ['fade'], note: false, session: 'RTH' },
    { id: 't3', date: '2026-06-24', time: '11:46', sym: 'ES', side: 'Long', qty: 3, entry: 5489.0, exit: 5492.75, holdMin: 21, pnl: 562, fees: 7.05, tags: ['trend', 'A+'], note: true, session: 'RTH' },
    { id: 't4', date: '2026-06-24', time: '13:02', sym: 'CL', side: 'Short', qty: 1, entry: 81.42, exit: 81.18, holdMin: 33, pnl: 240, fees: 2.6, tags: [], note: false, session: 'RTH' },
    { id: 't5', date: '2026-06-25', time: '09:31', sym: 'ES', side: 'Long', qty: 2, entry: 5494.5, exit: 5491.0, holdMin: 9, pnl: -350, fees: 4.7, tags: ['breakout'], note: false, session: 'RTH' },
    { id: 't6', date: '2026-06-25', time: '10:05', sym: 'NQ', side: 'Long', qty: 1, entry: 19860.0, exit: 19878.5, holdMin: 14, pnl: 370, fees: 2.4, tags: ['trend'], note: true, session: 'RTH' },
    { id: 't7', date: '2026-06-25', time: '12:20', sym: 'GC', side: 'Long', qty: 1, entry: 2412.3, exit: 2415.1, holdMin: 41, pnl: 280, fees: 2.9, tags: ['swing'], note: false, session: 'RTH' },
    { id: 't8', date: '2026-06-25', time: '14:48', sym: 'ES', side: 'Short', qty: 2, entry: 5498.25, exit: 5495.5, holdMin: 18, pnl: 275, fees: 4.7, tags: [], note: false, session: 'ETH' },
    { id: 't9', date: '2026-06-26', time: '09:38', sym: 'NQ', side: 'Short', qty: 1, entry: 19905.0, exit: 19921.0, holdMin: 6, pnl: -320, fees: 2.4, tags: ['fade', 'rev'], note: true, session: 'RTH' },
    { id: 't10', date: '2026-06-26', time: '10:52', sym: 'ES', side: 'Long', qty: 3, entry: 5501.0, exit: 5503.25, holdMin: 16, pnl: 337, fees: 7.05, tags: ['trend'], note: false, session: 'RTH' },
    { id: 't11', date: '2026-06-26', time: '11:30', sym: 'CL', side: 'Long', qty: 2, entry: 80.95, exit: 80.74, holdMin: 25, pnl: -420, fees: 5.2, tags: [], note: false, session: 'RTH' },
    { id: 't12', date: '2026-06-26', time: '13:15', sym: 'MES', side: 'Long', qty: 5, entry: 5502.5, exit: 5504.0, holdMin: 11, pnl: 188, fees: 3.5, tags: ['scalp'], note: false, session: 'RTH' },
    { id: 't13', date: '2026-06-30', time: '09:33', sym: 'ES', side: 'Long', qty: 2, entry: 5510.0, exit: 5514.5, holdMin: 19, pnl: 450, fees: 4.7, tags: ['breakout', 'A+'], note: true, session: 'RTH' },
    { id: 't14', date: '2026-06-30', time: '10:41', sym: 'NQ', side: 'Long', qty: 1, entry: 19950.0, exit: 19944.0, holdMin: 8, pnl: -120, fees: 2.4, tags: [], note: false, session: 'RTH' },
  ];
  let { rows = MOCK }: { rows?: BlotterRow[] } = $props();
  const net = (t: BlotterRow) => t.pnl - (t.fees ?? 0);
  const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Controls ─────────────────────────────────────────────────────────────────────────────────
  let search = $state('');
  let sideFilter = $state('all');
  let groupBy = $state('none');
  let sortKey = $state<'time' | 'sym' | 'qty' | 'pnl'>('time');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let cols = $state({ prices: true, costs: true, context: true });
  let selected = $state<Set<string>>(new Set());
  let openId = $state<string | null>(null);

  const SIDE_LBL: Record<string, string> = { all: 'All sides', Long: 'Long', Short: 'Short' };
  const GROUP_LBL: Record<string, string> = { none: 'No grouping', day: 'Group by day', symbol: 'Group by symbol' };

  const colCount = $derived(1 + 5 + (cols.prices ? 3 : 0) + (cols.costs ? 2 : 0) + (cols.context ? 2 : 0));

  const filtered = $derived(
    rows.filter(t => {
      const q = search.trim().toUpperCase();
      if (q && !t.sym.includes(q) && !t.tags.some(g => g.toUpperCase().includes(q))) return false;
      if (sideFilter !== 'all' && t.side !== sideFilter) return false;
      return true;
    })
  );
  const sorted = $derived(
    [...filtered].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'time') return (a.date + a.time < b.date + b.time ? -1 : 1) * dir;
      if (sortKey === 'sym') return a.sym.localeCompare(b.sym) * dir;
      if (sortKey === 'qty') return (a.qty - b.qty) * dir;
      return (a.pnl - b.pnl) * dir;
    })
  );
  type Group = { key: string; label: string; trades: BlotterRow[]; subtotal: number };
  const groups = $derived.by((): Group[] => {
    if (groupBy === 'none') return [{ key: 'all', label: '', trades: sorted, subtotal: 0 }];
    const map = new Map<string, BlotterRow[]>();
    for (const t of sorted) {
      const k = groupBy === 'day' ? t.date : t.sym;
      (map.get(k) ?? map.set(k, []).get(k)!).push(t);
    }
    return [...map.entries()].map(([key, trades]) => ({ key, label: key, trades, subtotal: trades.reduce((s, t) => s + t.pnl, 0) }));
  });

  const totalPnl = $derived(filtered.reduce((s, t) => s + t.pnl, 0));
  const allSelected = $derived(filtered.length > 0 && filtered.every(t => selected.has(t.id)));
  const someSelected = $derived(filtered.some(t => selected.has(t.id)) && !allSelected);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else {
      sortKey = key;
      sortDir = 'asc';
    }
  }
  function toggleRow(id: string, v: boolean) {
    const next = new Set(selected);
    if (v) next.add(id);
    else next.delete(id);
    selected = next;
  }
  function toggleAll(v: boolean) {
    selected = v ? new Set(filtered.map(t => t.id)) : new Set();
  }
  const openTrade = $derived(openId ? rows.find(t => t.id === openId) : undefined);
</script>

{#snippet sortHead(key: 'time' | 'sym' | 'qty' | 'pnl', label: string, cls: string)}
  <Table.Head class={cls}>
    <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" onclick={() => toggleSort(key)}>
      {label}
      {#if sortKey === key}
        <ChevronUp class={cn('size-3', sortDir === 'desc' && 'rotate-180')} />
      {:else}
        <ArrowUpDown class="size-3 opacity-40" />
      {/if}
    </button>
  </Table.Head>
{/snippet}

{#snippet sideBadge(side: 'Long' | 'Short')}
  <Badge variant="outline" class={side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}>{side}</Badge>
{/snippet}

<Card.Root>
  <Card.Header class="flex-col items-stretch gap-3">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input bind:value={search} placeholder="Search symbol or tag…" class="h-8 w-56 pl-8" />
      </div>
      <Select.Root type="single" bind:value={sideFilter}>
        <Select.Trigger class="h-8 w-32">{SIDE_LBL[sideFilter]}</Select.Trigger>
        <Select.Content>
          <Select.Item value="all">All sides</Select.Item>
          <Select.Item value="Long">Long</Select.Item>
          <Select.Item value="Short">Short</Select.Item>
        </Select.Content>
      </Select.Root>
      <Select.Root type="single" bind:value={groupBy}>
        <Select.Trigger class="h-8 w-40">{GROUP_LBL[groupBy]}</Select.Trigger>
        <Select.Content>
          <Select.Item value="none">No grouping</Select.Item>
          <Select.Item value="day">Group by day</Select.Item>
          <Select.Item value="symbol">Group by symbol</Select.Item>
        </Select.Content>
      </Select.Root>
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="sm"><Columns3 class="size-4" /> Columns</Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-48" align="start">
          <p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Column groups</p>
          <div class="space-y-2 text-sm">
            <label class="flex items-center gap-2 text-muted-foreground"><Checkbox checked disabled /> Core</label>
            <label class="flex items-center gap-2"><Checkbox bind:checked={cols.prices} /> Prices &amp; hold</label>
            <label class="flex items-center gap-2"><Checkbox bind:checked={cols.costs} /> Costs</label>
            <label class="flex items-center gap-2"><Checkbox bind:checked={cols.context} /> Context</label>
          </div>
        </Popover.Content>
      </Popover.Root>
      <span class="ml-auto text-xs text-muted-foreground">{filtered.length} of {rows.length} trades</span>
    </div>

    <!-- Bulk action bar -->
    {#if selected.size > 0}
      <div class="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs" transition:fade={{ duration: 120 }}>
        <span class="font-medium">{selected.size} selected</span>
        <Button variant="outline" size="sm" class="h-7"><Tag class="size-3.5" /> Tag</Button>
        <Button variant="outline" size="sm" class="h-7 text-destructive"><Trash2 class="size-3.5" /> Delete</Button>
        <Button variant="ghost" size="sm" class="ml-auto h-7" onclick={() => (selected = new Set())}>Clear</Button>
      </div>
    {/if}
  </Card.Header>

  <Card.Content class="p-0">
    <Table.Root>
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head class="w-9 pl-3">
            <Checkbox checked={allSelected} indeterminate={someSelected} onCheckedChange={toggleAll} aria-label="Select all" />
          </Table.Head>
          {@render sortHead('time', 'Date / time', 'w-32')}
          {@render sortHead('sym', 'Symbol', '')}
          <Table.Head>Side</Table.Head>
          {@render sortHead('qty', 'Qty', 'text-right')}
          {@render sortHead('pnl', 'P&L', 'text-right')}
          {#if cols.prices}
            <Table.Head class="text-right">Entry</Table.Head>
            <Table.Head class="text-right">Exit</Table.Head>
            <Table.Head class="text-right">Hold</Table.Head>
          {/if}
          {#if cols.costs}
            <Table.Head class="text-right">Fees</Table.Head>
            <Table.Head class="text-right">Net</Table.Head>
          {/if}
          {#if cols.context}
            <Table.Head>Tags</Table.Head>
            <Table.Head>Session</Table.Head>
          {/if}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each groups as g (g.key)}
          {#if groupBy !== 'none'}
            <Table.Row class="bg-secondary/40 hover:bg-secondary/40">
              <Table.Cell colspan={colCount} class="py-1.5 pl-3">
                <span class="text-xs font-semibold">{g.label}</span>
                <span class="ml-2 text-xs text-muted-foreground">{g.trades.length} trades</span>
                <span class={cn('ml-2 text-xs font-semibold tabular-nums', g.subtotal >= 0 ? 'text-chart-2' : 'text-destructive')}>{money(g.subtotal)}</span>
              </Table.Cell>
            </Table.Row>
          {/if}
          {#each g.trades as t (t.id)}
            <Table.Row class="cursor-pointer" data-state={selected.has(t.id) ? 'selected' : undefined} onclick={() => (openId = t.id)}>
              <Table.Cell class="pl-3" onclick={e => e.stopPropagation()}>
                <Checkbox checked={selected.has(t.id)} onCheckedChange={v => toggleRow(t.id, v)} aria-label="Select trade" />
              </Table.Cell>
              <Table.Cell class="text-muted-foreground">
                <span class="flex items-center gap-1.5">
                  {t.date.slice(5)} {t.time}
                  {#if t.note}<span class="size-1.5 rounded-full bg-primary" title="Has a note"></span>{/if}
                </span>
              </Table.Cell>
              <Table.Cell class="font-medium">{t.sym}</Table.Cell>
              <Table.Cell>{@render sideBadge(t.side)}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{t.qty}</Table.Cell>
              <Table.Cell class={cn('text-right font-semibold tabular-nums', t.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>{money(t.pnl)}</Table.Cell>
              {#if cols.prices}
                <Table.Cell class="text-right tabular-nums text-muted-foreground">{t.entry ?? '—'}</Table.Cell>
                <Table.Cell class="text-right tabular-nums text-muted-foreground">{t.exit ?? '—'}</Table.Cell>
                <Table.Cell class="text-right tabular-nums text-muted-foreground">{t.holdMin != null ? `${t.holdMin}m` : '—'}</Table.Cell>
              {/if}
              {#if cols.costs}
                <Table.Cell class="text-right tabular-nums text-muted-foreground">{t.fees != null ? `-$${t.fees.toFixed(2)}` : '—'}</Table.Cell>
                <Table.Cell class={cn('text-right tabular-nums', net(t) >= 0 ? 'text-chart-2' : 'text-destructive')}>{money(net(t))}</Table.Cell>
              {/if}
              {#if cols.context}
                <Table.Cell>
                  <span class="flex gap-1">
                    {#each t.tags as tag (tag)}<Badge variant="secondary" class="px-1.5 py-0">{tag}</Badge>{/each}
                  </span>
                </Table.Cell>
                <Table.Cell><span class="text-xs text-muted-foreground">{t.session}</span></Table.Cell>
              {/if}
            </Table.Row>
          {/each}
        {/each}
      </Table.Body>
      <Table.Footer>
        <Table.Row class="hover:bg-transparent">
          <Table.Cell colspan={colCount} class="pl-3">
            <span class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">{filtered.length} trades</span>
              <span class={cn('text-sm font-semibold tabular-nums', totalPnl >= 0 ? 'text-chart-2' : 'text-destructive')}>Net {money(totalPnl)}</span>
            </span>
          </Table.Cell>
        </Table.Row>
      </Table.Footer>
    </Table.Root>
  </Card.Content>
</Card.Root>

<!-- Detail drawer -->
{#if openTrade}
  <div class="fixed inset-0 z-40 bg-black/60" transition:fade={{ duration: 150 }} onclick={() => (openId = null)} role="presentation"></div>
  <aside class="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card" transition:fly={{ x: 400, duration: 200 }}>
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">{openTrade.sym}</span>
        {@render sideBadge(openTrade.side)}
        <span class="text-xs text-muted-foreground">{openTrade.date} · {openTrade.time}</span>
      </div>
      <button type="button" class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close" onclick={() => (openId = null)}>
        <X class="size-4" />
      </button>
    </div>
    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <div class="grid grid-cols-2 gap-2 text-sm">
        {#snippet field(label: string, value: string, tone: 'pos' | 'neg' | 'plain' = 'plain')}
          <div class="rounded-md border border-border bg-background px-3 py-2">
            <div class="text-[11px] text-muted-foreground">{label}</div>
            <div class={cn('mt-0.5 font-semibold tabular-nums', tone === 'pos' ? 'text-chart-2' : tone === 'neg' ? 'text-destructive' : 'text-foreground')}>{value}</div>
          </div>
        {/snippet}
        {@render field('Gross P&L', money(openTrade.pnl), openTrade.pnl >= 0 ? 'pos' : 'neg')}
        {@render field('Net P&L', money(net(openTrade)), net(openTrade) >= 0 ? 'pos' : 'neg')}
        {@render field('Entry', openTrade.entry != null ? String(openTrade.entry) : '—')}
        {@render field('Exit', openTrade.exit != null ? String(openTrade.exit) : '—')}
        {@render field('Qty', String(openTrade.qty))}
        {@render field('Hold', openTrade.holdMin != null ? `${openTrade.holdMin}m` : '—')}
        {@render field('Fees', openTrade.fees != null ? `-$${openTrade.fees.toFixed(2)}` : '—', 'neg')}
        {@render field('Session', openTrade.session)}
      </div>
      <div>
        <div class="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tags</div>
        <div class="flex flex-wrap gap-1">
          {#each openTrade.tags as tag (tag)}<Badge variant="secondary">{tag}</Badge>{/each}
          <Badge variant="outline" class="cursor-pointer border-dashed text-muted-foreground"><Tag class="size-3" /> Add</Badge>
        </div>
      </div>
      <div>
        <div class="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Journal note</div>
        <textarea class="h-24 w-full resize-none rounded-md border border-border bg-background p-2 text-xs leading-relaxed outline-none focus-visible:border-ring" placeholder="Notes for this trade…">{openTrade.note ? 'Clean A+ setup — waited for the retest, sized up, trailed to target.' : ''}</textarea>
      </div>
      <div>
        <div class="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><Paperclip class="size-3" /> Screenshot</div>
        <button type="button" class="grid aspect-video w-full place-items-center rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground">
          <span class="flex flex-col items-center gap-1 text-xs"><ImagePlus class="size-5" /> Drop a chart image</span>
        </button>
      </div>
    </div>
    <div class="flex justify-end gap-2 border-t border-border p-3">
      <Button variant="ghost" size="sm" onclick={() => (openId = null)}>Close</Button>
      <Button size="sm">Save</Button>
    </div>
  </aside>
{/if}
