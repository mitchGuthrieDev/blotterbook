<script>
  // Overview cards — derived purely from the compute() metrics object (A29: no recomputation,
  // just presentation). Formatters (usd/money/cls) are imported verbatim from the core.
  import { usd, money, cls } from '../../core.js';
  import StatCard from './StatCard.svelte';

  let { metrics, tradeCount } = $props();

  const ratio = v => (v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(2) : '—');
  const num = v => (Number.isFinite(v) ? v.toFixed(2) : '—');

  const cards = $derived(build(metrics, tradeCount));

  function build(m, n) {
    if (!m) return [];
    return [
      { key: 'net', label: 'Net P&L', value: usd(m.net), tone: cls(m.net) },
      { key: 'win', label: 'Win rate', value: m.winRate.toFixed(1) + '%', sub: `${m.wins}W · ${m.losses}L · ${m.scratch}S` },
      { key: 'pf', label: 'Profit factor', value: ratio(m.pf), tone: cls(m.pf - 1) },
      { key: 'exp', label: 'Expectancy / trade', value: usd(m.expectancy), tone: cls(m.expectancy) },
      { key: 'trades', label: 'Trades', value: String(n), sub: `${m.active} trading days` },
      { key: 'avgday', label: 'Avg daily P&L', value: usd(m.avgDaily), tone: cls(m.avgDaily) },
      { key: 'dd', label: 'Max drawdown', value: '-' + money(m.maxDD), tone: m.maxDD > 0 ? 'neg' : '', sub: m.maxDDpct.toFixed(1) + '% of peak' },
      { key: 'sharpe', label: 'Sharpe (daily)', value: num(m.sharpe) },
      { key: 'best', label: 'Best day', value: m.bestDay ? usd(m.bestDay.pnl) : '—', tone: 'pos', sub: m.bestDay ? m.bestDay.date : '' },
      { key: 'worst', label: 'Worst day', value: m.worstDay ? usd(m.worstDay.pnl) : '—', tone: 'neg', sub: m.worstDay ? m.worstDay.date : '' },
    ];
  }
</script>

<section class="cards" aria-label="Overview metrics">
  {#each cards as c (c.key)}
    <StatCard card={c.key} label={c.label} value={c.value} tone={c.tone || ''} sub={c.sub || ''} />
  {/each}
</section>

<style>
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
</style>
