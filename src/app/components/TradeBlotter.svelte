<script lang="ts">
  // Trade Blotter (F23 — promoted to all surfaces, CH16). A full-width dashboard module surfacing ALL trades in one
  // scrollable, read-only table (the Manage data → Trades list, brought onto the dashboard). It tracks
  // the active filter set/scope like every other panel (App passes the already-filtered `trades`).
  // Every column is READ-ONLY except the Note, which is inline-editable and persists through the same
  // per-trade annotation path as Manage data (Store.saveTradeMeta / trademeta) — all other editing
  // stays in the Manage data menu. Commission reuses the core `rateFor()` helper (the same round-turn
  // model costModel() uses) rather than recomputing fees. On demo the inline Note input is disabled and
  // saveNote() is guarded by isDemo (A87), so the module stays non-mutating there.
  import { getContext } from 'svelte';
  import { usd, money, cls, rateFor, emit, PAGE_MODE, STAGING_PAGE, BROKERS } from '../../lib/core.ts';
  import type { Trade, StoredTradeMeta, StoreLike, PanelBundle } from '../../lib/types.ts';
  import Panel from './Panel.svelte';

  interface Props {
    trades?: Trade[];
    /** id → persisted per-trade metadata (tags/note/shots), so a note edit preserves the rest. */
    tradeMeta?: Map<string, StoredTradeMeta>;
    /** Selected broker key — drives the per-trade round-turn commission via rateFor(). */
    broker?: string;
    /** Whether the active filter set is narrowing the list (for the empty-state copy). */
    filtered?: boolean;
    /** Reload the dashboard's derived data after a note write (App.reloadAll). */
    onchanged?: () => void;
    panel?: PanelBundle;
  }
  let { trades = [], tradeMeta = new Map(), broker = '', filtered = false, onchanged = () => {}, panel = {} as PanelBundle }: Props = $props();

  const store = getContext('bb:store') as StoreLike;
  const isDemo = PAGE_MODE === 'demo';

  const hm = (t: Trade) => (t.time || '').slice(11, 16) || '—';
  const commOf = (t: Trade) => rateFor(broker, t.root).rate * 2 * (t.qty || 1);
  const noteOf = (t: Trade) => tradeMeta.get(store.tradeId(t))?.note || '';
  // F31 (staging): the broker attributed to each trade's commission — today the single setup broker.
  const brokerLabel = $derived((BROKERS[broker] && BROKERS[broker].name) || broker || '—');

  const net = $derived(trades.reduce((a, t) => a + t.pnl, 0));
  const totalComm = $derived(trades.reduce((a, t) => a + commOf(t), 0));

  // F32 (staging): paginate the blotter. Default 50/page, user-selectable 25/50/100/150/All. On
  // prod/demo (no STAGING_PAGE) the blotter renders every row, exactly as before.
  const PAGE_SIZES = [25, 50, 100, 150];
  let pageSize = $state(50); // Infinity = "All"
  let page = $state(0);
  const pageCount = $derived(Math.max(1, Math.ceil(trades.length / pageSize)));
  const visible = $derived(STAGING_PAGE && pageSize !== Infinity ? trades.slice(page * pageSize, page * pageSize + pageSize) : trades);
  $effect(() => {
    // keep the page in range as the filtered set / page size changes (don't reset — a note edit
    // reloads the data but shouldn't yank the user back to page 1).
    void [trades.length, pageSize];
    if (page > pageCount - 1) page = Math.max(0, pageCount - 1);
  });
  function setPageSize(v: string) {
    pageSize = v === 'all' ? Infinity : Number(v);
    page = 0;
  }

  // Persist an inline note edit, preserving the trade's existing tags/shots (saveTradeMeta replaces
  // the whole record). Demo never writes (A87). Fires on blur/Enter (the input's change event).
  async function saveNote(t: Trade, note: string) {
    if (isDemo) return;
    const id = store.tradeId(t);
    if ((noteOf(t) || '') === note.trim()) return; // no-op if unchanged
    const ex = tradeMeta.get(id);
    await store.saveTradeMeta(id, { tags: ex?.tags || [], note, shots: ex?.shots || [] });
    emit('trade:edited', { id });
    onchanged();
  }
</script>

