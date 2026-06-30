<script lang="ts">
  // CSV Library surface mockup (UI redesign, Phase 2 — 5th screen; first of Data Management). Manage
  // uploaded CSVs: a drag-drop upload zone that opens a parse-preview Sheet, a Table of files (core +
  // coverage + storage + data-health metadata, an include/exclude Switch, and a row-actions menu), a
  // detail Sheet (parse summary + column mapping + contributed trades), a rename Dialog, and a delete
  // Alert dialog. Built on the shadcn-svelte primitives. Representative static data; color only in P&L.
  import {
    Upload, FileText, MoreHorizontal, Download, Pencil, Trash2, RefreshCw, ExternalLink,
    TriangleAlert, CircleCheck, CircleX, CloudUpload,
  } from '@lucide/svelte';
  import { cn } from '$lib/utils';
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

  type Status = 'ok' | 'warnings' | 'errors';
  type Csv = {
    id: string; name: string; label?: string; platform: string; rows: number; trades: number;
    imported: string; from: string; to: string; status: Status; sizeKb: number; overlap: number; included: boolean;
  };
  let files = $state<Csv[]>([
    { id: 'c1', name: 'tradovate-2026-q2.csv', platform: 'Tradovate', rows: 1240, trades: 1180, imported: '2026-06-28', from: '2026-04-01', to: '2026-06-27', status: 'ok', sizeKb: 312, overlap: 0, included: true },
    { id: 'c2', name: 'tradingview-jun.csv', label: 'TradingView · June', platform: 'TradingView', rows: 420, trades: 412, imported: '2026-06-25', from: '2026-06-01', to: '2026-06-24', status: 'warnings', sizeKb: 96, overlap: 12, included: true },
    { id: 'c3', name: 'ninjatrader-export.csv', platform: 'NinjaTrader', rows: 880, trades: 865, imported: '2026-05-30', from: '2026-03-15', to: '2026-05-29', status: 'ok', sizeKb: 201, overlap: 0, included: true },
    { id: 'c4', name: 'apex-eval.csv', platform: 'Apex', rows: 60, trades: 0, imported: '2026-05-12', from: '—', to: '—', status: 'errors', sizeKb: 14, overlap: 0, included: false },
    { id: 'c5', name: 'old-account.csv', platform: 'TradingView', rows: 2100, trades: 2050, imported: '2026-02-02', from: '2025-09-01', to: '2026-01-31', status: 'ok', sizeKb: 540, overlap: 0, included: false },
  ]);

  const mapping: [string, string][] = [
    ['Date/Time', 'time'], ['Symbol', 'root'], ['Side', 'side'], ['Qty', 'qty'], ['Realized P&L', 'pnl'], ['Commission', 'fees'],
  ];
  const sample = [
    { time: '09:34', sym: 'ES', side: 'Long', qty: 2, pnl: '+$375.00', up: true },
    { time: '10:18', sym: 'NQ', side: 'Short', qty: 1, pnl: '-$230.00', up: false },
    { time: '11:46', sym: 'ES', side: 'Long', qty: 3, pnl: '+$562.00', up: true },
  ];

  let openId = $state<string | null>(null); // detail sheet
  let uploadOpen = $state(false); // parse-preview sheet
  let renameOpen = $state(false);
  let renameId = $state<string | null>(null);
  let renameVal = $state('');
  let deleteOpen = $state(false);
  let deleteId = $state<string | null>(null);

  const openFile = $derived(openId ? files.find(f => f.id === openId) : undefined);
  const delFile = $derived(deleteId ? files.find(f => f.id === deleteId) : undefined);
  const includedCount = $derived(files.filter(f => f.included).length);
  const totalTrades = $derived(files.filter(f => f.included).reduce((s, f) => s + f.trades, 0));
  const fmt = (n: number) => n.toLocaleString();
  const size = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);

  function toggleInclude(id: string, v: boolean) {
    files = files.map(f => (f.id === id ? { ...f, included: v } : f));
  }
  function startRename(f: Csv) {
    renameId = f.id;
    renameVal = f.label ?? f.name;
    renameOpen = true;
  }
  function saveRename() {
    files = files.map(f => (f.id === renameId ? { ...f, label: renameVal.trim() || undefined } : f));
    renameOpen = false;
  }
  function askDelete(id: string) {
    deleteId = id;
    deleteOpen = true;
  }
  function doDelete() {
    files = files.filter(f => f.id !== deleteId);
    deleteOpen = false;
    if (openId === deleteId) openId = null;
  }
</script>

