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
  import { usd, money, rateFor, emit, PAGE_MODE, STAGING_PAGE, BROKERS } from '../../lib/core/core.ts';
  import type { Trade, StoredTradeMeta, StoreLike, PanelBundle } from '../../lib/core/types.ts';
  import Panel from './Panel.svelte';
  import * as Select from '$ui/select';

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
  const PAGE_SIZE_ITEMS = [...PAGE_SIZES.map(n => ({ value: String(n), label: String(n) })), { value: 'all', label: 'All' }];
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
      <span class="font-mono text-[12px] text-dim">{trades.length} trade{trades.length === 1 ? '' : 's'} · <span class={net > 0 ? 'text-green' : net < 0 ? 'text-red' : ''}>{usd(net)}</span> · <span class="text-faint">−{money(totalComm)} comm</span></span>
    {/if}
  {/snippet}

  {#if trades.length}
    <div class="max-h-[460px] overflow-auto">
      <table
        class="bltab w-full border-collapse text-[12px] [&_td]:whitespace-nowrap [&_td]:border-b [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:sticky [&_th]:top-0 [&_th]:z-[1] [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-panel [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-faint"
      >
        <thead>
          <tr>
            <th>Date / time</th>
            <th>Symbol</th>
            <th>Contract</th>
            <th>Side</th>
            <th class="text-right">Qty</th>
            {#if STAGING_PAGE}<th>Broker</th>{/if}
            <th class="text-right">Commission</th>
            <th>Note</th>
            <th class="text-right">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {#each visible as t (store.tradeId(t))}
            <tr>
              <td class="font-mono text-dim">{t.date}<span class="text-faint"> {hm(t)}</span></td>
              <td>{t.root || t.symbol}</td>
              <td class="text-dim">{t.symbol}</td>
              <td class="capitalize">{t.side || '—'}</td>
              <td class="text-right font-mono">{t.qty || 1}</td>
              {#if STAGING_PAGE}<td class="text-dim">{brokerLabel}</td>{/if}
              <td class="text-right font-mono text-dim">−{money(commOf(t))}</td>
              <td class="w-full min-w-[160px] whitespace-normal">
                <input
                  class="note w-full rounded-[5px] border border-transparent bg-panel2 px-1.5 py-1 font-[inherit] text-[12px] text-txt not-disabled:hover:border-line focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-transparent"
                  type="text"
                  value={noteOf(t)}
                  disabled={isDemo}
                  placeholder="Add a note…"
                  aria-label="Note for {t.root || t.symbol} on {t.date}"
                  onchange={e => saveNote(t, (e.currentTarget as HTMLInputElement).value)}
                />
              </td>
              <td class="text-right font-mono {t.pnl > 0 ? 'text-green' : t.pnl < 0 ? 'text-red' : ''}">{usd(t.pnl)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if STAGING_PAGE}
      <!-- F32 (staging): page-size selector + prev/next pager. -->
      <div class="blpager mt-2.5 flex flex-wrap items-center justify-between gap-3 text-[12px] text-dim">
        <div class="blpsize flex items-center gap-1.5">
          <span>Rows</span>
          <Select.Root type="single" value={pageSize === Infinity ? 'all' : String(pageSize)} onValueChange={setPageSize} items={PAGE_SIZE_ITEMS}>
            <Select.Trigger aria-label="Rows per page" class="px-2 py-1"><Select.Value /></Select.Trigger>
            <Select.Content class="min-w-[5rem]">
              {#each PAGE_SIZE_ITEMS as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
            </Select.Content>
          </Select.Root>
        </div>
        {#if pageCount > 1}
          <div class="blnav flex items-center gap-3 [&_button]:cursor-pointer [&_button]:rounded-md [&_button]:border [&_button]:border-line [&_button]:bg-panel2 [&_button]:px-2.5 [&_button]:py-[5px] [&_button]:font-[inherit] [&_button]:text-[12px] [&_button]:text-txt [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-40">
            <button type="button" disabled={page === 0} onclick={() => (page -= 1)}>‹ Prev</button>
            <span class="pginfo [font-variant-numeric:tabular-nums]">{page * pageSize + 1}–{Math.min(trades.length, (page + 1) * pageSize)} of {trades.length}</span>
            <button type="button" disabled={page >= pageCount - 1} onclick={() => (page += 1)}>Next ›</button>
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <p class="blnone m-0 text-[13px] text-dim">No trades to show{filtered ? ' with the active filters' : ''}.</p>
  {/if}
</Panel>
