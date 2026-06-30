<script lang="ts">
  // Manage-data modal (A27): the all-trades table + per-trade tag/note editor, CSV import, backup
  // export/restore, and erase. All persistence + parsing reuse the verbatim core (Store seam +
  // Adapters — A29); this component is only the view. Per-trade screenshots from the vanilla editor
  // are deferred. Operations that change the dataset call onchanged() so App recomputes the dashboard.
  import { onMount, getContext } from 'svelte';
  import { Adapters } from '../../lib/adapters.ts';
  import { usd, money, emit, PAGE_MODE } from '../../lib/core.ts';
  import type { Trade, TradeMeta, StoredJournal, StoredTradeMeta, SavedFilter, StoreLike } from '../../lib/types.ts';
  import { readImage, downloadBlob } from '../lib/files.ts';
  import * as Dialog from '$ui/dialog';
  import { Button } from '$ui/button';

  const isDemo = PAGE_MODE === 'demo'; // demo is a read-only preview — write controls disabled + guarded (B23)
  const isStaging = PAGE_MODE === 'staging';
  // A86: only the staging sandbox brands its backup file + erase copy as "staging"; prod/demo are neutral.
  const BACKUP_NAME = isStaging ? 'blotterbook-staging-backup.json' : 'blotterbook-backup.json';

  interface Props {
    onclose: () => void;
    onchanged: () => void;
    onopenday?: (d: string) => void;
    savedFilters?: SavedFilter[];
    onapplyview?: (sf: SavedFilter) => void;
    onrenameview?: (id: string, name: string) => void;
    ondeleteview?: (id: string) => void;
  }
  let {
    onclose,
    onchanged,
    onopenday = () => {},
    savedFilters = [], // A53: saved views (from App) — applied/renamed/deleted here too
    onapplyview = () => {},
    onrenameview = () => {},
    ondeleteview = () => {},
  }: Props = $props();
  const store = getContext('bb:store') as StoreLike; // A31: Store or DemoStore, chosen by App per mode

  let trades = $state<Trade[]>([]);
  let metaMap = $state(new Map<string, StoredTradeMeta>());
  let dayNotes = $state<StoredJournal[]>([]);
  let localKb = $state('—'); // A52: approximate local footprint
  let search = $state('');

  // A52: Overview stats (parity with vanilla #dm_summary).
  const dmRange = $derived(trades.length ? `${trades[0].date} → ${trades[trades.length - 1].date}` : '—');
  let editing = $state<string | null>(null); // trade id under edit
  let editTags = $state('');
  let editNote = $state('');
  let editShots = $state<string[]>([]);
  let msg = $state('');

  let csvInput: HTMLInputElement;
  let backupInput: HTMLInputElement;
  let editShotInput = $state<HTMLInputElement>();

  const filtered = $derived(
    search.trim()
      ? trades.filter(t => (t.symbol + ' ' + t.date).toLowerCase().includes(search.trim().toLowerCase()))
      : trades
  );

  // A73 (promoted to all surfaces, CH16): page the trades table so a large import doesn't render
  // thousands of rows at once. Search runs over the FULL `filtered` set; only the rendered window is
  // sliced.
  const PAGE_SIZE = 50;
  const paged = true;
  let page = $state(0);
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const visible = $derived(paged ? filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : filtered);
  // A new search jumps back to the first page; a delete that shrinks the set keeps `page` in range.
  $effect(() => {
    search;
    page = 0;
  });
  $effect(() => {
    if (page > pageCount - 1) page = Math.max(0, pageCount - 1);
  });

  onMount(reload);

  async function reload() {
    trades = await store.getAllTrades();
    const all = await store.allTradeMeta();
    metaMap = new Map(all.map(m => [m.id, m] as const));
    dayNotes = await store.getAllJournal();
    try {
      localKb = (new Blob([JSON.stringify(await store.exportAll())]).size / 1024).toFixed(1) + ' KB';
    } catch (_) {
      localKb = '—';
    }
  }

  async function deleteDay(date: string) {
    if (isDemo) return;
    if (!confirm(`Delete the note for ${date}?`)) return;
    await store.deleteJournal(date);
    await reload();
    onchanged();
  }

  function renameView(sf: SavedFilter) {
    const name = (window.prompt('Rename saved filter:', sf.name) || '').trim();
    if (name && name !== sf.name) onrenameview(sf.id, name);
  }

  const metaOf = (t: Trade): TradeMeta => (metaMap.get(store.tradeId(t)) as TradeMeta) || { tags: [], note: '', shots: [] };

  function openEdit(t: Trade) {
    const id = store.tradeId(t);
    const m = (metaMap.get(id) || {}) as TradeMeta;
    editing = id;
    editTags = (m.tags || []).join(', ');
    editNote = m.note || '';
    editShots = m.shots || [];
  }

  async function addEditShot(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const url = await readImage(f);
    if (url && store.validShot(url)) editShots = [...editShots, url];
    else msg = 'Only image screenshots are allowed.';
  }

  async function deleteTrade(t: Trade) {
    if (isDemo) return;
    const id = store.tradeId(t);
    if (!confirm(`Delete this ${t.symbol} trade on ${t.date}? This also removes its tags, note and screenshots.`)) return;
    await store.deleteTrade(id);
    await store.deleteTradeMeta(id); // B40: don't orphan the trade's tags/note/screenshots
    if (editing === id) editing = null;
    emit('trade:deleted', { id });
    await reload();
    onchanged();
  }

  async function saveEdit() {
    if (isDemo) return;
    const tags = [...new Set(editTags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
    if (editing) await store.saveTradeMeta(editing, { tags, note: editNote, shots: editShots });
    editing = null;
    emit('trade:edited');
    await reload();
    onchanged();
  }

  async function importCSV(e: Event) {
    if (isDemo) return;
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const r = Adapters.parse(await f.text());
    if (!r.ok) {
      msg = r.error || 'Could not parse that CSV.';
      return;
    }
    const res = await store.addTrades(r.trades || []);
    msg = `Imported ${res.added} new trade${res.added === 1 ? '' : 's'} (${res.duplicate} duplicate).`;
    // A113: flag any symbols whose PnL was estimated at $1/point (unknown contract size).
    if (r.estimatedRoots?.length)
      msg += ` ⚠ P&L for ${r.estimatedRoots.join(', ')} was estimated at $1/point (no contract size on file) — verify those symbols.`;
    emit('data:imported', { added: res.added });
    await reload();
    onchanged();
  }

  async function exportBackup() {
    const data = await store.exportAll();
    downloadBlob(BACKUP_NAME, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    msg = 'Backup downloaded.';
    emit('backup:created');
  }

  async function importBackup(e: Event) {
    if (isDemo) return;
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const res = await store.importAll(JSON.parse(await f.text()));
      msg = `Restored ${res.added} trade${res.added === 1 ? '' : 's'} (${res.dup} duplicate).`;
      emit('data:imported', { added: res.added });
      await reload();
      onchanged();
    } catch (err) {
      msg = 'That backup file could not be read.';
    }
  }

  async function eraseAll() {
    if (isDemo) return;
    const where = isStaging ? ' in this staging sandbox' : '';
    if (!confirm(`Erase ALL trades, day-notes and per-trade tags/notes${where}? This cannot be undone.`)) return;
    await store.purge();
    msg = isStaging ? 'All staging data erased.' : 'All local data erased.';
    emit('data:erased');
    await reload();
    onchanged();
  }
</script>

<!-- Escape cancels an open per-trade editor first, otherwise closes the modal (A42) — handled via
     bits-ui's onEscapeKeydown (preventDefault keeps the dialog open while we clear the editor). -->
<Dialog.Root open onOpenChange={(o: boolean) => !o && onclose()}>
  <Dialog.Content
    class="modal top-[4vh] flex max-h-[92vh] max-w-[960px] flex-col overflow-hidden"
    aria-label="Manage data"
    onEscapeKeydown={(e: KeyboardEvent) => {
      if (editing) {
        e.preventDefault();
        editing = null;
      }
    }}
  >
    <div class="flex items-center justify-between border-b border-line px-4 py-3.5">
      <h2 class="m-0 text-[15px]">Manage data</h2>
      <Dialog.Close class="x cursor-pointer border-0 bg-transparent text-[22px] leading-none text-dim hover:text-txt" aria-label="Close"
        >×</Dialog.Close
      >
    </div>

    <div class="summary grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2 border-b border-line px-4 py-3">
      <div class="dmstat rounded-[7px] border border-line bg-panel2 px-[9px] py-[7px]">
        <div class="text-[10px] uppercase tracking-[0.4px] text-faint">Trades</div>
        <div class="dv mt-[3px] text-[14px] font-bold text-txt">{trades.length}</div>
      </div>
      <div class="dmstat rounded-[7px] border border-line bg-panel2 px-[9px] py-[7px]">
        <div class="text-[10px] uppercase tracking-[0.4px] text-faint">Date range</div>
        <div class="dv mt-[3px] font-mono text-[12px] font-bold text-txt">{dmRange}</div>
      </div>
      <div class="dmstat rounded-[7px] border border-line bg-panel2 px-[9px] py-[7px]">
        <div class="text-[10px] uppercase tracking-[0.4px] text-faint">Day notes</div>
        <div class="dv mt-[3px] text-[14px] font-bold text-txt">{dayNotes.length}</div>
      </div>
      <div class="dmstat rounded-[7px] border border-line bg-panel2 px-[9px] py-[7px]">
        <div class="text-[10px] uppercase tracking-[0.4px] text-faint">Tagged trades</div>
        <div class="dv mt-[3px] text-[14px] font-bold text-txt">{metaMap.size}</div>
      </div>
      <div class="dmstat rounded-[7px] border border-line bg-panel2 px-[9px] py-[7px]">
        <div class="text-[10px] uppercase tracking-[0.4px] text-faint">Local size</div>
        <div class="dv mt-[3px] font-mono text-[12px] font-bold text-txt">{localKb}</div>
      </div>
    </div>

    {#if isDemo}<p class="demonote m-0 border-b border-line px-4 py-2 text-[12px] text-warn">This is a read-only demo — loading, editing, importing and erasing are disabled, and nothing is saved.</p>{/if}

    <div class="toolbar flex flex-wrap gap-2 border-b border-line px-4 py-3">
      <Button disabled={isDemo} onclick={() => csvInput.click()}>Load CSV</Button>
      <Button disabled={isDemo} onclick={exportBackup}>Export backup</Button>
      <Button disabled={isDemo} onclick={() => backupInput.click()}>Import backup</Button>
      <button type="button" class="cursor-pointer rounded-md border border-[rgba(240,74,74,0.5)] bg-panel2 px-3 py-[7px] text-[13px] text-red hover:bg-red-bg disabled:cursor-not-allowed disabled:opacity-45" disabled={isDemo} onclick={eraseAll}>Erase all local data</button>
      <input type="text" class="search ml-auto min-w-[180px] cursor-text rounded-md border border-line bg-panel2 px-3 py-[7px] text-[13px] text-txt" placeholder="Search symbol / date" bind:value={search} />
      <input bind:this={csvInput} type="file" accept=".csv,text/csv" hidden onchange={importCSV} />
      <input bind:this={backupInput} type="file" accept="application/json,.json" hidden onchange={importBackup} />
    </div>
    {#if msg}<p class="m-0 border-b border-line px-4 py-2 text-[12px] text-primary">{msg}</p>{/if}

    {#if dayNotes.length}
      <details class="daynotes border-b border-line px-4 py-2 [&_summary]:cursor-pointer [&_summary]:text-[12px] [&_summary]:font-bold [&_summary]:uppercase [&_summary]:tracking-[0.5px] [&_summary]:text-faint [&_ul]:m-0 [&_ul]:mt-2 [&_ul]:list-none [&_ul]:p-0 [&_li]:flex [&_li]:items-center [&_li]:gap-2.5 [&_li]:border-b [&_li]:border-line [&_li]:py-[5px] [&_li]:text-[12px]">
        <summary>Day notes ({dayNotes.length})</summary>
        <ul>
          {#each dayNotes as n (n.date)}
            <li>
              <Button size="sm" class="flex-none font-mono text-primary" onclick={() => onopenday(n.date)}>{n.date}</Button>
              <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-dim">{n.text || '(tags/screenshots only)'}</span>
              {#if (n.tags || []).length}<span class="flex-none font-mono text-faint">{n.tags.join(', ')}</span>{/if}
              <button type="button" class="flex-none cursor-pointer border-0 bg-transparent text-[16px] leading-none text-faint hover:text-red disabled:cursor-not-allowed disabled:opacity-45" disabled={isDemo} aria-label="Delete day note" onclick={() => deleteDay(n.date)}>×</button>
            </li>
          {/each}
        </ul>
      </details>
    {/if}

    {#if savedFilters.length}
      <details class="savedfilters border-b border-line px-4 py-2 [&_summary]:cursor-pointer [&_summary]:text-[12px] [&_summary]:font-bold [&_summary]:uppercase [&_summary]:tracking-[0.5px] [&_summary]:text-faint [&_ul]:m-0 [&_ul]:mt-2 [&_ul]:list-none [&_ul]:p-0 [&_li]:flex [&_li]:items-center [&_li]:gap-2.5 [&_li]:border-b [&_li]:border-line [&_li]:py-[5px] [&_li]:text-[12px]">
        <summary>Saved filters ({savedFilters.length})</summary>
        <ul>
          {#each savedFilters as sf (sf.id)}
            <li>
              <Button size="sm" class="flex-none font-mono text-primary" onclick={() => onapplyview(sf)}>{sf.name}</Button>
              <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-dim"></span>
              <Button size="sm" class="sfbtn flex-none" disabled={isDemo} onclick={() => renameView(sf)}>Rename</Button>
              <button type="button" class="flex-none cursor-pointer border-0 bg-transparent text-[16px] leading-none text-faint hover:text-red disabled:cursor-not-allowed disabled:opacity-45" disabled={isDemo} aria-label="Delete saved filter" onclick={() => ondeleteview(sf.id)}>×</button>
            </li>
          {/each}
        </ul>
      </details>
    {/if}

    <div class="tablewrap overflow-auto px-4 pb-4">
      <table
        class="w-full border-collapse text-[12px] [&_th]:sticky [&_th]:top-0 [&_th]:border-b [&_th]:border-line [&_th]:bg-bg [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-faint [&_td]:border-b [&_td]:border-line [&_td]:px-2 [&_td]:py-[6px] [&_td]:font-mono [&_th.r]:text-right [&_td.r]:text-right"
      >
        <thead>
          <tr><th>Date</th><th>Time</th><th>Symbol</th><th class="r">Qty</th><th class="r">P&L</th><th>Tags</th><th>Note</th><th></th></tr>
        </thead>
        <tbody>
          {#each visible as t (store.tradeId(t))}
            {@const m = metaOf(t)}
            {@const id = store.tradeId(t)}
            <tr class={editing === id ? '[&_td]:border-b-0' : ''}>
              <td>{t.date}</td>
              <td class="text-dim">{(t.time || '').slice(11, 16)}</td>
              <td>{t.symbol}</td>
              <td class="r">{t.qty || 1}</td>
              <td class="r {t.pnl > 0 ? 'text-green' : t.pnl < 0 ? 'text-red' : ''}">{usd(t.pnl)}</td>
              <td class="tags">{(m.tags || []).join(', ')}</td>
              <td class="max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap text-dim">{m.note || ''}</td>
              <td class="r whitespace-nowrap">
                <Button size="sm" class="edit" disabled={isDemo} onclick={() => openEdit(t)}>Edit</Button>
                <button type="button" class="del ml-1.5 cursor-pointer rounded-[5px] border border-line bg-panel2 px-2.5 py-[3px] text-[12px] text-red hover:border-[rgba(240,74,74,0.5)] hover:bg-red-bg disabled:cursor-not-allowed disabled:opacity-45" disabled={isDemo} aria-label="Delete trade" onclick={() => deleteTrade(t)}>Delete</button>
              </td>
            </tr>
            {#if editing === id}
              <tr class="[&>td]:bg-panel">
                <td colspan="8">
                  <div class="editrow flex flex-wrap items-end gap-2.5 py-1.5 [&_label]:flex [&_label]:flex-col [&_label]:gap-[3px] [&_label]:font-sans [&_label]:text-[11px] [&_label]:text-faint [&_input]:rounded-md [&_input]:border [&_input]:border-line [&_input]:bg-panel2 [&_input]:px-2 [&_input]:py-1.5 [&_input]:font-sans [&_input]:text-[13px] [&_input]:text-txt">
                    <label>Tags <input type="text" class="etags" bind:value={editTags} placeholder="comma, separated" /></label>
                    <label class="!flex-1 !min-w-[200px]">Note <input type="text" class="enote" bind:value={editNote} placeholder="per-trade note" /></label>
                    <Button variant="primary" class="save" onclick={saveEdit}>Save</Button>
                    <Button variant="outline" onclick={() => (editing = null)}>Cancel</Button>
                  </div>
                  <div class="editshots flex flex-wrap items-center gap-2 pb-2">
                    {#each editShots as s, i (i)}
                      <span class="shot relative inline-block">
                        <img src={s} alt="screenshot {i + 1}" class="block h-11 rounded-md border border-line" />
                        <button type="button" class="absolute -top-1.5 -right-1.5 h-[18px] w-[18px] cursor-pointer rounded-full border-0 bg-red text-[12px] leading-none text-white" aria-label="Remove screenshot" onclick={() => (editShots = editShots.filter((_, j) => j !== i))}>×</button>
                      </span>
                    {/each}
                    <button type="button" class="cursor-pointer rounded-md border border-dashed border-line bg-panel2 px-3 py-1.5 text-[12px] text-dim" onclick={() => editShotInput?.click()}>+ screenshot</button>
                    <input bind:this={editShotInput} type="file" accept="image/*" hidden onchange={addEditShot} />
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
      {#if !filtered.length}<p class="px-1 py-5 text-[13px] text-dim">No trades{search ? ' match the search' : ''}.</p>{/if}
      {#if paged && filtered.length > PAGE_SIZE}
        <div class="pager mt-2.5 flex items-center justify-center gap-3 text-[12px] text-dim">
          <Button size="sm" disabled={page === 0} onclick={() => (page -= 1)}>‹ Prev</Button>
          <span class="pginfo [font-variant-numeric:tabular-nums]">{page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of {filtered.length}</span>
          <Button size="sm" disabled={page >= pageCount - 1} onclick={() => (page += 1)}>Next ›</Button>
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
