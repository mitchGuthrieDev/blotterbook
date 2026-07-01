<script lang="ts" module>
  export type CsvStatus = 'ok' | 'warnings' | 'errors';
  export type Csv = {
    id: string;
    name: string;
    label?: string;
    platform: string;
    rows: number;
    trades: number;
    imported: string;
    from: string;
    to: string;
    status: CsvStatus;
    sizeKb: number;
    overlap: number;
    included: boolean;
  };
  export type ImportPreview = {
    name: string;
    platform: string;
    rows: number;
    tradeCount: number;
    from: string;
    to: string;
    estimatedRoots: string[];
    /** Fills skipped for an unparseable timestamp (A168) / lots left open at end-of-file (A174) —
     *  import-quality notices from ParseResult; 0 = nothing to report. */
    skippedFills: number;
    openLots: number;
    sample: { time: string; sym: string; side: string; qty: number; pnl: number; up: boolean }[];
    error?: string;
  };
</script>

<script lang="ts">
  // CSV Library surface (UI redesign; Data Management). Manage imported CSVs: a drag-drop/click upload
  // zone that opens a parse-preview Sheet, a Table of files, a detail Sheet, rename + delete dialogs.
  // The app (all surfaces) has no per-file provenance in the Store (only the merged trade set), so file
  // storage is DEFERRED: the upload zone is a REAL importer (Adapters parse → preview → addTrades, via
  // the `parse`/`onimport` props), the table shows one derived "active dataset" row built from the
  // trades, and per-file-only actions (rename/re-import/download/include) are hidden (perFileActions=
  // false). Delete clears the dataset. shadcn-svelte primitives; color in P&L.
  import {
    Upload,
    FileText,
    MoreHorizontal,
    Download,
    Pencil,
    Trash2,
    RefreshCw,
    ExternalLink,
    TriangleAlert,
    CircleCheck,
    CircleX,
    CloudUpload,
  } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { usd } from '../../lib/core/core.ts';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Switch } from '$lib/components/ui/switch';
  import { Input } from '$lib/components/ui/input';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import * as Sheet from '$lib/components/ui/sheet';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Breadcrumb from '$lib/components/ui/breadcrumb';

  interface Props {
    files: Csv[];
    /** Per-file rename/re-import/download/include only make sense with file provenance. */
    perFileActions?: boolean;
    blotterHref?: string;
    /** Parse a picked file's text into a preview (wraps Adapters). */
    parse?: (text: string, name: string) => ImportPreview;
    /** Persist the previewed import (addTrades + reload). */
    onimport?: (preview: ImportPreview) => void | Promise<void>;
    /** Remove a dataset/file (clears the dataset). */
    ondelete?: (id: string) => void | Promise<void>;
    /** Download a full backup of the local data (parent owns file naming). */
    onbackup?: () => void;
    /** Restore from a picked backup file (parent parses/imports + owns any toast). */
    onrestore?: (file: File) => void;
    /** Erase all local data (parent owns the confirm() dialog). */
    onerase?: () => void;
    /** Disable every data-management control (the demo guard). */
    dataDisabled?: boolean;
    /** Result message from a restore, rendered if non-empty (parent-owned). */
    restoreMsg?: string;
  }
  let {
    files,
    perFileActions = true,
    blotterHref = '#blotter',
    parse,
    onimport,
    ondelete,
    onbackup,
    onrestore,
    onerase,
    dataDisabled = false,
    restoreMsg = '',
  }: Props = $props();

  // Internal working copy of the listed files; reseed when the incoming set changes (external import/delete).
  // svelte-ignore state_referenced_locally
  let list = $state<Csv[]>(files.map(f => ({ ...f })));
  // svelte-ignore state_referenced_locally
  let lastKey = files.map(f => `${f.id}:${f.trades}`).join('|');
  $effect(() => {
    const key = files.map(f => `${f.id}:${f.trades}`).join('|');
    if (key !== lastKey) {
      lastKey = key;
      list = files.map(f => ({ ...f }));
    }
  });

  const mapping: [string, string][] = [
    ['Date/Time', 'time'],
    ['Symbol', 'root'],
    ['Side', 'side'],
    ['Qty', 'qty'],
    ['Realized P&L', 'pnl'],
    ['Commission', 'fees'],
  ];

  let openId = $state<string | null>(null); // which file's detail sheet is showing
  let detailOpen = $state(false); // bits-ui owns the detail Sheet's open state (bind:open, per L11)
  const openDetail = (id: string) => {
    openId = id;
    detailOpen = true;
  };
  // Clearing the selection when bits-ui dismisses the sheet — bind:open flips detailOpen → we drop
  // the id after its teardown, instead of a controlled `open={openId!==null}` that skips the scroll-lock
  // release and freezes the page (L11).
  $effect(() => {
    if (!detailOpen) openId = null;
  });
  let uploadOpen = $state(false); // parse-preview sheet
  let renameOpen = $state(false);
  let renameId = $state<string | null>(null);
  let renameVal = $state('');
  let deleteOpen = $state(false);
  let deleteId = $state<string | null>(null);
  let preview = $state<ImportPreview | null>(null);
  let importing = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  let restoreInput = $state<HTMLInputElement | null>(null);

  const openFile = $derived(openId ? list.find(f => f.id === openId) : undefined);
  const delFile = $derived(deleteId ? list.find(f => f.id === deleteId) : undefined);
  const includedCount = $derived(list.filter(f => f.included).length);
  const totalTrades = $derived(list.filter(f => f.included).reduce((s, f) => s + f.trades, 0));
  const fmt = (n: number) => n.toLocaleString();
  const size = (kb: number) => (kb <= 0 ? '—' : kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);

  function pickFile() {
    if (dataDisabled) return; // A134: no uploading in demo
    if (parse) fileInput?.click();
  }
  async function handleFile(file: File | undefined) {
    if (!file || !parse || dataDisabled) return;
    const text = await file.text();
    preview = parse(text, file.name);
    uploadOpen = true;
  }
  async function onFilePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    await handleFile(file);
  }
  // A160: the dropzone advertised drag & drop but implemented none — the browser default then
  // NAVIGATED the tab to the dropped file. The wrapper (not the disable-able button) owns the drag
  // events so a drop is always intercepted; the demo guard just swallows it.
  let dragging = $state(false);
  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = !dataDisabled;
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (dataDisabled) return; // demo: reject the drop (and the navigation default)
    void handleFile(e.dataTransfer?.files?.[0]);
  }
  async function confirmImport() {
    if (!preview || preview.error || dataDisabled) return;
    importing = true;
    try {
      await onimport?.(preview);
    } finally {
      importing = false;
    }
    uploadOpen = false;
    preview = null;
  }

  function onRestorePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || dataDisabled) return;
    onrestore?.(file);
  }

  function toggleInclude(id: string, v: boolean) {
    list = list.map(f => (f.id === id ? { ...f, included: v } : f));
  }
  function startRename(f: Csv) {
    renameId = f.id;
    renameVal = f.label ?? f.name;
    renameOpen = true;
  }
  function saveRename() {
    list = list.map(f => (f.id === renameId ? { ...f, label: renameVal.trim() || undefined } : f));
    renameOpen = false;
  }
  function askDelete(id: string) {
    deleteId = id;
    deleteOpen = true;
  }
  async function doDelete() {
    const id = deleteId;
    list = list.filter(f => f.id !== id);
    deleteOpen = false;
    if (openId === id) detailOpen = false;
    if (id && ondelete) await ondelete(id);
  }
