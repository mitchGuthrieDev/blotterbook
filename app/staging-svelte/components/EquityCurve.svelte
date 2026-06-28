<script>
  // Cumulative-equity curve, derived from compute()'s m.curve (A29: no recomputation). This is
  // the core line + gradient fill; the gross/net/take-home overlays, hover tooltip, keyboard a11y
  // and note dots from the vanilla curve are ported in later A27 slices.
  import { minMax, usd } from '../../core.js';

  let { metrics } = $props();

  const W = 800;
  const H = 240;
  const PX = 10; // horizontal padding
  const PY = 14; // vertical padding

  const view = $derived(build(metrics));

  function build(m) {
    const c = m && m.curve ? m.curve : [];
    if (c.length < 2) return null;
    const { lo, hi } = minMax(c);
    const span = hi - lo || 1;
    const x = i => PX + (i / (c.length - 1)) * (W - 2 * PX);
    const y = v => PY + (1 - (v - lo) / span) * (H - 2 * PY);
    const line = c.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const baseY = (H - PY).toFixed(1);
    const area = `${line} L${x(c.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
    const zeroY = lo <= 0 && hi >= 0 ? y(0).toFixed(1) : null;
    const up = c[c.length - 1] >= 0;
    return { line, area, zeroY, hi, lo, up };
  }
</script>

<section class="panel">
  <div class="phead">
    <h2>Performance</h2>
    {#if metrics}<span class="net" class:neg={metrics.net < 0}>{usd(metrics.net)}</span>{/if}
  </div>

  {#if view}
    <svg class="equity" class:neg={!view.up} viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Cumulative equity curve">
      <defs>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <stop class="g0" offset="0%" />
          <stop class="g1" offset="100%" />
        </linearGradient>
      </defs>
      <path class="fill" d={view.area} fill="url(#eqfill)" />
      {#if view.zeroY}<line class="zero" x1={PX} y1={view.zeroY} x2={W - PX} y2={view.zeroY} vector-effect="non-scaling-stroke" />{/if}
      <path class="line" d={view.line} fill="none" vector-effect="non-scaling-stroke" />
    </svg>
    <div class="axis">
      <span>{usd(view.lo)}</span>
      <span class="dim">cumulative P&L</span>
      <span>{usd(view.hi)}</span>
    </div>
  {:else}
    <p class="empty">Not enough trades to plot a curve.</p>
  {/if}
</section>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px 12px;
    margin-top: 16px;
  }
  .phead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
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
  .net {
    font-family: var(--mono);
    font-size: 16px;
    font-weight: 700;
    color: var(--green);
  }
  .net.neg {
    color: var(--red);
  }
  .equity {
    width: 100%;
    height: 240px;
    display: block;
  }
  .line {
    stroke: var(--green);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .equity.neg .line {
    stroke: var(--red);
  }
  .g0 {
    stop-color: var(--green);
    stop-opacity: 0.28;
  }
  .g1 {
    stop-color: var(--green);
    stop-opacity: 0;
  }
  .equity.neg .g0 {
    stop-color: var(--red);
  }
  .equity.neg .g1 {
    stop-color: var(--red);
  }
  .zero {
    stroke: var(--line);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .axis {
    display: flex;
    justify-content: space-between;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--faint);
    margin-top: 4px;
  }
  .axis .dim {
    color: var(--dim);
  }
  .empty {
    color: var(--dim);
    padding: 24px 4px;
  }
</style>
