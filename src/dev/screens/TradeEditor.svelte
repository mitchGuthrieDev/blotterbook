<script lang="ts">
  // Trade Editor surface mockup (UI redesign, Phase 2 — 6th screen; Data Management). The edit-focused
  // sibling of the Blotter: a spreadsheet-style editable table. Click any cell to edit inline (text /
  // number / side-toggle); tags + note edit via a Popover. Edits are tracked as a DRAFT — dirty rows
  // are highlighted and committed via a sticky Save all / Revert bar (not instantly). Add a manual
  // trade, bulk-select for delete (confirm) or bulk-edit (add a tag). shadcn-svelte primitives;
  // representative static data; color only in P&L.
  import { Plus, Trash2, Tag, StickyNote, Pencil } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import * as Popover from '$lib/components/ui/popover';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';

  type Row = {
    id: string; date: string; time: string; symbol: string; side: 'Long' | 'Short';
    qty: number; entry: number; exit: number; pnl: number; fees: number; tags: string[]; note: string; isNew?: boolean;
  };
  const seed: Row[] = [
    { id: 't1', date: '2026-06-24', time: '09:34', symbol: 'ES', side: 'Long', qty: 2, entry: 5482.25, exit: 5486.0, pnl: 375, fees: 4.7, tags: ['breakout'], note: 'Clean retest.' },
    { id: 't2', date: '2026-06-24', time: '10:18', symbol: 'NQ', side: 'Short', qty: 1, entry: 19840.5, exit: 19852.0, pnl: -230, fees: 2.4, tags: ['fade'], note: '' },
    { id: 't3', date: '2026-06-24', time: '11:46', symbol: 'ES', side: 'Long', qty: 3, entry: 5489.0, exit: 5492.75, pnl: 562, fees: 7.05, tags: ['trend', 'A+'], note: '' },
    { id: 't4', date: '2026-06-25', time: '09:31', symbol: 'ES', side: 'Long', qty: 2, entry: 5494.5, exit: 5491.0, pnl: -350, fees: 4.7, tags: [], note: '' },
    { id: 't5', date: '2026-06-25', time: '10:05', symbol: 'NQ', side: 'Long', qty: 1, entry: 19860.0, exit: 19878.5, pnl: 370, fees: 2.4, tags: ['trend'], note: 'Sized up.' },
    { id: 't6', date: '2026-06-26', time: '13:15', symbol: 'MES', side: 'Long', qty: 5, entry: 5502.5, exit: 5504.0, pnl: 188, fees: 3.5, tags: ['scalp'], note: '' },
  ];
  const clone = (r: Row): Row => structuredClone($state.snapshot(r));
  let rows = $state<Row[]>(seed.map(clone));
  let original = new Map<string, Row>(seed.map(r => [r.id, clone(r)]));

  let editing = $state<{ id: string; field: string } | null>(null);
  let selected = $state<Set<string>>(new Set());
  let pendingDelete = $state<string[]>([]);
  let deleteOpen = $state(false);
  let bulkTag = $state('');
  let nextId = 100;

  const isEditing = (id: string, field: string) => editing?.id === id && editing.field === field;
  const startEdit = (id: string, field: string) => (editing = { id, field });
  const stopEdit = () => (editing = null);
  function onCellKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur();
  }
  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
  function setText(id: string, field: 'symbol' | 'date' | 'time', v: string) {
    rows = rows.map(r => (r.id === id ? { ...r, [field]: v } : r));
  }
  function setNum(id: string, field: 'qty' | 'entry' | 'exit' | 'pnl' | 'fees', v: number) {
    rows = rows.map(r => (r.id === id ? { ...r, [field]: Number.isNaN(v) ? 0 : v } : r));
  }
  function toggleSide(id: string) {
    rows = rows.map(r => (r.id === id ? { ...r, side: r.side === 'Long' ? 'Short' : 'Long' } : r));
  }
  function addTag(id: string, tag: string) {
    const t = tag.trim();
    if (!t) return;
    rows = rows.map(r => (r.id === id && !r.tags.includes(t) ? { ...r, tags: [...r.tags, t] } : r));
  }
  function removeTag(id: string, tag: string) {
    rows = rows.map(r => (r.id === id ? { ...r, tags: r.tags.filter(x => x !== tag) } : r));
  }
  function setNote(id: string, v: string) {
    rows = rows.map(r => (r.id === id ? { ...r, note: v } : r));
  }

  const editFields = (r: Row) => JSON.stringify({ ...r, isNew: undefined });
  const isDirty = (r: Row) => {
    const o = original.get(r.id);
    return !o || editFields(o) !== editFields(r);
  };
  const dirtyCount = $derived(rows.filter(isDirty).length);
  const netPnl = $derived(rows.reduce((s, r) => s + r.pnl, 0));

  function saveAll() {
    original = new Map(rows.map(r => [r.id, clone({ ...r, isNew: false })]));
    rows = rows.map(r => ({ ...r, isNew: false }));
  }
  function revert() {
    rows = [...original.values()].map(clone);
    selected = new Set();
  }
  function addTrade() {
    const id = `t-new-${nextId++}`;
    rows = [...rows, { id, date: '2026-06-30', time: '00:00', symbol: '', side: 'Long', qty: 1, entry: 0, exit: 0, pnl: 0, fees: 0, tags: [], note: '', isNew: true }];
    startEdit(id, 'symbol');
  }
  function toggleRow(id: string, v: boolean) {
    const next = new Set(selected);
    if (v) next.add(id);
    else next.delete(id);
    selected = next;
  }
  const allSelected = $derived(rows.length > 0 && rows.every(r => selected.has(r.id)));
  const someSelected = $derived(rows.some(r => selected.has(r.id)) && !allSelected);
  function toggleAll(v: boolean) {
    selected = v ? new Set(rows.map(r => r.id)) : new Set();
  }
  function askDelete(ids: string[]) {
    pendingDelete = ids;
    deleteOpen = true;
  }
  function doDelete() {
    const del = new Set(pendingDelete);
    rows = rows.filter(r => !del.has(r.id));
    del.forEach(id => original.delete(id));
    selected = new Set();
    deleteOpen = false;
  }
  function applyBulkTag() {
    const t = bulkTag.trim();
    if (!t) return;
    rows = rows.map(r => (selected.has(r.id) && !r.tags.includes(t) ? { ...r, tags: [...r.tags, t] } : r));
    bulkTag = '';
  }
  const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString()}`;
</script>

{#snippet textCell(row: Row, field: 'symbol' | 'date' | 'time', value: string, align: string)}
  {#if isEditing(row.id, field)}
    <input
      use:focusSelect
      {value}
      oninput={e => setText(row.id, field, e.currentTarget.value)}
      onblur={stopEdit}
      onkeydown={onCellKey}
      class={cn('h-7 w-full rounded border border-ring bg-background px-1.5 text-sm outline-none', align)}
    />
  {:else}
    <button type="button" onclick={() => startEdit(row.id, field)} class={cn('block w-full rounded px-1.5 py-1 text-sm hover:bg-accent', align)}>
      {value || '—'}
    </button>
  {/if}
{/snippet}

{#snippet numCell(row: Row, field: 'qty' | 'entry' | 'exit' | 'pnl' | 'fees', value: number, extra: string)}
  {#if isEditing(row.id, field)}
    <input
      use:focusSelect
      type="number"
      {value}
      oninput={e => setNum(row.id, field, e.currentTarget.valueAsNumber)}
      onblur={stopEdit}
      onkeydown={onCellKey}
      class="h-7 w-full rounded border border-ring bg-background px-1.5 text-right text-sm outline-none"
    />
  {:else}
    <button type="button" onclick={() => startEdit(row.id, field)} class={cn('block w-full rounded px-1.5 py-1 text-right text-sm tabular-nums hover:bg-accent', extra)}>
      {value}
    </button>
  {/if}
{/snippet}

<div class="flex flex-col gap-4">
  <!-- Toolbar -->
  <div class="flex flex-wrap items-center gap-3">
    <Button size="sm" onclick={addTrade}><Plus class="size-4" /> Add trade</Button>
    <span class="text-xs text-muted-foreground">Click any cell to edit. Changes are staged until you save.</span>
    <span class={cn('ml-auto text-sm font-semibold tabular-nums', netPnl >= 0 ? 'text-chart-2' : 'text-destructive')}>Net {money(netPnl)}</span>
  </div>

  <!-- Bulk bar -->
  {#if selected.size > 0}
    <div class="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs">
      <span class="font-medium">{selected.size} selected</span>
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="sm" class="h-7"><Tag class="size-3.5" /> Bulk add tag</Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-56" align="start">
          <p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Add tag to {selected.size}</p>
          <div class="flex gap-2">
            <Input bind:value={bulkTag} placeholder="tag…" class="h-8" onkeydown={e => e.key === 'Enter' && applyBulkTag()} />
            <Button size="sm" class="h-8" onclick={applyBulkTag}>Add</Button>
          </div>
        </Popover.Content>
      </Popover.Root>
      <Button variant="outline" size="sm" class="h-7 text-destructive" onclick={() => askDelete([...selected])}><Trash2 class="size-3.5" /> Delete</Button>
      <Button variant="ghost" size="sm" class="ml-auto h-7" onclick={() => (selected = new Set())}>Clear</Button>
    </div>
  {/if}

  <Card.Root>
    <Card.Content class="p-0">
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class="w-9 pl-3"><Checkbox checked={allSelected} indeterminate={someSelected} onCheckedChange={toggleAll} aria-label="Select all" /></Table.Head>
            <Table.Head>Date</Table.Head>
            <Table.Head>Time</Table.Head>
            <Table.Head>Symbol</Table.Head>
            <Table.Head>Side</Table.Head>
            <Table.Head class="text-right">Qty</Table.Head>
            <Table.Head class="text-right">Entry</Table.Head>
            <Table.Head class="text-right">Exit</Table.Head>
            <Table.Head class="text-right">P&L</Table.Head>
            <Table.Head class="text-right">Fees</Table.Head>
            <Table.Head>Tags</Table.Head>
            <Table.Head>Note</Table.Head>
            <Table.Head class="w-9"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each rows as row (row.id)}
            {@const dirty = isDirty(row)}
            <Table.Row class={cn(dirty && 'bg-primary/5')} data-state={selected.has(row.id) ? 'selected' : undefined}>
              <Table.Cell class="pl-3">
                <span class="flex items-center gap-1.5">
                  <Checkbox checked={selected.has(row.id)} onCheckedChange={v => toggleRow(row.id, v)} aria-label="Select row" />
                  {#if dirty}<span class="size-1.5 rounded-full bg-primary" title="Unsaved"></span>{/if}
                </span>
              </Table.Cell>
              <Table.Cell class="p-1 text-muted-foreground">{@render textCell(row, 'date', row.date, 'text-left')}</Table.Cell>
              <Table.Cell class="p-1 text-muted-foreground">{@render textCell(row, 'time', row.time, 'text-left')}</Table.Cell>
              <Table.Cell class="p-1 font-medium">{@render textCell(row, 'symbol', row.symbol, 'text-left')}</Table.Cell>
              <Table.Cell class="p-1">
                <button type="button" onclick={() => toggleSide(row.id)} title="Toggle side">
                  <Badge variant="outline" class={row.side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}>{row.side}</Badge>
                </button>
              </Table.Cell>
              <Table.Cell class="p-1">{@render numCell(row, 'qty', row.qty, '')}</Table.Cell>
              <Table.Cell class="p-1 text-muted-foreground">{@render numCell(row, 'entry', row.entry, 'text-muted-foreground')}</Table.Cell>
              <Table.Cell class="p-1 text-muted-foreground">{@render numCell(row, 'exit', row.exit, 'text-muted-foreground')}</Table.Cell>
              <Table.Cell class="p-1">{@render numCell(row, 'pnl', row.pnl, row.pnl >= 0 ? 'font-semibold text-chart-2' : 'font-semibold text-destructive')}</Table.Cell>
              <Table.Cell class="p-1 text-muted-foreground">{@render numCell(row, 'fees', row.fees, 'text-muted-foreground')}</Table.Cell>
              <Table.Cell class="p-1">
                <Popover.Root>
                  <Popover.Trigger>
                    {#snippet child({ props })}
                      <button {...props} type="button" class="flex min-h-7 flex-wrap items-center gap-1 rounded px-1.5 py-1 hover:bg-accent">
                        {#each row.tags as tag (tag)}<Badge variant="secondary" class="px-1.5 py-0">{tag}</Badge>{/each}
                        {#if !row.tags.length}<span class="text-xs text-muted-foreground">+ tag</span>{/if}
                      </button>
                    {/snippet}
                  </Popover.Trigger>
                  <Popover.Content class="w-56" align="start">
                    <div class="mb-2 flex flex-wrap gap-1">
                      {#each row.tags as tag (tag)}
                        <Badge variant="secondary" class="gap-1">{tag}<button type="button" class="text-muted-foreground hover:text-foreground" onclick={() => removeTag(row.id, tag)} aria-label="Remove tag">×</button></Badge>
                      {/each}
                      {#if !row.tags.length}<span class="text-xs text-muted-foreground">No tags</span>{/if}
                    </div>
                    <Input placeholder="Add tag, Enter…" class="h-8" onkeydown={e => { if (e.key === 'Enter') { addTag(row.id, e.currentTarget.value); e.currentTarget.value = ''; } }} />
                  </Popover.Content>
                </Popover.Root>
              </Table.Cell>
              <Table.Cell class="p-1">
                <Popover.Root>
                  <Popover.Trigger>
                    {#snippet child({ props })}
                      <button {...props} type="button" class="grid size-7 place-items-center rounded hover:bg-accent" title={row.note || 'Add note'}>
                        <StickyNote class={cn('size-4', row.note ? 'text-primary' : 'text-muted-foreground')} />
                      </button>
                    {/snippet}
                  </Popover.Trigger>
                  <Popover.Content class="w-64" align="start">
                    <Textarea value={row.note} oninput={e => setNote(row.id, e.currentTarget.value)} placeholder="Journal note…" class="h-24" />
                  </Popover.Content>
                </Popover.Root>
              </Table.Cell>
              <Table.Cell class="p-1">
                <button type="button" class="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-destructive" aria-label="Delete trade" onclick={() => askDelete([row.id])}>
                  <Trash2 class="size-4" />
                </button>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Content>
  </Card.Root>

  <!-- Sticky save bar -->
  {#if dirtyCount > 0}
    <div class="sticky bottom-0 flex items-center justify-between rounded-md border border-primary/40 bg-card px-4 py-2.5 shadow-lg">
      <span class="flex items-center gap-2 text-sm"><Pencil class="size-4 text-primary" /> {dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}</span>
      <div class="flex gap-2">
        <Button variant="ghost" size="sm" onclick={revert}>Revert</Button>
        <Button size="sm" onclick={saveAll}>Save all</Button>
      </div>
    </div>
  {/if}
</div>

<!-- Delete confirm -->
<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete {pendingDelete.length} {pendingDelete.length === 1 ? 'trade' : 'trades'}?</AlertDialog.Title>
      <AlertDialog.Description>This removes the selected {pendingDelete.length === 1 ? 'trade' : 'trades'} from your data. This can't be undone.</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={doDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
