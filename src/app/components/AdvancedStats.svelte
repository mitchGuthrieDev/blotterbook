<script lang="ts">
  // Advanced statistics — the deeper compute() metrics not shown in the Overview, presented as
  // label/value rows (A29: pure presentation of the existing metrics object). DOW_LABEL/usd/cls
  // are imported verbatim from the core.
  import { usd, cls, ratio, num, fmtDur, DOW_LABEL, STAGING_PAGE } from '../../lib/core/core.ts';
  import type { Metrics } from '../../lib/core/core.ts';
  import type { PanelBundle } from '../../lib/core/types.ts';
  import Panel from './Panel.svelte';
  import Caveats from './Caveats.svelte';

  // A97 (R18 — promoted to all surfaces, CH16): the definitions for the rows below + their
  // thin-sample / Sharpe-basis warnings live here, next to the figures they qualify (mirroring
  // CostPanel's F6/F10 pattern), instead of in the standalone Definitions panel.

  interface Props {
    metrics: Metrics;
    panel?: PanelBundle;
  }
  let { metrics, panel = {} as PanelBundle }: Props = $props();

  const dow = (d: { i: number; avg: number } | null) => (d ? `${DOW_LABEL[d.i]} · ${usd(d.avg)}/trade` : '—');

  const rows = $derived(build(metrics));

  function build(m: Metrics) {
    if (!m) return [];
    // Avg hold time is only available for fills-based platform exports (round-trip matched, so the
    // trade carries holdMs); computed straight off m.trades like vanilla renderAdv (A47/A29). It's
    // omitted entirely for close-event exports (e.g. TradingView) that carry no hold duration.
    const held = (m.trades || []).filter(t => t.holdMs != null && t.holdMs > 0);
    const avgHold = held.length ? held.reduce((a, t) => a + t.holdMs!, 0) / held.length : null;
    // F25 (staging): the headline metrics removed from the Overview card grid (everything but the
    // five interactive cards) move here so no figure is lost — count, daily P&L, day extremes, and
    // the daily Sharpe. Off on prod/demo, where those cards still live in the Overview (until CH16).
    const folded = STAGING_PAGE
      ? [
          { k: 'Trades', v: `${m.n} · ${m.active} trading days` },
          { k: 'Avg daily P&L', v: usd(m.avgDaily), tone: cls(m.avgDaily) },
          { k: 'Best day', v: m.bestDay ? `${usd(m.bestDay.pnl)} · ${m.bestDay.date}` : '—', tone: 'pos' },
          { k: 'Worst day', v: m.worstDay ? `${usd(m.worstDay.pnl)} · ${m.worstDay.date}` : '—', tone: 'neg' },
          { k: 'Sharpe (daily)', v: num(m.sharpe) },
        ]
      : [];
    const rows = [
      ...folded,
      { k: 'Payoff ratio (avg win / avg loss)', v: ratio(m.wl) },
      { k: 'Average win', v: usd(m.avgW), tone: 'pos' },
      { k: 'Average loss', v: usd(m.avgL), tone: 'neg' },
      { k: 'Expectancy / trade', v: usd(m.expectancy), tone: cls(m.expectancy) },
      { k: 'Per-trade std dev', v: usd(m.tStd, false) },
      { k: 'Sortino (daily)', v: num(m.sortino) },
      { k: 'Recovery factor (net / max DD)', v: ratio(m.recovery) },
      { k: 'Profit concentration (top 5)', v: m.concPct == null ? '—' : m.concPct.toFixed(0) + '%' },
      { k: 'Max consecutive wins', v: String(m.mcw) },
      { k: 'Max consecutive losses', v: String(m.mcl) },
      ...(avgHold != null ? [{ k: 'Avg hold time', v: `${fmtDur(avgHold)} · ${held.length}/${m.n}` }] : []),
      { k: 'Largest winning streak', v: usd(m.maxWinStk), tone: 'pos' },
      { k: 'Largest losing streak', v: usd(m.maxLossStk), tone: 'neg' },
      { k: 'Best weekday', v: dow(m.bestDow), tone: 'pos' },
      { k: 'Worst weekday', v: dow(m.worstDow), tone: 'neg' },
      { k: 'Long P&L', v: `${usd(m.long.pnl)} · ${m.long.n} trades`, tone: cls(m.long.pnl) },
      { k: 'Short P&L', v: `${usd(m.short.pnl)} · ${m.short.n} trades`, tone: cls(m.short.pnl) },
      { k: 'Gross profit', v: usd(m.gp), tone: 'pos' },
      { k: 'Gross loss', v: usd(m.gl), tone: 'neg' },
      { k: 'Avg trades / day', v: num(m.avgTrades) },
    ];
    return rows;
  }
</script>

<Panel {...panel} title="Advanced Statistics">
  <div class="advstats grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-6 gap-y-0.5">
    {#each rows as r (r.k)}
      <div class="row flex items-baseline justify-between gap-3 border-b border-line py-[7px]">
        <span class="text-xs text-dim">{r.k}</span>
        <span
          class="font-mono text-[13px] font-bold whitespace-nowrap {r.tone === 'pos'
            ? 'text-green'
            : r.tone === 'neg'
              ? 'text-red'
              : 'text-txt'}">{r.v}</span>
      </div>
    {/each}
  </div>

  <Caveats>
    <li><b>Avg Winner / Loser &amp; Payoff Ratio.</b> Avg Winner = gross profit ÷ winning trades; Avg Loser = gross loss ÷ losing trades. Payoff Ratio = Avg Winner ÷ |Avg Loser| — the average win expressed in average-loss units. Above 1 means your winners are bigger than your losers; pair it with win rate to read the edge.</li>
    <li><b>Profit Concentration.</b> Share of total NET profit delivered by your five largest winning trades. High values — or above 100%, which means the rest of the book nets a loss — flag reliance on a few outlier trades. Shown as "—" when there's no net profit to attribute.</li>
    <li><b>Sortino vs Sharpe.</b> Both divide mean daily PnL by a volatility measure; Sharpe uses the spread of <em>all</em> days, Sortino only the <em>downside</em> (losing-day) deviation. Sortino rewards strategies whose variance is mostly upside. Same daily, non-annualized basis as Sharpe — which uses population std and is near-meaningless on a handful of days.</li>
    <li><b>Largest Win / Loss Streak ($).</b> The most a single uninterrupted run of winning (or losing) trades added or subtracted, in dollars. A scratch (exactly 0) breaks the run. The Max Consecutive figures count trades in the longest run; these total the dollars.</li>
    <li><b>Best / Worst Weekday.</b> The active weekday with the highest / lowest AVERAGE PnL per trade (the trade count is shown alongside). Averaging — not total PnL — keeps days comparable regardless of how often you trade each one.</li>
    <li><b>Weekday &amp; streak samples are thin.</b> Best/Worst Weekday averages and the streak dollars are only as stable as the trades behind them — a single weekday or run with a handful of trades swings easily. Read them as hints, not verdicts, on small samples.</li>
  </Caveats>
</Panel>
