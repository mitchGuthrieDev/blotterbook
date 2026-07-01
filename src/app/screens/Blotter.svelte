<script lang="ts" module>
  // A single blotter row. The app builds these from real trades (all surfaces); entry/exit prices,
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
    /** The trade's journal note text (edited in the detail drawer — A149). */
    noteText: string;
    session: 'RTH' | 'ETH';
  };
</script>

<script lang="ts">
  // Blotter — a full-width, feature-rich trade table on the shadcn-svelte primitives (Table/Badge/
  // Checkbox/Input/Card + Select/Popover/Button + Sheet). Row click → a detail Sheet with an editable
  // journal note + tags (persisted via onsavemeta — A149); click-to-sort headers, search + side filter,
  // column-group toggle, group-by (day/symbol) with subtotals, bulk-select with tag/delete actions,
  // footer totals. Rows come from the `rows` prop (real trades, wired by App.svelte on all surfaces).
  // Color only in the P&L.
  import { Search, ArrowUpDown, ChevronUp, Columns3, Tag, Trash2, X } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { usd, tone } from '../../lib/core/core.ts';
  import { cleanTag } from '../../lib/core/store.ts';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import * as Select from '$lib/components/ui/select';
  import * as Popover from '$lib/components/ui/popover';
  import * as Sheet from '$lib/components/ui/sheet';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { createPagination } from '../lib/pagination.svelte.ts';
  import PaginationControls from '../parts/PaginationControls.svelte';
  import { fade } from 'svelte/transition';

  let {
    rows,
    onsavemeta,
    ondelete,
    dataDisabled = false,
  }: {
    rows: BlotterRow[];
    /** Persist a trade's tags + journal note (the drawer's Save — A149). */
    onsavemeta?: (id: string, tags: string[], note: string) => void;
    /** Delete the given trade ids (the bulk Delete — A149). */
    ondelete?: (ids: string[]) => void;
    /** Demo: disable every write control (demo never mutates). */
    dataDisabled?: boolean;
  } = $props();
  const net = (t: BlotterRow) => t.pnl - (t.fees ?? 0);
  // Cents-precision signed currency (the blotter shows per-trade P&L + fees to the cent).
  const money = usd;

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
  // Pagination — the blotter can list thousands of trades; page them (50/page default) like prod.
  // Shared factory (A157) — the clamp/slice logic has ONE definition with the Trade Editor.
  const pager = createPagination(() => sorted);
  const pagedSorted = $derived(pager.paged);

  type Group = { key: string; label: string; trades: BlotterRow[]; subtotal: number };
  const groups = $derived.by((): Group[] => {
    if (groupBy === 'none') return [{ key: 'all', label: '', trades: pagedSorted, subtotal: 0 }];
    const map = new Map<string, BlotterRow[]>();
    for (const t of pagedSorted) {
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

  // ── Detail-drawer note/tags draft (A149 — the old drawer's controls were dead mock leftovers
  // that silently discarded input). Re-seeded whenever a different trade opens.
  let draftNote = $state('');
  let draftTags = $state<string[]>([]);
  let tagDraft = $state('');
  $effect(() => {
    const t = openId ? rows.find(r => r.id === openId) : undefined;
    draftNote = t?.noteText ?? '';
    draftTags = t ? [...t.tags] : [];
    tagDraft = '';
  });
  function addDraftTag() {
    // Canonicalize at entry (the same cleanTag the Store applies on save — A153).
    const t = cleanTag(tagDraft);
    if (t && !draftTags.includes(t)) draftTags = [...draftTags, t];
    tagDraft = '';
  }
  function saveDrawer() {
    if (dataDisabled || !openTrade) return;
    onsavemeta?.(openTrade.id, [...draftTags], draftNote);
    openId = null;
  }

  // ── Bulk actions (A149) ──────────────────────────────────────────────────────────────────────
  let bulkTag = $state('');
  let bulkTagOpen = $state(false);
  function applyBulkTag() {
    const t = cleanTag(bulkTag);
    if (dataDisabled || !t) return;
    for (const id of selected) {
      const r = rows.find(x => x.id === id);
      if (r && !r.tags.includes(t)) onsavemeta?.(id, [...r.tags, t], r.noteText);
    }
    bulkTag = '';
    bulkTagOpen = false;
  }
  let deleteOpen = $state(false);
  function doBulkDelete() {
    if (dataDisabled) return;
    ondelete?.([...selected]);
    selected = new Set();
    deleteOpen = false;
  }
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
  <Badge variant="outline" class={side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}
    >{side}</Badge
  >
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
      <div
        class="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs"
        transition:fade={{ duration: 120 }}
      >
        <span class="font-medium">{selected.size} selected</span>
        <Popover.Root bind:open={bulkTagOpen}>
          <Popover.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="outline" size="sm" class="h-7" disabled={dataDisabled}><Tag class="size-3.5" /> Tag</Button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="w-56" align="start">
            <p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tag {selected.size} selected</p>
            <div class="flex items-center gap-1">
              <Input
                bind:value={bulkTag}
                placeholder="Tag name…"
                class="h-8 flex-1"
                onkeydown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyBulkTag();
                  }
                }}
              />
              <Button variant="secondary" size="sm" class="h-8" disabled={!bulkTag.trim()} onclick={applyBulkTag}>Apply</Button>
            </div>
          </Popover.Content>
        </Popover.Root>
        <Button variant="outline" size="sm" class="h-7 text-destructive" disabled={dataDisabled} onclick={() => (deleteOpen = true)}
          ><Trash2 class="size-3.5" /> Delete</Button
        >
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
                <span class={cn('ml-2 text-xs font-semibold tabular-nums', g.subtotal >= 0 ? 'text-chart-2' : 'text-destructive')}
                  >{money(g.subtotal)}</span
                >
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
                  {t.date.slice(5)}
                  {t.time}
                  {#if t.note}<span class="size-1.5 rounded-full bg-primary" title="Has a note"></span>{/if}
                </span>
              </Table.Cell>
              <Table.Cell class="font-medium">
                <!-- A real button so keyboard users can open the detail sheet (the row onclick is mouse-only). -->
                <button type="button" class="rounded hover:underline focus-visible:underline" onclick={() => (openId = t.id)}
                  >{t.sym}</button
                >
              </Table.Cell>
              <Table.Cell>{@render sideBadge(t.side)}</Table.Cell>
              <Table.Cell class="text-right tabular-nums">{t.qty}</Table.Cell>
              <Table.Cell class={cn('text-right font-semibold tabular-nums', t.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}
                >{money(t.pnl)}</Table.Cell
              >
              {#if cols.prices}
                <Table.Cell class="text-right tabular-nums text-muted-foreground">{t.entry ?? '—'}</Table.Cell>
                <Table.Cell class="text-right tabular-nums text-muted-foreground">{t.exit ?? '—'}</Table.Cell>
                <Table.Cell class="text-right tabular-nums text-muted-foreground">{t.holdMin != null ? `${t.holdMin}m` : '—'}</Table.Cell>
              {/if}
              {#if cols.costs}
                <Table.Cell class="text-right tabular-nums text-muted-foreground">{t.fees != null ? money(-t.fees) : '—'}</Table.Cell>
                <Table.Cell class={cn('text-right tabular-nums', net(t) >= 0 ? 'text-chart-2' : 'text-destructive')}
                  >{money(net(t))}</Table.Cell
                >
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
            <span class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span class="text-xs tabular-nums text-muted-foreground"
                >{pager.start.toLocaleString()}–{pager.end.toLocaleString()} of {filtered.length.toLocaleString()}</span
              >
              <PaginationControls {pager} />
              <span class={cn('ml-auto text-sm font-semibold tabular-nums', totalPnl >= 0 ? 'text-chart-2' : 'text-destructive')}
                >Net {money(totalPnl)}</span
              >
            </span>
          </Table.Cell>
        </Table.Row>
      </Table.Footer>
    </Table.Root>
  </Card.Content>
</Card.Root>

<!-- Detail sheet (A149: rebuilt on the Sheet primitive — Esc/focus handling for free — with the
     note + tags actually wired to onsavemeta; screenshots stay the Trade Editor's job) -->
<Sheet.Root
  open={!!openTrade}
  onOpenChange={o => {
    if (!o) openId = null;
  }}
>
  <Sheet.Content side="right" class="w-full sm:max-w-md">
    {#if openTrade}
      <Sheet.Header>
        <Sheet.Title class="flex items-center gap-2">
          {openTrade.sym}
          {@render sideBadge(openTrade.side)}
        </Sheet.Title>
        <Sheet.Description>{openTrade.date} · {openTrade.time}</Sheet.Description>
      </Sheet.Header>
      <div class="flex-1 space-y-4 overflow-y-auto p-4">
        <div class="grid grid-cols-2 gap-2 text-sm">
          {#snippet field(label: string, value: string, fieldTone: 'pos' | 'neg' | 'plain' = 'plain')}
            <div class="rounded-md border border-border bg-background px-3 py-2">
              <div class="text-[11px] text-muted-foreground">{label}</div>
              <div
                class={cn(
                  'mt-0.5 font-semibold tabular-nums',
                  fieldTone === 'pos' ? 'text-chart-2' : fieldTone === 'neg' ? 'text-destructive' : 'text-foreground'
                )}
              >
                {value}
              </div>
            </div>
          {/snippet}
          {@render field('Gross P&L', money(openTrade.pnl), tone(openTrade.pnl))}
          {@render field('Net P&L', money(net(openTrade)), tone(net(openTrade)))}
          {@render field('Entry', openTrade.entry != null ? String(openTrade.entry) : '—')}
          {@render field('Exit', openTrade.exit != null ? String(openTrade.exit) : '—')}
          {@render field('Qty', String(openTrade.qty))}
          {@render field('Hold', openTrade.holdMin != null ? `${openTrade.holdMin}m` : '—')}
          {@render field('Fees', openTrade.fees != null ? money(-openTrade.fees) : '—', 'neg')}
          {@render field('Session', openTrade.session)}
        </div>
        <div>
          <div class="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tags</div>
          <div class="mb-1.5 flex flex-wrap gap-1">
            {#each draftTags as tag (tag)}
              <Badge variant="secondary" class="gap-1">
                {tag}{#if !dataDisabled}<button
                    type="button"
                    class="text-muted-foreground hover:text-foreground"
                    aria-label="Remove tag {tag}"
                    onclick={() => (draftTags = draftTags.filter(x => x !== tag))}><X class="size-3" /></button
                  >{/if}
              </Badge>
            {/each}
            {#if !draftTags.length}<span class="text-xs text-muted-foreground">No tags</span>{/if}
          </div>
          <Input
            bind:value={tagDraft}
            placeholder="Add tag, Enter…"
            class="h-8"
            disabled={dataDisabled}
            onkeydown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraftTag();
              }
            }}
          />
        </div>
        <div>
          <div class="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Journal note</div>
          <textarea
            class="h-24 w-full resize-none rounded-md border border-border bg-background p-2 text-xs leading-relaxed outline-none focus-visible:border-ring"
            placeholder="Notes for this trade…"
            bind:value={draftNote}
            disabled={dataDisabled}
          ></textarea>
        </div>
      </div>
      <Sheet.Footer class="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" onclick={() => (openId = null)}>Close</Button>
        <Button size="sm" disabled={dataDisabled} onclick={saveDrawer}>Save</Button>
      </Sheet.Footer>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<!-- Bulk-delete confirm (A149) -->
<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete {selected.size} {selected.size === 1 ? 'trade' : 'trades'}?</AlertDialog.Title>
      <AlertDialog.Description
        >This permanently removes the selected trades (and their tags/notes) from this browser.</AlertDialog.Description
      >
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={doBulkDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
