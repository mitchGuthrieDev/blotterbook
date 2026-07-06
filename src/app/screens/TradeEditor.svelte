<script lang="ts" module>
  export type EditorRow = {
    id: string;
    date: string;
    time: string;
    symbol: string;
    side: 'Long' | 'Short';
    qty: number;
    entry: number;
    exit: number;
    pnl: number;
    fees: number;
    /** F46: provenance platform(s) from the trade's contributing file records — read-only ('—' for
     *  legacy pre-F37 trades and manual rows). */
    platform: string;
    tags: string[];
    note: string;
    shots: string[];
    isNew?: boolean;
  };
</script>

<script lang="ts">
  // Trade Editor surface (UI redesign; Data Management). The edit-focused sibling of the Blotter: a
  // spreadsheet-style table. When coreEditable, every cell edits inline and edits stage as a draft. In
  // the app (all surfaces), imported trades are IMMUTABLE — the trade id is a content hash and there's
  // no updateTrade — so the editable layer is per-trade METADATA: tags + notes persist (via
  // saveTradeMeta) and rows can be deleted; the core price/qty/P&L cells render read-only (the figures
  // came from your CSV) and entry/exit aren't in the trade model. Save all / Revert commit the staged
  // tag/note edits. On demo, writes are disabled (dataDisabled). shadcn-svelte primitives; color in P&L.
  import { Plus, Trash2, Tag, StickyNote, Pencil, ImagePlus, Image, X } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { usdWhole, EXCH, MICRO, NOT_MICRO } from '../../lib/core/core.ts';
  import { cleanTag } from '../../lib/core/store.ts';
  import { readImage } from '../lib/files.ts';
  import { createPagination } from '../lib/pagination.svelte.ts';
  import PaginationControls from '../parts/PaginationControls.svelte';
  import TagInput from '../parts/TagInput.svelte';
  import DatePickerPopover from '../parts/DatePickerPopover.svelte';
  import SymbolSelect from '../parts/SymbolSelect.svelte';
  import { CELL_TRIGGER_CLASS } from '../parts/EditableCellPopover.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import * as Popover from '$lib/components/ui/popover';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import ScreenshotLightbox from '../parts/ScreenshotLightbox.svelte';

  interface Props {
    rows: EditorRow[];
    /** When true, every field edits inline; otherwise only tags/notes edit (imported trades are fixed). */
    coreEditable?: boolean;
    /** When set, only these core fields are editable (date/time/symbol/side/qty/pnl — entry/exit/fees
     *  aren't in the trade model). Overrides `coreEditable` per-field when provided. */
    editableFields?: string[];
    /** Persist the staged tag/note edits (the app passes the Store write-through). */
    onsave?: (rows: EditorRow[]) => void | Promise<void>;
    /** Persist a delete of the given trade ids. */
    ondelete?: (ids: string[]) => void | Promise<void>;
    /** Disable every write control (Save all + per-row/bulk delete) on demo (never mutates). */
    dataDisabled?: boolean;
    /** The existing trade-tag vocabulary, for the tag-input autocomplete (A167). */
    tagVocab?: string[];
  }
  let { rows: rowsProp, coreEditable = true, editableFields, onsave, ondelete, dataDisabled = false, tagVocab = [] }: Props = $props();
  // A field is editable if it's in editableFields (when provided) or coreEditable covers everything.
  const canEdit = (field: string) => (editableFields ? editableFields.includes(field) : coreEditable);
  const anyCoreEditable = $derived(coreEditable || !!editableFields?.length);

  const clone = (r: EditorRow): EditorRow => structuredClone($state.snapshot(r));
  // svelte-ignore state_referenced_locally — initial seed only; the $effect below resyncs on change.
  let draft = $state<EditorRow[]>(rowsProp.map(clone));
  // svelte-ignore state_referenced_locally
  let original = $state<Map<string, EditorRow>>(new Map(rowsProp.map(r => [r.id, clone(r)])));
  // Reseed the draft when the incoming row SET changes (initial load, external delete/import). Tag/note
  // saves keep the same id-set and clear their own dirty state optimistically in saveAll().
  // svelte-ignore state_referenced_locally
  let lastKey = rowsProp.map(r => r.id).join('|');
  $effect(() => {
    const key = rowsProp.map(r => r.id).join('|');
    if (key !== lastKey) {
      lastKey = key;
      draft = rowsProp.map(clone);
      original = new Map(rowsProp.map(r => [r.id, clone(r)]));
      selected = new Set();
    }
  });

  let editing = $state<{ id: string; field: string } | null>(null);
  let selected = $state<Set<string>>(new Set());
  let pendingDelete = $state<string[]>([]);
  let deleteOpen = $state(false);
  let bulkTag = $state('');
  let rowTagDraft = $state(''); // the open tag-popover's draft (one popover at a time)
  let saving = $state(false);
  let nextId = 100;

  const isEditing = (id: string, field: string) => editing?.id === id && editing.field === field;
  const startEdit = (id: string, field: string) => canEdit(field) && (editing = { id, field });
  const stopEdit = () => (editing = null);
  function onCellKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur();
  }
  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
  function setText(id: string, field: 'symbol' | 'date' | 'time', v: string) {
    draft = draft.map(r => (r.id === id ? { ...r, [field]: v } : r));
  }
  function setNum(id: string, field: 'qty' | 'entry' | 'exit' | 'pnl' | 'fees', v: number) {
    let val = Number.isNaN(v) ? 0 : v;
    // A173: qty is a contract COUNT — a negative qty flips commissions into a credit downstream
    // and 0 silently bills as 1. Clamp to a positive integer at the input seam (adapters Math.abs too).
    if (field === 'qty') val = Math.max(1, Math.round(Math.abs(val)) || 1);
    draft = draft.map(r => (r.id === id ? { ...r, [field]: val } : r));
  }
  function toggleSide(id: string) {
    if (!canEdit('side')) return;
    draft = draft.map(r => (r.id === id ? { ...r, side: r.side === 'Long' ? 'Short' : 'Long' } : r));
  }
  function addTag(id: string, tag: string) {
    // A153: canonicalize at entry (the same cleanTag the Store applies on save), so the chip the
    // user sees is exactly the persisted form.
    const t = cleanTag(tag);
    if (!t) return;
    draft = draft.map(r => (r.id === id && !r.tags.includes(t) ? { ...r, tags: [...r.tags, t] } : r));
  }
  function removeTag(id: string, tag: string) {
    draft = draft.map(r => (r.id === id ? { ...r, tags: r.tags.filter(x => x !== tag) } : r));
  }
  function setNote(id: string, v: string) {
    draft = draft.map(r => (r.id === id ? { ...r, note: v } : r));
  }
  async function addShot(id: string, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const url = await readImage(f);
    if (url) draft = draft.map(r => (r.id === id ? { ...r, shots: [...r.shots, url] } : r));
  }
  function removeShot(id: string, idx: number) {
    draft = draft.map(r => (r.id === id ? { ...r, shots: r.shots.filter((_, j) => j !== idx) } : r));
  }
  // Enlarged-screenshot lightbox.
  let zoomShot = $state<string | null>(null);

  const editFields = (r: EditorRow) => JSON.stringify({ ...r, isNew: undefined });
  const isDirty = (r: EditorRow) => {
    const o = original.get(r.id);
    return !o || editFields(o) !== editFields(r);
  };
  const dirtyCount = $derived(draft.filter(isDirty).length);
  const netPnl = $derived(draft.reduce((s, r) => s + r.pnl, 0));

  // Pagination — the editor can hold thousands of rows; page them (50/page default) like prod.
  // Shared factory (A157) — the clamp/slice logic has ONE definition with the Blotter.
  const pager = createPagination(() => draft);
  const pagedRows = $derived(pager.paged);

  async function saveAll() {
    if (dataDisabled) return;
    if (onsave) {
      saving = true;
      try {
        await onsave(draft.filter(isDirty).map(clone));
      } finally {
        saving = false;
      }
    }
    original = new Map(draft.map(r => [r.id, clone({ ...r, isNew: false })]));
    draft = draft.map(r => ({ ...r, isNew: false }));
  }
  function revert() {
    draft = [...original.values()].map(clone);
    selected = new Set();
  }
  function addTrade() {
    const id = `t-new-${nextId++}`;
    draft = [
      ...draft,
      {
        id,
        date: '2026-06-30',
        time: '00:00',
        symbol: '',
        side: 'Long',
        qty: 1,
        entry: 0,
        exit: 0,
        pnl: 0,
        fees: 0,
        platform: '', // manual row — no file provenance (F46)
        tags: [],
        note: '',
        shots: [],
        isNew: true,
      },
    ];
  }
  function toggleRow(id: string, v: boolean) {
    const next = new Set(selected);
    if (v) next.add(id);
    else next.delete(id);
    selected = next;
  }
  const allSelected = $derived(draft.length > 0 && draft.every(r => selected.has(r.id)));
  const someSelected = $derived(draft.some(r => selected.has(r.id)) && !allSelected);
  function toggleAll(v: boolean) {
    selected = v ? new Set(draft.map(r => r.id)) : new Set();
  }
  function askDelete(ids: string[]) {
    if (dataDisabled) return;
    pendingDelete = ids;
    deleteOpen = true;
  }
  async function doDelete() {
    const del = new Set(pendingDelete);
    draft = draft.filter(r => !del.has(r.id));
    // Reassign (don't mutate in place): $state doesn't proxy Map methods, so an in-place
    // .delete() is invisible to the deriveds that read `original` (A158).
    original = new Map([...original].filter(([id]) => !del.has(id)));
    selected = new Set();
    deleteOpen = false;
    if (ondelete) await ondelete([...del]);
  }
  function applyBulkTag() {
    const t = cleanTag(bulkTag); // A153: canonical form at entry
    if (!t) return;
    draft = draft.map(r => (selected.has(r.id) && !r.tags.includes(t) ? { ...r, tags: [...r.tags, t] } : r));
    bulkTag = '';
  }
  const numText = (v: number) => (Number.isFinite(v) ? `${v}` : '—');

  // F49: the Symbol cell editor's option list — every root already in the dataset (draft rows) plus
  // every root the fee tables know about (EXCH's keys + the MICRO/NOT_MICRO tier overrides), so the
  // picker surfaces roots the trader hasn't imported yet. Live imports of the exported `let`s from
  // core.ts always read the current runtime values (loadRefData() resolves before the app mounts —
  // see docs/architecture.md's boot sequence — so this is populated by the time this screen renders).
  const symbolOptions = $derived.by(() => {
    const set = new Set<string>();
    for (const r of draft) if (r.symbol) set.add(r.symbol.toUpperCase());
    for (const root of Object.keys(EXCH)) set.add(root);
    for (const root of MICRO) set.add(root);
    for (const root of NOT_MICRO) set.add(root);
    return [...set].sort();
  });
