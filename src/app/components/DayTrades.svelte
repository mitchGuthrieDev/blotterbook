<script lang="ts">
  // Read-only intraday trade list for the selected day (A50 — parity with vanilla data.js
  // renderDayTrades / #j_trades). Shown alongside the day-note editor on calendar/curve day-select.
  // `trades` is the active-filtered set for the day (passed from App), so it tracks the filters.
  import { usd } from '../../lib/core/core.ts';
  import type { Trade } from '../../lib/core/types.ts';

  interface Props {
    date: string;
    trades?: Trade[];
    filtered?: boolean;
  }
  let { date, trades = [], filtered = false }: Props = $props();
  const net = $derived(trades.reduce((a, t) => a + t.pnl, 0));
  const hm = (t: Trade) => (t.time || '').slice(11, 16) || '—';
</script>

<section class="daytrades mt-4 rounded-[10px] border border-line bg-panel px-4 pt-3.5 pb-4">
  <div class="mb-2.5 flex items-baseline justify-between gap-3">
    <h2 class="m-0 text-[13px] font-bold tracking-[0.5px] text-faint uppercase">Trades · {date}</h2>
    {#if trades.length}<span
        class="dtnet font-mono text-[13px] font-bold {net > 0 ? 'text-green' : net < 0 ? 'text-red' : 'text-txt'}"
        >{trades.length} · {usd(net)}</span
      >{/if}
  </div>
  {#if trades.length}
    <div class="overflow-x-auto">
      <table
        class="dttab w-full border-collapse text-xs [&_td]:border-b [&_td]:border-line [&_td]:px-2 [&_td]:py-[5px] [&_th]:border-b [&_th]:border-line [&_th]:px-2 [&_th]:py-[5px] [&_th]:text-left [&_th]:font-semibold [&_th]:text-faint"
      >
        <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th class="text-right!">P&amp;L</th></tr></thead>
        <tbody>
          {#each trades as t, i (i)}
            <tr>
              <td class="font-mono text-dim">{hm(t)}</td>
              <td>{t.root || t.symbol}</td>
              <td class="capitalize">{t.side || '—'}</td>
              <td class="text-right font-mono {t.pnl > 0 ? 'text-green' : t.pnl < 0 ? 'text-red' : ''}"
                >{usd(t.pnl)}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="m-0 text-[13px] text-dim">
      No trades on this day{filtered ? ' (with the active filters)' : ''}.
    </p>
  {/if}
</section>