{#snippet status(s: Status)}
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

  <!-- Upload dropzone -->
  <button
    type="button"
    onclick={() => (uploadOpen = true)}
    class="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card py-8 text-center transition-colors hover:border-ring hover:bg-accent"
  >
    <span class="grid size-10 place-items-center rounded-full border border-border text-muted-foreground"><CloudUpload class="size-5" /></span>
    <span class="text-sm font-medium text-foreground">Drag &amp; drop CSVs, or click to browse</span>
    <span class="text-xs text-muted-foreground">TradingView, Tradovate, NinjaTrader, Apex… — auto-detected</span>
  </button>

  <!-- File table -->
  <Card.Root>
    <Card.Header>
      <Card.Title>Uploaded files</Card.Title>
      <span class="text-xs text-muted-foreground">{includedCount} of {files.length} included · {fmt(totalTrades)} trades</span>
    </Card.Header>
    <Card.Content class="p-0">
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
            <Table.Head class="text-center">Included</Table.Head>
            <Table.Head class="w-9"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each files as f (f.id)}
            <Table.Row class={cn('cursor-pointer', !f.included && 'opacity-55')} onclick={() => (openId = f.id)}>
              <Table.Cell class="pl-4">
                <span class="flex items-center gap-2">
                  <FileText class="size-4 shrink-0 text-muted-foreground" />
                  <span class="font-medium">{f.label ?? f.name}</span>
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
              <Table.Cell class="text-center" onclick={e => e.stopPropagation()}>
                <Switch checked={f.included} onCheckedChange={v => toggleInclude(f.id, v)} aria-label="Include in dataset" />
              </Table.Cell>
              <Table.Cell onclick={e => e.stopPropagation()}>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <button {...props} type="button" class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="File actions">
                        <MoreHorizontal class="size-4" />
                      </button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" class="min-w-[160px]">
                    <DropdownMenu.Item onSelect={() => (openId = f.id)}>
                      <RefreshCw class="size-4" /> Re-import
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => startRename(f)}>
                      <Pencil class="size-4" /> Rename
                    </DropdownMenu.Item>
                    <DropdownMenu.Item>
                      <Download class="size-4" /> Download original
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item class="text-destructive" onSelect={() => askDelete(f.id)}>
                      <Trash2 class="size-4" /> Delete
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
        <Table.Footer>
          <Table.Row class="hover:bg-transparent">
            <Table.Cell colspan={9} class="pl-4">
              <span class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{files.length} files</span>
                <span>{fmt(totalTrades)} trades in active dataset</span>
              </span>
            </Table.Cell>
          </Table.Row>
        </Table.Footer>
      </Table.Root>
    </Card.Content>
  </Card.Root>
</div>

<!-- Detail sheet -->
<Sheet.Root open={openId !== null} onOpenChange={o => { if (!o) openId = null; }}>
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
          {@render kv('Imported', openFile.imported)}
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
          <a href="/dev/app.html#blotter" class="flex items-center gap-1 text-foreground hover:underline">View in Blotter <ExternalLink class="size-3" /></a>
        </div>
      </div>
      <Sheet.Footer class="flex-row justify-between">
        <Button variant="outline" size="sm"><RefreshCw class="size-4" /> Re-import</Button>
        <Button variant="outline" size="sm" class="text-destructive" onclick={() => askDelete(openFile.id)}><Trash2 class="size-4" /> Delete</Button>
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
      <div class="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
        <FileText class="size-4 text-muted-foreground" />
        <span class="font-medium">tradovate-2026-q3.csv</span>
        <Badge variant="secondary" class="ml-auto">Tradovate</Badge>
      </div>
      <p class="text-sm text-muted-foreground">Parsed <b class="text-foreground">318 rows</b> → <b class="text-foreground">305 trades</b> · covers <b class="text-foreground">2026-07-01 → 2026-09-28</b>.</p>
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
              {#each sample as r (r.time)}
                <Table.Row>
                  <Table.Cell class="pl-3 text-muted-foreground">{r.time}</Table.Cell>
                  <Table.Cell class="font-medium">{r.sym}</Table.Cell>
                  <Table.Cell><Badge variant="outline" class={r.up ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}>{r.side}</Badge></Table.Cell>
                  <Table.Cell class="text-right tabular-nums">{r.qty}</Table.Cell>
                  <Table.Cell class={cn('text-right tabular-nums pr-3', r.up ? 'text-chart-2' : 'text-destructive')}>{r.pnl}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      </div>
      <div class="flex items-start gap-2 rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2 text-xs text-muted-foreground">
        <TriangleAlert class="size-4 shrink-0 text-chart-4" />
        <span>2 symbols have no contract size on file — their P&L was estimated at $1/point. Double-check before importing.</span>
      </div>
    </div>
    <Sheet.Footer class="flex-row justify-end">
      <Button variant="ghost" size="sm" onclick={() => (uploadOpen = false)}>Cancel</Button>
      <Button size="sm" onclick={() => (uploadOpen = false)}>Import 305 trades</Button>
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
        This removes the file and its {fmt(delFile?.trades ?? 0)} trades from your data. This can't be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={doDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
