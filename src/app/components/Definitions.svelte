<script lang="ts">
  // Definitions & Caveats (A37 — parity with the vanilla data-key="defs" panel). Static glossary +
  // warnings; the text is ported verbatim from partials/app-dash.html so the two read identically.
  import Panel from './Panel.svelte';
  import type { PanelBundle } from '../../lib/types.ts';

  interface Props {
    panel?: PanelBundle;
  }
  let { panel = {} as PanelBundle }: Props = $props();
</script>

<Panel {...panel} title="Definitions &amp; Caveats">
  <div class="defs defbody">
    <dl>
      <dt>Trade = one closed position</dt>
      <dd>Each trade is one realized-PnL event. Depending on the platform Blotterbook auto-detects, that's either one row per closed position (close-event exports like TradingView) or entry/exit fills paired into round-trips by a FIFO matcher (which also recovers hold time). TradingView is verified; the other eight adapters are beta — verify the parsed numbers against your statement.</dd>
      <dt>Win / Loss / Scratch</dt>
      <dd>Win = realized PnL &gt; 0, Loss = &lt; 0, Scratch = exactly 0. Win Rate = wins ÷ total trades (scratches stay in the denominator).</dd>
      <dt>Net PnL &amp; take-home</dt>
      <dd>Net PnL = gross − per-symbol commissions − full-month subscriptions. Take-home is Net PnL after the estimated Section 1256 tax, shown on the Net PnL card and in the Break-even panel.</dd>
      <dt>Performance graph</dt>
      <dd>X axis is the calendar date (the selected month's first to last day, or the full sample in All-time scope); Y axis is cumulative PnL. The Gross, Net, and Take-home overlays can be toggled. Clicking a calendar day marks it on the graph.</dd>
      <dt>Broker &amp; costs</dt>
      <dd>The broker chosen in the Broker &amp; Costs bar sets commission rates and the available data feeds. Commissions are modeled as broker commission + CME exchange/NFA fees; both are editable snapshot estimates.</dd>
      <dt>Scope toggle</dt>
      <dd>All time covers every trade; Selected month restricts the cards, graph, cost budget, and statistics to the month shown on the calendar. The calendar always shows the navigated month.</dd>
      <dt>Avg Winner / Loser &amp; Payoff Ratio</dt>
      <dd>Avg Winner = gross profit ÷ winning trades; Avg Loser = gross loss ÷ losing trades. Payoff Ratio = Avg Winner ÷ |Avg Loser| — the average win expressed in average-loss units. Above 1 means your winners are bigger than your losers; pair it with win rate to read the edge.</dd>
      <dt>Profit Concentration</dt>
      <dd>Share of total NET profit delivered by your five largest winning trades. High values — or above 100%, which means the rest of the book nets a loss — flag reliance on a few outlier trades. Shown as "—" when there's no net profit to attribute.</dd>
      <dt>Sortino vs Sharpe</dt>
      <dd>Both divide mean daily PnL by a volatility measure; Sharpe uses the spread of <em>all</em> days, Sortino only the <em>downside</em> (losing-day) deviation. Sortino rewards strategies whose variance is mostly upside. Same daily, non-annualized basis as Sharpe.</dd>
      <dt>Largest Win / Loss Streak ($)</dt>
      <dd>The most a single uninterrupted run of winning (or losing) trades added or subtracted, in dollars. A scratch (exactly 0) breaks the run. The Max Consecutive figures count trades in the longest run; these total the dollars.</dd>
      <dt>Best / Worst Weekday</dt>
      <dd>The active weekday with the highest / lowest AVERAGE PnL per trade (the trade count is shown alongside). Averaging — not total PnL — keeps days comparable regardless of how often you trade each one.</dd>
    </dl>
    <dl class="warn">
      <dt>Max Drawdown is REALIZED only</dt>
      <dd>Computed on the closed-trade equity curve, peak-to-trough. The % is peak-relative (drop ÷ the equity peak it fell from) and the duration counts trades from that peak to the trough. It does NOT capture open-position heat between entry and exit, and the % is undefined until the curve first goes positive.</dd>
      <dt>Weekday &amp; streak samples are thin</dt>
      <dd>Best/Worst Weekday averages and the streak dollars are only as stable as the trades behind them — a single weekday or run with a handful of trades swings easily. Read them as hints, not verdicts, on small samples.</dd>
      <dt>Commissions modeled, not exported</dt>
      <dd>The export carries no fees, so raw PnL is gross. Commissions are overlaid from the broker rate model and may drift as brokers update their schedules.</dd>
      <dt>Calendar-day grouping</dt>
      <dd>Days are grouped by the literal date in the Time column, not the CME session day. Sharpe uses daily PnL, population std, not annualized — near-meaningless on a handful of days.</dd>
      <dt>US dates &amp; Eastern time assumed</dt>
      <dd>Timestamps are read as written, in the export's own clock — no timezone conversion. Dates parse as US <b>M/D/Y</b>; an unambiguous day &gt; 12 (e.g. 25/06) is auto-detected as D/M/Y, but ambiguous non-US dates can land on the wrong day. Session (RTH/ETH) classification assumes US Eastern time. Export in a US/ET format, or verify the parsed dates before trusting day/week/month grouping.</dd>
    </dl>
  </div>
</Panel>

<style>
  .defbody {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0 28px;
  }
  dl {
    margin: 0;
  }
  dt {
    font-size: 12px;
    font-weight: 700;
    color: var(--txt);
    margin-top: 12px;
  }
  dd {
    margin: 3px 0 0;
    font-size: 12px;
    line-height: 1.55;
    color: var(--dim);
  }
  dl.warn dt {
    color: var(--warn);
  }
  em {
    color: var(--txt);
    font-style: italic;
  }
</style>