</script>

{#snippet status(s: CsvStatus)}
  {#if s === 'ok'}
    <Badge variant="outline" class="border-chart-2/40 text-chart-2"><CircleCheck class="size-3" /> Imported</Badge>
  {:else if s === 'warnings'}
    <Badge variant="outline" class="border-chart-4/40 text-chart-4"><TriangleAlert class="size-3" /> Warnings</Badge>
  {:else}
    <Badge variant="outline" class="border-destructive/40 text-destructive"><CircleX class="size-3" /> Errors</Badge>
  {/if}
{/snippet}

<div class="flex flex-col gap-4">
  <Breadcrumb.Root>
    <Breadcrumb.List>
      <Breadcrumb.Item><Breadcrumb.Link>Data Management</Breadcrumb.Link></Breadcrumb.Item>
      <Breadcrumb.Separator />
      <Breadcrumb.Item><Breadcrumb.Page>CSV Library</Breadcrumb.Page></Breadcrumb.Item>
    </Breadcrumb.List>
  </Breadcrumb.Root>

  <input bind:this={fileInput} type="file" accept=".csv,text/csv" class="hidden" onchange={onFilePicked} />

  <!-- Upload dropzone (A134: disabled in demo — the demo dataset is fixed; A160: real drop handling) -->
  <!-- svelte-ignore a11y_no_static_element_interactions — drag-only wrapper; the button inside is the control -->
  <div ondragover={onDragOver} ondragleave={() => (dragging = false)} ondrop={onDrop}>
    <button
      type="button"
      onclick={pickFile}
      disabled={dataDisabled}
      class={cn(
        'flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-card py-8 text-center transition-colors hover:border-ring hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card',
        dragging ? 'border-primary bg-accent' : 'border-border'
      )}
    >
      <span class="grid size-10 place-items-center rounded-full border border-border text-muted-foreground"
        ><CloudUpload class="size-5" /></span
      >
      <span class="text-sm font-medium text-foreground">Drag &amp; drop CSVs, or click to browse</span>
      <span class="text-xs text-muted-foreground"
        >{dataDisabled
          ? 'Importing is disabled in the demo — explore the sample dataset'
          : 'TradingView, Tradovate, NinjaTrader, Apex… — auto-detected'}</span
      >
    </button>
  </div>

  <!-- File table -->
  <Card.Root>
    <Card.Header>
      <Card.Title>{perFileActions ? 'Uploaded files' : 'Active dataset'}</Card.Title>
      <span class="text-xs text-muted-foreground">
        {#if perFileActions}{includedCount} of {list.length} included · {fmt(totalTrades)} trades{:else}{fmt(totalTrades)} trades imported{/if}
      </span>
    </Card.Header>
    <Card.Content class="p-0">
      {#if list.length === 0}
        <p class="px-4 py-10 text-center text-sm text-muted-foreground">No trades yet — drop a CSV above to import.</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head class="pl-4">File</Table.Head>
              <Table.Head>Platform</Table.Head>
              <Table.Head class="text-right">Trades</Table.Head>
              <Table.Head>Coverage</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head class="text-right">Size</Table.Head>
              <Table.Head>Health</Table.Head>
              {#if perFileActions}<Table.Head class="text-center">Included</Table.Head>{/if}
              <Table.Head class="w-9"></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each list as f (f.id)}
              <Table.Row class={cn('cursor-pointer', !f.included && 'opacity-55')} onclick={() => openDetail(f.id)}>
                <Table.Cell class="pl-4">
                  <span class="flex items-center gap-2">
                    <FileText class="size-4 shrink-0 text-muted-foreground" />
                    <!-- A real button so keyboard users can open the detail sheet (the row onclick is mouse-only). -->
                    <button
                      type="button"
                      class="rounded font-medium hover:underline focus-visible:underline"
                      onclick={() => openDetail(f.id)}>{f.label ?? f.name}</button
                    >
                  </span>
                </Table.Cell>
                <Table.Cell><Badge variant="secondary">{f.platform}</Badge></Table.Cell>
                <Table.Cell class="text-right tabular-nums">{fmt(f.trades)}</Table.Cell>
                <Table.Cell class="text-xs text-muted-foreground">{f.from} → {f.to}</Table.Cell>
                <Table.Cell>{@render status(f.status)}</Table.Cell>
                <Table.Cell class="text-right tabular-nums text-muted-foreground">{size(f.sizeKb)}</Table.Cell>
                <Table.Cell>
                  {#if f.overlap > 0}
                    <span class="text-xs text-chart-4">{f.overlap} overlap</span>
                  {:else}
                    <span class="text-xs text-muted-foreground">—</span>
                  {/if}
                </Table.Cell>
                {#if perFileActions}
                  <Table.Cell class="text-center" onclick={e => e.stopPropagation()}>
                    <Switch checked={f.included} onCheckedChange={v => toggleInclude(f.id, v)} aria-label="Include in dataset" />
                  </Table.Cell>
                {/if}
                <Table.Cell onclick={e => e.stopPropagation()}>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      {#snippet child({ props })}
                        <button
                          {...props}
                          type="button"
                          class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label="File actions"
                        >
                          <MoreHorizontal class="size-4" />
                        </button>
                      {/snippet}
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" class="min-w-[160px]">
                      {#if perFileActions}
                        <DropdownMenu.Item onSelect={() => openDetail(f.id)}><RefreshCw class="size-4" /> Re-import</DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => startRename(f)}><Pencil class="size-4" /> Rename</DropdownMenu.Item>
                        <DropdownMenu.Item><Download class="size-4" /> Download original</DropdownMenu.Item>
                        <DropdownMenu.Separator />
                      {/if}
                      <DropdownMenu.Item class="text-destructive" onSelect={() => askDelete(f.id)}>
                        <Trash2 class="size-4" /> Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Data management: backup / restore / erase-all (parity with legacy ManageData) -->
  <input bind:this={restoreInput} type="file" accept="application/json,.json" class="hidden" onchange={onRestorePicked} />
  <Card.Root>
    <Card.Header>
      <Card.Title>Data management</Card.Title>
      <span class="text-xs text-muted-foreground">Back up, restore, or erase all your local data.</span>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={dataDisabled} onclick={() => onbackup?.()}>
          <Download class="size-4" /> Download backup
        </Button>
        <Button variant="outline" size="sm" disabled={dataDisabled} onclick={() => restoreInput?.click()}>
          <Upload class="size-4" /> Restore backup
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="text-destructive hover:text-destructive"
          disabled={dataDisabled}
          onclick={() => onerase?.()}
        >
          <Trash2 class="size-4" /> Erase all data
        </Button>
      </div>
      {#if restoreMsg}
        <p class="text-xs text-muted-foreground">{restoreMsg}</p>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

<!-- Detail sheet -->
<Sheet.Root bind:open={detailOpen}>
  <Sheet.Content side="right" class="w-full sm:max-w-md">
    {#if openFile}
      <Sheet.Header>
        <Sheet.Title class="flex items-center gap-2"><FileText class="size-4" /> {openFile.label ?? openFile.name}</Sheet.Title>
        <Sheet.Description class="flex items-center gap-2">
          <Badge variant="secondary">{openFile.platform}</Badge>
          {@render status(openFile.status)}
        </Sheet.Description>
      </Sheet.Header>
      <div class="flex-1 space-y-4 overflow-y-auto p-4">
        <div class="grid grid-cols-2 gap-2 text-sm">
          {#snippet kv(label: string, value: string)}
            <div class="rounded-md border border-border bg-background px-3 py-2">
              <div class="text-[11px] text-muted-foreground">{label}</div>
              <div class="mt-0.5 font-semibold tabular-nums">{value}</div>
            </div>
          {/snippet}
          {@render kv('Rows parsed', fmt(openFile.rows))}
          {@render kv('Trades', fmt(openFile.trades))}
          {@render kv('Coverage', `${openFile.from} → ${openFile.to}`)}
          {@render kv('Imported', openFile.imported || '—')}
          {@render kv('Size', size(openFile.sizeKb))}
          {@render kv('Overlap', openFile.overlap > 0 ? `${openFile.overlap} rows` : 'None')}
        </div>

        <div>
          <div class="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Column mapping</div>
          <div class="overflow-hidden rounded-md border border-border">
            {#each mapping as [col, field], i (col)}
              <div class={cn('flex items-center justify-between px-3 py-1.5 text-xs', i > 0 && 'border-t border-border')}>
                <span class="text-muted-foreground">{col}</span>
                <span class="flex items-center gap-1.5 font-medium"><span class="text-muted-foreground">→</span> {field}</span>
              </div>
            {/each}
          </div>
        </div>

        <div class="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
          <span class="text-muted-foreground">{fmt(openFile.trades)} trades contributed</span>
          <a href={blotterHref} class="flex items-center gap-1 text-foreground hover:underline"
            >View in Blotter <ExternalLink class="size-3" /></a
          >
        </div>
      </div>
      <Sheet.Footer class="flex-row justify-between">
        {#if perFileActions}<Button variant="outline" size="sm"><RefreshCw class="size-4" /> Re-import</Button>{/if}
        <Button variant="outline" size="sm" class="text-destructive" onclick={() => askDelete(openFile.id)}
          ><Trash2 class="size-4" /> Delete</Button
        >
      </Sheet.Footer>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<!-- Upload parse-preview sheet -->
<Sheet.Root bind:open={uploadOpen}>
  <Sheet.Content side="right" class="w-full sm:max-w-md">
    <Sheet.Header>
      <Sheet.Title class="flex items-center gap-2"><Upload class="size-4" /> Import CSV</Sheet.Title>
      <Sheet.Description>Review the detected parse before importing.</Sheet.Description>
    </Sheet.Header>
    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      {#if preview?.error}
        <div class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleX class="size-4 shrink-0" />
          <span>{preview.error}</span>
        </div>
      {:else if preview}
        <div class="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
          <FileText class="size-4 text-muted-foreground" />
          <span class="font-medium">{preview.name}</span>
          <Badge variant="secondary" class="ml-auto">{preview.platform}</Badge>
        </div>
        <p class="text-sm text-muted-foreground">
          Parsed <b class="text-foreground">{fmt(preview.rows)} rows</b> → <b class="text-foreground">{fmt(preview.tradeCount)} trades</b> ·
          covers <b class="text-foreground">{preview.from} → {preview.to}</b>.
        </p>
        {#if preview.sample.length}
          <div>
            <div class="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sample rows</div>
            <div class="overflow-hidden rounded-md border border-border">
              <Table.Root>
                <Table.Header>
                  <Table.Row class="hover:bg-transparent">
                    <Table.Head class="pl-3">Time</Table.Head><Table.Head>Symbol</Table.Head><Table.Head>Side</Table.Head>
                    <Table.Head class="text-right">Qty</Table.Head><Table.Head class="text-right pr-3">P&L</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {#each preview.sample as r, i (i)}
                    <Table.Row>
                      <Table.Cell class="pl-3 text-muted-foreground">{r.time}</Table.Cell>
                      <Table.Cell class="font-medium">{r.sym}</Table.Cell>
                      <Table.Cell
                        ><Badge variant="outline" class={r.up ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}
                          >{r.side}</Badge
                        ></Table.Cell
                      >
                      <Table.Cell class="text-right tabular-nums">{r.qty}</Table.Cell>
                      <Table.Cell class={cn('text-right tabular-nums pr-3', r.up ? 'text-chart-2' : 'text-destructive')}
                        >{usd(r.pnl)}</Table.Cell
                      >
                    </Table.Row>
                  {/each}
                </Table.Body>
              </Table.Root>
            </div>
          </div>
        {/if}
        {#if preview.estimatedRoots.length}
          <div class="flex items-start gap-2 rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert class="size-4 shrink-0 text-chart-4" />
            <span
              >{preview.estimatedRoots.length} symbol{preview.estimatedRoots.length === 1 ? '' : 's'} ({preview.estimatedRoots.join(', ')})
              have no contract size on file — their P&L was estimated at $1/point. Double-check before importing.</span
            >
          </div>
        {/if}
        {#if preview.skippedFills > 0 || preview.openLots > 0}
          <div class="flex items-start gap-2 rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert class="size-4 shrink-0 text-chart-4" />
            <span>
              {#if preview.skippedFills > 0}
                {preview.skippedFills} fill{preview.skippedFills === 1 ? '' : 's'} skipped (unreadable timestamp) — the affected round trips are
                missing from the import.
              {/if}
              {#if preview.openLots > 0}
                {preview.openLots} position{preview.openLots === 1 ? '' : 's'} still open at the end of the file (or the export was truncated)
                — open lots aren't imported; re-export after they close.
              {/if}
            </span>
          </div>
        {/if}
      {/if}
    </div>
    <Sheet.Footer class="flex-row justify-end">
      <Button variant="ghost" size="sm" onclick={() => (uploadOpen = false)}>Cancel</Button>
      <Button size="sm" disabled={!preview || !!preview.error || importing || dataDisabled} onclick={confirmImport}>
        {importing ? 'Importing…' : preview && !preview.error ? `Import ${fmt(preview.tradeCount)} trades` : 'Import'}
      </Button>
    </Sheet.Footer>
  </Sheet.Content>
</Sheet.Root>

<!-- Rename dialog -->
<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>Rename file</Dialog.Title>
      <Dialog.Description>A friendly label shown instead of the filename.</Dialog.Description>
    </Dialog.Header>
    <Input bind:value={renameVal} placeholder="Display name" />
    <Dialog.Footer>
      <Button variant="ghost" size="sm" onclick={() => (renameOpen = false)}>Cancel</Button>
      <Button size="sm" onclick={saveRename}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete confirm -->
<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete {delFile?.label ?? delFile?.name}?</AlertDialog.Title>
      <AlertDialog.Description>
        This removes the {perFileActions ? 'file' : 'dataset'} and its {fmt(delFile?.trades ?? 0)} trades from your data. This can't be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={doDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
