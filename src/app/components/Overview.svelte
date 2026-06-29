<script lang="ts">
  // Overview cards — derived purely from the compute() metrics object (A29: no recomputation,
  // just presentation). Formatters (usd/money/cls) are imported verbatim from the core.
  import { usd, money, cls, ratio, num, STAGING_PAGE } from '../../lib/core.ts';
  import type { Metrics } from '../../lib/core.ts';
  import StatCard from './StatCard.svelte';

  interface Props {
    metrics: Metrics;
    tradeCount: number;
    oncard?: (key: string) => void;
  }
  let { metrics, tradeCount, oncard = () => {} }: Props = $props();
  const MODAL_KEYS = new Set(['net', 'win', 'pf', 'wl', 'dd']); // cards with F14 detail modals
  // F25 (staging): the Overview keeps ONLY the five interactive cards (each has a pop-up modal); the
  // remaining static cards are removed here and folded into the Advanced Statistics panel instead.
  // Prod/demo keep the full card grid until this is promoted (CH16).

  const cards = $derived(build(metrics, tradeCount).filter(c => !STAGING_PAGE || MODAL_KEYS.has(c.key)));

  function build(m: Metrics, n: number) {
    if (!m) return [];
    return [
      { key: 'net', label: 'Net P&L', value: usd(m.net), tone: cls(m.net) },
      { key: 'win', label: 'Win rate', value: m.winRate.toFixed(1) + '%', sub: `${m.wins}W · ${m.losses}L · ${m.scratch}S` },
      { key: 'pf', label: 'Profit factor', value: ratio(m.pf), tone: cls(m.pf - 1) },
      { key: 'wl', label: 'Avg win / loss', value: ratio(m.wl), sub: `${usd(m.avgW)} / ${usd(m.avgL)}` },
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
    <StatCard card={c.key} label={c.label} value={c.value} tone={c.tone || ''} sub={c.sub || ''} onclick={MODAL_KEYS.has(c.key) ? () => oncard(c.key) : null} />
  {/each}
</section>

<style>
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
</style>
