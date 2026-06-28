<script lang="ts">
  // Read-only intraday trade list for the selected day (A50 — parity with vanilla data.js
  // renderDayTrades / #j_trades). Shown alongside the day-note editor on calendar/curve day-select.
  // `trades` is the active-filtered set for the day (passed from App), so it tracks the filters.
  import { usd, cls } from '../../lib/core.ts';
  import type { Trade } from '../../lib/types.ts';

  interface Props {
    date: string;
    trades?: Trade[];
    filtered?: boolean;
  }
  let { date, trades = [], filtered = false }: Props = $props();
  const net = $derived(trades.reduce((a, t) => a + t.pnl, 0));
  const hm = (t: Trade) => (t.time || '').slice(11, 16) || '—';
</script>

<section class="panel daytrades">
  <div class="phead">
    <h2>Trades · {date}</h2>
    {#if trades.length}<span class="dtnet {cls(net)}">{trades.length} · {usd(net)}</span>{/if}
  </div>
  {#if trades.length}
    <div class="dtwrap">
      <table class="dttab">
        <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th class="num">P&amp;L</th></tr></thead>
        <tbody>
          {#each trades as t, i (i)}
            <tr>
              <td class="mono dim">{hm(t)}</td>
              <td>{t.root || t.symbol}</td>
              <td class="side">{t.side || '—'}</td>
              <td class="num mono {cls(t.pnl)}">{usd(t.pnl)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="dtnone">No trades on this day{filtered ? ' (with the active filters)' : ''}.</p>
  {/if}
</section>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px 16px;
    margin-top: 16px;
  }
  .phead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
    font-weight: 700;
  }
  .dtnet {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--txt);
  }
  .dtnet.pos {
    color: var(--green);
  }
  .dtnet.neg {
    color: var(--red);
  }
  .dtwrap {
    overflow-x: auto;
  }
  .dttab {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .dttab th {
    text-align: left;
    color: var(--faint);
    font-weight: 600;
    padding: 5px 8px;
    border-bottom: 1px solid var(--line);
  }
  .dttab th.num {
    text-align: right;
  }
  .dttab td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--line);
  }
  .dttab td.num {
    text-align: right;
  }
  .dttab td.mono,
  .dttab td.num.mono {
    font-family: var(--mono);
  }
  .dttab td.dim {
    color: var(--dim);
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
  .dtnone {
    margin: 0;
    font-size: 13px;
    color: var(--dim);
  }
</style>