<Panel {...panel} title="Trade Blotter">
  {#snippet actions()}
    {#if trades.length}
      <span class="blsum">{trades.length} trade{trades.length === 1 ? '' : 's'} · <span class={cls(net)}>{usd(net)}</span> · <span class="comm">−{money(totalComm)} comm</span></span>
    {/if}
  {/snippet}

  {#if trades.length}
    <div class="blwrap">
      <table class="bltab">
        <thead>
          <tr>
            <th>Date / time</th>
            <th>Symbol</th>
            <th>Contract</th>
            <th>Side</th>
            <th class="num">Qty</th>
            {#if STAGING_PAGE}<th>Broker</th>{/if}
            <th class="num">Commission</th>
            <th>Note</th>
            <th class="num">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {#each visible as t (store.tradeId(t))}
            <tr>
              <td class="mono dim">{t.date}<span class="time"> {hm(t)}</span></td>
              <td>{t.root || t.symbol}</td>
              <td class="dim">{t.symbol}</td>
              <td class="side">{t.side || '—'}</td>
              <td class="num mono">{t.qty || 1}</td>
              {#if STAGING_PAGE}<td class="dim">{brokerLabel}</td>{/if}
              <td class="num mono dim">−{money(commOf(t))}</td>
              <td class="notecell">
                <input
                  class="note"
                  type="text"
                  value={noteOf(t)}
                  disabled={isDemo}
                  placeholder="Add a note…"
                  aria-label="Note for {t.root || t.symbol} on {t.date}"
                  onchange={e => saveNote(t, (e.currentTarget as HTMLInputElement).value)}
                />
              </td>
              <td class="num mono {cls(t.pnl)}">{usd(t.pnl)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if STAGING_PAGE}
      <!-- F32 (staging): page-size selector + prev/next pager. -->
      <div class="blpager">
        <label class="blpsize"
          >Rows
          <select aria-label="Rows per page" onchange={e => setPageSize((e.currentTarget as HTMLSelectElement).value)}>
            {#each PAGE_SIZES as n (n)}<option value={n} selected={pageSize === n}>{n}</option>{/each}
            <option value="all" selected={pageSize === Infinity}>All</option>
          </select>
        </label>
        {#if pageCount > 1}
          <div class="blnav">
            <button type="button" disabled={page === 0} onclick={() => (page -= 1)}>‹ Prev</button>
            <span class="pginfo">{page * pageSize + 1}–{Math.min(trades.length, (page + 1) * pageSize)} of {trades.length}</span>
            <button type="button" disabled={page >= pageCount - 1} onclick={() => (page += 1)}>Next ›</button>
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <p class="blnone">No trades to show{filtered ? ' with the active filters' : ''}.</p>
  {/if}
</Panel>

<style>
  .blsum {
    font-size: 12px;
    font-family: var(--mono);
    color: var(--dim);
  }
  .blsum .pos {
    color: var(--green);
  }
  .blsum .neg {
    color: var(--red);
  }
  .blsum .comm {
    color: var(--faint);
  }
  /* Scrollable, full-width list — caps the height so a large book scrolls inside the module. */
  .blwrap {
    overflow: auto;
    max-height: 460px;
  }
  .bltab {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .bltab th {
    position: sticky;
    top: 0;
    z-index: 1;
    text-align: left;
    background: var(--panel);
    color: var(--faint);
    font-weight: 600;
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .bltab th.num {
    text-align: right;
  }
  .bltab td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .bltab td.num {
    text-align: right;
  }
  .bltab td.mono {
    font-family: var(--mono);
  }
  .bltab td.dim {
    color: var(--dim);
  }
  .time {
    color: var(--faint);
  }
  .side {
    text-transform: capitalize;
  }
  .pos {
    color: var(--green);
  }
  .neg {
    color: var(--red);
  }
  .notecell {
    width: 100%;
    min-width: 160px;
    white-space: normal;
  }
  .note {
    width: 100%;
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 4px 6px;
    font: inherit;
    font-size: 12px;
  }
  .note:hover:not(:disabled) {
    border-color: var(--line);
  }
  .note:focus {
    outline: none;
    border-color: var(--accent);
  }
  .note:disabled {
    background: transparent;
    cursor: not-allowed;
  }
  .blnone {
    margin: 0;
    font-size: 13px;
    color: var(--dim);
  }
  /* F32 (staging): blotter pager — page-size selector (left) + prev/next (right). */
  .blpager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 10px;
    font-size: 12px;
    color: var(--dim);
  }
  .blpsize {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .blpsize select {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 6px;
    font: inherit;
    font-size: 12px;
  }
  .blnav {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .blnav button {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .blnav button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .pginfo {
    font-variant-numeric: tabular-nums;
  }
</style>
