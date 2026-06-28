<script>
  // Manage-data modal (A27): the all-trades table + per-trade tag/note editor, CSV import, backup
  // export/restore, and erase. All persistence + parsing reuse the verbatim core (Store seam +
  // Adapters — A29); this component is only the view. Per-trade screenshots from the vanilla editor
  // are deferred. Operations that change the dataset call onchanged() so App recomputes the dashboard.
  import { onMount } from 'svelte';
  import { Store } from '../../store.js';
  import { Adapters } from '../../adapters.js';
  import { usd, money, emit } from '../../core.js';

  let { onclose, onchanged } = $props();

  let trades = $state([]);
  let metaMap = $state(new Map());
  let search = $state('');
  let editing = $state(null); // trade id under edit
  let editTags = $state('');
  let editNote = $state('');
  let msg = $state('');

  let csvInput;
  let backupInput;

  const filtered = $derived(
    search.trim()
      ? trades.filter(t => (t.symbol + ' ' + t.date).toLowerCase().includes(search.trim().toLowerCase()))
      : trades
  );

  onMount(reload);

  async function reload() {
    trades = await Store.getAllTrades();
    const all = await Store.allTradeMeta();
    metaMap = new Map(all.map(m => [m.id, m]));
  }

  const metaOf = t => metaMap.get(Store.tradeId(t)) || { tags: [], note: '' };

  function openEdit(t) {
    const id = Store.tradeId(t);
    const m = metaMap.get(id) || {};
    editing = id;
    editTags = (m.tags || []).join(', ');
    editNote = m.note || '';
  }

  async function saveEdit() {
    const tags = [...new Set(editTags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
    await Store.saveTradeMeta(editing, { tags, note: editNote });
    editing = null;
    emit('trade:edited');
    await reload();
    onchanged();
  }

  async function importCSV(e) {
    const f = e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    const r = Adapters.parse(await f.text());
    if (!r.ok) {
      msg = r.error || 'Could not parse that CSV.';
      return;
    }
    const res = await Store.addTrades(r.trades);
    msg = `Imported ${res.added} new trade${res.added === 1 ? '' : 's'} (${res.duplicate} duplicate).`;
    emit('data:imported', { added: res.added });
    await reload();
    onchanged();
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportBackup() {
    const data = await Store.exportAll();
    download(`blotterbook-staging-backup.json`, JSON.stringify(data));
    msg = 'Backup downloaded.';
    emit('backup:created');
  }

  async function importBackup(e) {
    const f = e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      const res = await Store.importAll(JSON.parse(await f.text()));
      msg = `Restored ${res.added} trade${res.added === 1 ? '' : 's'} (${res.dup} duplicate).`;
      emit('data:imported', { added: res.added });
      await reload();
      onchanged();
    } catch (err) {
      msg = 'That backup file could not be read.';
    }
  }

  async function eraseAll() {
    if (!confirm('Erase ALL trades, day-notes and per-trade tags/notes in this staging sandbox? This cannot be undone.')) return;
    await Store.purge();
    msg = 'All staging data erased.';
    emit('data:erased');
    await reload();
    onchanged();
  }
</script>

<svelte:window
  onkeydown={e => {
    if (e.key === 'Escape') (editing ? (editing = null) : onclose());
  }}
/>

<div class="overlay" role="presentation" onclick={e => e.target === e.currentTarget && onclose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Manage data">
    <div class="head">
      <h2>Manage data</h2>
      <button type="button" class="x" onclick={onclose} aria-label="Close">×</button>
    </div>

    <div class="toolbar">
      <button type="button" onclick={() => csvInput.click()}>Load CSV</button>
      <button type="button" onclick={exportBackup}>Export backup</button>
      <button type="button" onclick={() => backupInput.click()}>Import backup</button>
      <button type="button" class="danger" onclick={eraseAll}>Erase all local data</button>
      <input type="text" class="search" placeholder="Search symbol / date" bind:value={search} />
      <input bind:this={csvInput} type="file" accept=".csv,text/csv" hidden onchange={importCSV} />
      <input bind:this={backupInput} type="file" accept="application/json,.json" hidden onchange={importBackup} />
    </div>
    {#if msg}<p class="msg">{msg}</p>{/if}

    <div class="tablewrap">
      <table>
        <thead>
          <tr><th>Date</th><th>Time</th><th>Symbol</th><th class="r">Qty</th><th class="r">P&L</th><th>Tags</th><th>Note</th><th></th></tr>
        </thead>
        <tbody>
          {#each filtered as t (Store.tradeId(t))}
            {@const m = metaOf(t)}
            {@const id = Store.tradeId(t)}
            <tr class:editing={editing === id}>
              <td>{t.date}</td>
              <td class="dim">{(t.time || '').slice(11, 16)}</td>
              <td>{t.symbol}</td>
              <td class="r">{t.qty || 1}</td>
              <td class="r" class:pos={t.pnl > 0} class:neg={t.pnl < 0}>{usd(t.pnl)}</td>
              <td class="tags">{(m.tags || []).join(', ')}</td>
              <td class="note dim">{m.note || ''}</td>
              <td class="r"><button type="button" class="edit" onclick={() => openEdit(t)}>Edit</button></td>
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
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
      {#if !filtered.length}<p class="empty">No trades{search ? ' match the search' : ''}.</p>{/if}
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
  .toolbar button:hover {
    border-color: var(--hover-line);
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
  .edit {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
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
</style>
