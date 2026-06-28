<script>
  // Advanced statistics — the deeper compute() metrics not shown in the Overview, presented as
  // label/value rows (A29: pure presentation of the existing metrics object). DOW_LABEL/usd/cls
  // are imported verbatim from the core.
  import { usd, cls, ratio, num, fmtDur, DOW_LABEL } from '../../core.js';
  import Panel from './Panel.svelte';

  let { metrics, panel = {} } = $props();

  const dow = d => (d ? `${DOW_LABEL[d.i]} · ${usd(d.avg)}/trade` : '—');

  const rows = $derived(build(metrics));

  function build(m) {
    if (!m) return [];
    // Avg hold time is only available for fills-based platform exports (round-trip matched, so the
    // trade carries holdMs); computed straight off m.trades like vanilla renderAdv (A47/A29). It's
    // omitted entirely for close-event exports (e.g. TradingView) that carry no hold duration.
    const held = (m.trades || []).filter(t => t.holdMs != null && t.holdMs > 0);
    const avgHold = held.length ? held.reduce((a, t) => a + t.holdMs, 0) / held.length : null;
    const rows = [
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
  <div class="advstats rows">
    {#each rows as r (r.k)}
      <div class="row">
        <span class="k">{r.k}</span>
        <span class="v" class:pos={r.tone === 'pos'} class:neg={r.tone === 'neg'}>{r.v}</span>
      </div>
    {/each}
  </div>
</Panel>

<style>
  .rows {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 2px 24px;
  }
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 0;
    border-bottom: 1px solid var(--line);
  }
  .k {
    font-size: 12px;
    color: var(--dim);
  }
  .v {
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--txt);
    white-space: nowrap;
  }
  .v.pos {
    color: var(--green);
  }
  .v.neg {
    color: var(--red);
  }
</style>
