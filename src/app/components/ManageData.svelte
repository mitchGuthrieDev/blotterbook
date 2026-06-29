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
  import { modal } from '../lib/modal.ts';

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

<div class="overlay" role="presentation" onclick={(e: MouseEvent) => e.target === e.currentTarget && onclose()}>
  <!-- Escape cancels an open per-trade editor first, otherwise closes the modal (A42). -->
  <div class="modal" role="dialog" aria-modal="true" aria-label="Manage data" tabindex="-1" use:modal={{ onclose: () => (editing ? (editing = null) : onclose()) }}>
    <div class="head">
      <h2>Manage data</h2>
      <button type="button" class="x" onclick={onclose} aria-label="Close">×</button>
    </div>

    <div class="summary">
      <div class="dmstat"><div class="dk">Trades</div><div class="dv">{trades.length}</div></div>
      <div class="dmstat"><div class="dk">Date range</div><div class="dv mono">{dmRange}</div></div>
      <div class="dmstat"><div class="dk">Day notes</div><div class="dv">{dayNotes.length}</div></div>
      <div class="dmstat"><div class="dk">Tagged trades</div><div class="dv">{metaMap.size}</div></div>
      <div class="dmstat"><div class="dk">Local size</div><div class="dv mono">{localKb}</div></div>
    </div>

    {#if isDemo}<p class="demonote">This is a read-only demo — loading, editing, importing and erasing are disabled, and nothing is saved.</p>{/if}

    <div class="toolbar">
      <button type="button" disabled={isDemo} onclick={() => csvInput.click()}>Load CSV</button>
      <button type="button" disabled={isDemo} onclick={exportBackup}>Export backup</button>
      <button type="button" disabled={isDemo} onclick={() => backupInput.click()}>Import backup</button>
      <button type="button" class="danger" disabled={isDemo} onclick={eraseAll}>Erase all local data</button>
      <input type="text" class="search" placeholder="Search symbol / date" bind:value={search} />
      <input bind:this={csvInput} type="file" accept=".csv,text/csv" hidden onchange={importCSV} />
      <input bind:this={backupInput} type="file" accept="application/json,.json" hidden onchange={importBackup} />
    </div>
    {#if msg}<p class="msg">{msg}</p>{/if}

    {#if dayNotes.length}
      <details class="daynotes">
        <summary>Day notes ({dayNotes.length})</summary>
        <ul>
          {#each dayNotes as n (n.date)}
            <li>
              <button type="button" class="opends" onclick={() => onopenday(n.date)}>{n.date}</button>
              <span class="dntext">{n.text || '(tags/screenshots only)'}</span>
              {#if (n.tags || []).length}<span class="dntags">{n.tags.join(', ')}</span>{/if}
              <button type="button" class="dndel" disabled={isDemo} aria-label="Delete day note" onclick={() => deleteDay(n.date)}>×</button>
            </li>
          {/each}
        </ul>
      </details>
    {/if}

    {#if savedFilters.length}
      <details class="savedfilters">
        <summary>Saved filters ({savedFilters.length})</summary>
        <ul>
          {#each savedFilters as sf (sf.id)}
            <li>
              <button type="button" class="opends" onclick={() => onapplyview(sf)}>{sf.name}</button>
              <span class="dntext"></span>
              <button type="button" class="sfbtn" disabled={isDemo} onclick={() => renameView(sf)}>Rename</button>
              <button type="button" class="dndel" disabled={isDemo} aria-label="Delete saved filter" onclick={() => ondeleteview(sf.id)}>×</button>
            </li>
          {/each}
        </ul>
      </details>
    {/if}

    <div class="tablewrap">
      <table>
        <thead>
          <tr><th>Date</th><th>Time</th><th>Symbol</th><th class="r">Qty</th><th class="r">P&L</th><th>Tags</th><th>Note</th><th></th></tr>
        </thead>
        <tbody>
          {#each visible as t (store.tradeId(t))}
            {@const m = metaOf(t)}
            {@const id = store.tradeId(t)}
            <tr class:editing={editing === id}>
              <td>{t.date}</td>
              <td class="dim">{(t.time || '').slice(11, 16)}</td>
              <td>{t.symbol}</td>
              <td class="r">{t.qty || 1}</td>
              <td class="r" class:pos={t.pnl > 0} class:neg={t.pnl < 0}>{usd(t.pnl)}</td>
              <td class="tags">{(m.tags || []).join(', ')}</td>
              <td class="note dim">{m.note || ''}</td>
              <td class="r actions">
                <button type="button" class="edit" disabled={isDemo} onclick={() => openEdit(t)}>Edit</button>
                <button type="button" class="del" disabled={isDemo} aria-label="Delete trade" onclick={() => deleteTrade(t)}>Delete</button>
              </td>
            </tr>
            {#if editing === id}
              <tr class="editor">
                <td colspan="8">
                  <div class="editrow">
                    <label>Tags <input type="text" class="etags" bind:value={editTags} placeholder="comma, separated" /></label>
                    <label class="grow">Note <input type="text" class="enote" bind:value={editNote} placeholder="per-trade note" /></label>
                    <button type="button" class="save" onclick={saveEdit}>Save</button>
                    <button type="button" onclick={() => (editing = null)}>Cancel</button>
                  </div>
                  <div class="editshots">
                    {#each editShots as s, i (i)}
                      <span class="shot">
                        <img src={s} alt="screenshot {i + 1}" />
                        <button type="button" class="rm" aria-label="Remove screenshot" onclick={() => (editShots = editShots.filter((_, j) => j !== i))}>×</button>
                      </span>
                    {/each}
                    <button type="button" class="addshot" onclick={() => editShotInput?.click()}>+ screenshot</button>
                    <input bind:this={editShotInput} type="file" accept="image/*" hidden onchange={addEditShot} />
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
      {#if !filtered.length}<p class="empty">No trades{search ? ' match the search' : ''}.</p>{/if}
      {#if paged && filtered.length > PAGE_SIZE}
        <div class="pager">
          <button type="button" disabled={page === 0} onclick={() => (page -= 1)}>‹ Prev</button>
          <span class="pginfo">{page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of {filtered.length}</span>
          <button type="button" disabled={page >= pageCount - 1} onclick={() => (page += 1)}>Next ›</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4vh 16px;
    z-index: 50;
  }
  .modal {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 12px;
    width: 100%;
    max-width: 960px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
  }
  .head h2 {
    margin: 0;
    font-size: 15px;
  }
  .x {
    background: transparent;
    border: 0;
    color: var(--dim);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  .dmstat {
    background: var(--panel2);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 7px 9px;
  }
  .dk {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--faint);
  }
  .dv {
    margin-top: 3px;
    font-size: 14px;
    font-weight: 700;
    color: var(--txt);
  }
  .dv.mono {
    font-family: var(--mono);
    font-size: 12px;
  }
  .sfbtn {
    background: var(--panel2);
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 3px 9px;
    font-size: 12px;
    cursor: pointer;
    flex: none;
  }
  .sfbtn:hover {
    border-color: var(--hover-line);
    color: var(--txt);
  }
  .savedfilters {
    padding: 8px 16px;
    border-bottom: 1px solid var(--line);
  }
  .savedfilters summary {
    font-size: 12px;
    color: var(--faint);
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 700;
  }
  .savedfilters ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  .savedfilters li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 0;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  .toolbar button,
  .search {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 7px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .search {
    cursor: text;
    margin-left: auto;
    min-width: 180px;
  }
  .toolbar button:hover:not(:disabled) {
    border-color: var(--hover-line);
  }
  .demonote {
    margin: 0;
    padding: 8px 16px;
    font-size: 12px;
    color: var(--warn);
    border-bottom: 1px solid var(--line);
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .danger {
    color: var(--red);
    border-color: rgba(240, 74, 74, 0.5) !important;
  }
  .danger:hover {
    background: var(--red-bg);
  }
  .msg {
    margin: 0;
    padding: 8px 16px;
    font-size: 12px;
    color: var(--accent);
    border-bottom: 1px solid var(--line);
  }
  .daynotes {
    padding: 8px 16px;
    border-bottom: 1px solid var(--line);
  }
  .daynotes summary {
    font-size: 12px;
    color: var(--faint);
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 700;
  }
  .daynotes ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  .daynotes li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 0;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  .opends {
    background: var(--panel2);
    color: var(--accent);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 3px 9px;
    font-family: var(--mono);
    cursor: pointer;
    flex: none;
  }
  .dntext {
    flex: 1;
    color: var(--dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dntags {
    color: var(--faint);
    font-family: var(--mono);
    flex: none;
  }
  .dndel {
    background: transparent;
    border: 0;
    color: var(--faint);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    flex: none;
  }
  .dndel:hover {
    color: var(--red);
  }
  .tablewrap {
    overflow: auto;
    padding: 0 16px 16px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--bg);
    text-align: left;
    color: var(--faint);
    font-weight: 600;
    padding: 8px 8px;
    border-bottom: 1px solid var(--line);
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    font-family: var(--mono);
  }
  th.r,
  td.r {
    text-align: right;
  }
  td.dim {
    color: var(--dim);
  }
  td.pos {
    color: var(--green);
  }
  td.neg {
    color: var(--red);
  }
  td.note {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td.actions {
    white-space: nowrap;
  }
  .edit,
  .del {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .del {
    color: var(--red);
    margin-left: 6px;
  }
  .del:hover {
    border-color: rgba(240, 74, 74, 0.5);
    background: var(--red-bg);
  }
  tr.editing td {
    border-bottom: 0;
  }
  .editor td {
    background: var(--panel);
  }
  .editrow {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
    padding: 6px 0;
  }
  .editrow label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
    color: var(--faint);
    font-family: var(--sans);
  }
  .editrow label.grow {
    flex: 1;
    min-width: 200px;
  }
  .editrow input {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
    font-family: var(--sans);
  }
  .editrow .save {
    background: var(--accent);
    color: #0d1014;
    border: 0;
    border-radius: 6px;
    padding: 7px 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .editshots {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 0 0 8px;
  }
  .editshots .shot {
    position: relative;
    display: inline-block;
  }
  .editshots .shot img {
    height: 44px;
    border-radius: 6px;
    border: 1px solid var(--line);
    display: block;
  }
  .editshots .shot .rm {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 0;
    background: var(--red);
    color: #fff;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  .editshots .addshot {
    background: var(--panel2);
    color: var(--dim);
    border: 1px dashed var(--line);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .editrow button:not(.save) {
    background: transparent;
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 7px 12px;
    cursor: pointer;
  }
  .empty {
    color: var(--dim);
    padding: 20px 4px;
    font-size: 13px;
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 10px;
    font-size: 12px;
    color: var(--dim);
  }
  .pager button {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .pginfo {
    font-variant-numeric: tabular-nums;
  }
</style>