</script>

{#snippet textCell(row: EditorRow, field: 'symbol' | 'date' | 'time', value: string, align: string)}
  {#if canEdit(field) && isEditing(row.id, field)}
    <input
      use:focusSelect
      {value}
      oninput={e => setText(row.id, field, e.currentTarget.value)}
      onblur={stopEdit}
      onkeydown={onCellKey}
      class={cn('h-7 w-full rounded border border-ring bg-background px-1.5 text-sm outline-none', align)}
    />
  {:else if canEdit(field)}
    <button type="button" onclick={() => startEdit(row.id, field)} class={cn(CELL_TRIGGER_CLASS, align)}>
      {value || '—'}
    </button>
  {:else}
    <span class={cn('block w-full px-1.5 py-1 text-sm', align)}>{value || '—'}</span>
  {/if}
{/snippet}

{#snippet dateCell(row: EditorRow)}
  {#if canEdit('date')}
    <DatePickerPopover value={row.date} onchange={v => setText(row.id, 'date', v)} class="text-left" />
  {:else}
    <span class="block w-full px-1.5 py-1 text-sm text-left">{row.date || '—'}</span>
  {/if}
{/snippet}

{#snippet symbolCell(row: EditorRow)}
  {#if canEdit('symbol')}
    <SymbolSelect value={row.symbol} options={symbolOptions} onchange={v => setText(row.id, 'symbol', v)} class="text-left" />
  {:else}
    <span class="block w-full px-1.5 py-1 text-sm text-left">{row.symbol || '—'}</span>
  {/if}
{/snippet}

{#snippet numCell(row: EditorRow, field: 'qty' | 'entry' | 'exit' | 'pnl' | 'fees', value: number, extra: string)}
  {#if canEdit(field) && isEditing(row.id, field)}
    <input
      use:focusSelect
      type="number"
      {value}
      oninput={e => setNum(row.id, field, e.currentTarget.valueAsNumber)}
      onblur={stopEdit}
      onkeydown={onCellKey}
      class="h-7 w-full rounded border border-ring bg-background px-1.5 text-right text-sm outline-none"
    />
  {:else if canEdit(field)}
    <button
      type="button"
      onclick={() => startEdit(row.id, field)}
      class={cn('block w-full rounded px-1.5 py-1 text-right text-sm tabular-nums hover:bg-accent', extra)}
    >
      {numText(value)}
    </button>
  {:else}
    <span class={cn('block w-full px-1.5 py-1 text-right text-sm tabular-nums', extra)}>{numText(value)}</span>
  {/if}
{/snippet}

<div class="flex flex-col gap-4">
  <!-- Toolbar -->
  <div class="flex flex-wrap items-center gap-3">
    {#if coreEditable}
      <Button size="sm" onclick={addTrade}><Plus class="size-4" /> Add trade</Button>
      <span class="text-xs text-muted-foreground">Click any cell to edit. Changes are staged until you save.</span>
    {:else if anyCoreEditable}
      <span class="text-xs text-muted-foreground"
        >Click a cell to edit <span class="text-foreground">date/time/symbol/side/qty/P&amp;L</span>, tags or notes. Entry/exit aren't
        stored. Changes are staged until you save.</span
      >
    {:else}
      <span class="text-xs text-muted-foreground"
        >Imported trades are fixed — edit <span class="text-foreground">tags</span> and <span class="text-foreground">notes</span>, or
        delete rows. Changes are staged until you save.</span
      >
    {/if}
    <span class={cn('ml-auto text-sm font-semibold tabular-nums', netPnl >= 0 ? 'text-chart-2' : 'text-destructive')}
      >Net {usdWhole(netPnl)}</span
    >
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
            <TagInput bind:value={bulkTag} suggestions={tagVocab} placeholder="tag…" onadd={() => applyBulkTag()} />
            <Button size="sm" class="h-8" onclick={applyBulkTag}>Add</Button>
          </div>
        </Popover.Content>
      </Popover.Root>
      <Button variant="outline" size="sm" class="h-7 text-destructive" disabled={dataDisabled} onclick={() => askDelete([...selected])}
        ><Trash2 class="size-3.5" /> Delete</Button
      >
      <Button variant="ghost" size="sm" class="ml-auto h-7" onclick={() => (selected = new Set())}>Clear</Button>
    </div>
  {/if}

  <Card.Root>
    <Card.Content class="p-0">
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class="w-9 pl-3"
              ><Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              /></Table.Head
            >
            <Table.Head>Date</Table.Head>
            <Table.Head>Time</Table.Head>
            <Table.Head>Symbol</Table.Head>
            <Table.Head>Side</Table.Head>
            <Table.Head class="text-right">Qty</Table.Head>
            <Table.Head class="text-right">Entry</Table.Head>
            <Table.Head class="text-right">Exit</Table.Head>
            <Table.Head class="text-right">P&L</Table.Head>
            <Table.Head class="text-right">Fees</Table.Head>
            <Table.Head>Platform</Table.Head>
            <Table.Head>Tags</Table.Head>
            <Table.Head>Note</Table.Head>
            <Table.Head>Shots</Table.Head>
            <Table.Head class="w-9"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each pagedRows as row (row.id)}
            {@const dirty = isDirty(row)}
            <Table.Row class={cn(dirty && 'bg-primary/5')} data-state={selected.has(row.id) ? 'selected' : undefined}>
              <Table.Cell class="pl-3">
                <span class="flex items-center gap-1.5">
                  <Checkbox checked={selected.has(row.id)} onCheckedChange={v => toggleRow(row.id, v)} aria-label="Select row" />
                  {#if dirty}<span class="size-1.5 rounded-full bg-primary" title="Unsaved"></span>{/if}
                </span>
              </Table.Cell>
              <Table.Cell class="p-1 text-muted-foreground">{@render dateCell(row)}</Table.Cell>
              <Table.Cell class="p-1 text-muted-foreground">{@render textCell(row, 'time', row.time, 'text-left')}</Table.Cell>
              <Table.Cell class="p-1 font-medium">{@render symbolCell(row)}</Table.Cell>
              <Table.Cell class="p-1">
                {#if canEdit('side')}
                  <button type="button" onclick={() => toggleSide(row.id)} title="Toggle side">
                    <Badge
                      variant="outline"
                      class={row.side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}
                      >{row.side}</Badge
                    >
                  </button>
                {:else}
                  <Badge
                    variant="outline"
                    class={row.side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}
                    >{row.side}</Badge
                  >
                {/if}
              </Table.Cell>
              <Table.Cell class="p-1">{@render numCell(row, 'qty', row.qty, '')}</Table.Cell>
              <Table.Cell class="p-1 text-muted-foreground">{@render numCell(row, 'entry', row.entry, 'text-muted-foreground')}</Table.Cell>
              <Table.Cell class="p-1 text-muted-foreground">{@render numCell(row, 'exit', row.exit, 'text-muted-foreground')}</Table.Cell>
              <Table.Cell class="p-1"
                >{@render numCell(
                  row,
                  'pnl',
                  row.pnl,
                  row.pnl >= 0 ? 'font-semibold text-chart-2' : 'font-semibold text-destructive'
                )}</Table.Cell
              >
              <Table.Cell class="p-1 text-muted-foreground">{@render numCell(row, 'fees', row.fees, 'text-muted-foreground')}</Table.Cell>
              <!-- F46: provenance platform — read-only metadata, never editable -->
              <Table.Cell class="whitespace-nowrap p-1 text-xs text-muted-foreground">{row.platform || '—'}</Table.Cell>
              <Table.Cell class="p-1">
                <Popover.Root
                  onOpenChange={o => {
                    if (o) rowTagDraft = ''; // fresh draft per popover (one is open at a time)
                  }}
                >
                  <Popover.Trigger>
                    {#snippet child({ props })}
                      <button
                        {...props}
                        type="button"
                        class="flex min-h-7 flex-wrap items-center gap-1 rounded px-1.5 py-1 hover:bg-accent"
                      >
                        {#each row.tags as tag (tag)}<Badge variant="secondary" class="px-1.5 py-0">{tag}</Badge>{/each}
                        {#if !row.tags.length}<span class="text-xs text-muted-foreground">+ tag</span>{/if}
                      </button>
                    {/snippet}
                  </Popover.Trigger>
                  <Popover.Content class="w-56" align="start">
                    <div class="mb-2 flex flex-wrap gap-1">
                      {#each row.tags as tag (tag)}
                        <Badge variant="secondary" class="gap-1"
                          >{tag}<button
                            type="button"
                            class="text-muted-foreground hover:text-foreground"
                            onclick={() => removeTag(row.id, tag)}
                            aria-label="Remove tag">×</button
                          ></Badge
                        >
                      {/each}
                      {#if !row.tags.length}<span class="text-xs text-muted-foreground">No tags</span>{/if}
                    </div>
                    <TagInput bind:value={rowTagDraft} suggestions={tagVocab} onadd={t => addTag(row.id, t)} />
                  </Popover.Content>
                </Popover.Root>
              </Table.Cell>
              <Table.Cell class="p-1">
                <Popover.Root>
                  <Popover.Trigger>
                    {#snippet child({ props })}
                      <button
                        {...props}
                        type="button"
                        class="grid size-7 place-items-center rounded hover:bg-accent"
                        title={row.note || 'Add note'}
                      >
                        <StickyNote class={cn('size-4', row.note ? 'text-primary' : 'text-muted-foreground')} />
                      </button>
                    {/snippet}
                  </Popover.Trigger>
                  <Popover.Content class="w-64" align="start">
                    <Textarea
                      value={row.note}
                      oninput={e => setNote(row.id, e.currentTarget.value)}
                      placeholder="Journal note…"
                      class="h-24"
                    />
                  </Popover.Content>
                </Popover.Root>
              </Table.Cell>
              <Table.Cell class="p-1">
                <Popover.Root>
                  <Popover.Trigger>
                    {#snippet child({ props })}
                      <button
                        {...props}
                        type="button"
                        class="flex min-h-7 items-center gap-1 rounded px-1.5 py-1 hover:bg-accent"
                        title={row.shots.length ? `${row.shots.length} screenshot${row.shots.length === 1 ? '' : 's'}` : 'Add screenshot'}
                      >
                        <Image class={cn('size-4', row.shots.length ? 'text-primary' : 'text-muted-foreground')} />
                        {#if row.shots.length}<span class="text-xs tabular-nums text-muted-foreground">{row.shots.length}</span>{/if}
                      </button>
                    {/snippet}
                  </Popover.Trigger>
                  <Popover.Content class="w-64" align="start">
                    <p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Screenshots</p>
                    <div class="flex flex-wrap items-center gap-2">
                      {#each row.shots as shot, i (i)}
                        <span class="relative inline-block">
                          <button type="button" class="block" onclick={() => (zoomShot = shot)} aria-label="Enlarge screenshot {i + 1}">
                            <img src={shot} alt="screenshot {i + 1}" class="block h-12 rounded-md border border-border" />
                          </button>
                          <button
                            type="button"
                            class="absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-destructive text-white"
                            aria-label="Remove screenshot"
                            onclick={() => removeShot(row.id, i)}><X class="size-3" /></button
                          >
                        </span>
                      {/each}
                      {#if !row.shots.length}<span class="text-xs text-muted-foreground">No screenshots</span>{/if}
                    </div>
                    <label
                      class="mt-2 flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ImagePlus class="size-4" /> Add screenshot
                      <input type="file" accept="image/*" class="hidden" onchange={e => addShot(row.id, e)} />
                    </label>
                  </Popover.Content>
                </Popover.Root>
              </Table.Cell>
              <Table.Cell class="p-1">
                <button
                  type="button"
                  class="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Delete trade"
                  disabled={dataDisabled}
                  onclick={() => askDelete([row.id])}
                >
                  <Trash2 class="size-4" />
                </button>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
      {#if draft.length}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span class="tabular-nums">{pager.start.toLocaleString()}–{pager.end.toLocaleString()} of {draft.length.toLocaleString()}</span>
          <div class="ml-auto">
            <PaginationControls {pager} />
          </div>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Sticky save bar -->
  {#if dirtyCount > 0}
    <div class="sticky bottom-0 flex items-center justify-between rounded-md border border-primary/40 bg-card px-4 py-2.5 shadow-lg">
      <span class="flex items-center gap-2 text-sm"
        ><Pencil class="size-4 text-primary" /> {dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}</span
      >
      <div class="flex gap-2">
        <Button variant="ghost" size="sm" onclick={revert} disabled={saving}>Revert</Button>
        <Button size="sm" onclick={saveAll} disabled={saving || dataDisabled}>{saving ? 'Saving…' : 'Save all'}</Button>
      </div>
    </div>
  {/if}
</div>

<!-- Delete confirm -->
<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete {pendingDelete.length} {pendingDelete.length === 1 ? 'trade' : 'trades'}?</AlertDialog.Title>
      <AlertDialog.Description
        >This removes the selected {pendingDelete.length === 1 ? 'trade' : 'trades'} from your data. This can't be undone.</AlertDialog.Description
      >
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={doDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- Screenshot lightbox (shared part — A152) -->
<ScreenshotLightbox shot={zoomShot} onclose={() => (zoomShot = null)} />
