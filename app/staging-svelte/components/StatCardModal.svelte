<script>
  // Stat-card detail modal (A35 — parity with vanilla widgets.js CARD_VIEWS / openCardModal, F14).
  // Clicking a headline Overview card opens this drill-down. All data comes from compute() metrics +
  // costModel (A29 — reuses dowBuckets/DOW_LABEL/minMax from core); charts are small inline SVG/bars.
  import { usd, money, cls, ratio, minMax, dowBuckets, DOW_LABEL } from '../../core.js';

  let { cardKey, metrics: m, cost: c, onclose } = $props();

  // Signed horizontal bars scaled to the max abs value.
  function bars(rows) {
    const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));
    return rows.map(r => ({ ...r, pct: (Math.abs(r.value) / max) * 100, tone: r.color || (r.value >= 0 ? 'var(--green)' : 'var(--red)') }));
  }
  // Cumulative-curve polyline (optionally marking peak→trough).
  function curvePath(curve) {
    if (!curve || curve.length < 2) return null;
    const { lo, hi } = minMax(curve);
    const span = hi - lo || 1;
    const W = 320,
      H = 90;
    const x = i => (i / (curve.length - 1)) * W;
    const y = v => H - ((v - lo) / span) * H;
    return { d: curve.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), x, y, W, H };
  }
  // Simple histogram (8 bins) of a value set.
  function hist(values) {
    if (!values.length) return [];
    const { lo, hi } = minMax(values);
    const span = hi - lo || 1;
    const bins = new Array(8).fill(0);
    for (const v of values) bins[Math.min(7, Math.floor(((v - lo) / span) * 8))]++;
    const max = Math.max(1, ...bins);
    return bins.map((n, i) => ({ pct: (n / max) * 100, lo: lo + (span * i) / 8, n }));
  }
  function symPf(trades) {
    const map = new Map();
    for (const t of trades) map.set(t.root, (map.get(t.root) || 0) + t.pnl);
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }

  const title = $derived(
    { net: 'Net PnL', win: 'Win Rate', pf: 'Profit Factor', wl: 'Avg Win / Loss', dd: 'Max Drawdown' }[cardKey] || 'Detail'
  );
  const ddCurve = $derived(cardKey === 'dd' || cardKey === 'net' ? curvePath(m.curve) : null);
</script>

<div class="overlay" role="presentation" onclick={e => e.target === e.currentTarget && onclose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <div class="head">
      <h2>{title}</h2>
      <button type="button" class="x" onclick={onclose} aria-label="Close">×</button>
    </div>
    <div class="body">
      {#if cardKey === 'net'}
        <div class="stats">
          <span><b class={cls(m.net)}>{usd(m.net)}</b> Gross</span>
          <span><b class={cls(c.netPreTax)}>{usd(c.netPreTax)}</b> Net (pre-tax)</span>
          <span><b class={cls(c.afterTax)}>{usd(c.afterTax)}</b> Take-home</span>
        </div>
        {#if ddCurve}<svg class="curve" viewBox="0 0 {ddCurve.W} {ddCurve.H}" preserveAspectRatio="none"><path d={ddCurve.d} fill="none" /></svg>{/if}
        <h3>Gross → net → take-home</h3>
        {@render barList(bars([
          { label: 'Gross', value: m.net },
          { label: '− Commissions', value: -c.totalComm },
          { label: '− Subscriptions', value: -c.fixedPeriod },
          { label: 'Net (pre-tax)', value: c.netPreTax },
          { label: '− 1256 tax', value: -c.tax },
          { label: 'Take-home', value: c.afterTax },
        ]))}
      {:else if cardKey === 'win'}
        <div class="stats">
          <span><b class="pos">{m.wins}</b> Wins</span>
          <span><b class="neg">{m.losses}</b> Losses</span>
          <span><b>{m.scratch}</b> Break-even</span>
        </div>
        <h3>PnL by weekday</h3>
        {@render barList(bars(dowBuckets(m.trades).map((d, i) => ({ label: DOW_LABEL[i], value: d.pnl })).filter((_, i) => i >= 1 && i <= 5)))}
        <h3>Long vs short (net PnL)</h3>
        {@render barList(bars([
          { label: `Long (${m.long.n})`, value: m.long.pnl },
          { label: `Short (${m.short.n})`, value: m.short.pnl },
        ]))}
      {:else if cardKey === 'pf'}
        <div class="stats"><span><b>{ratio(m.pf)}</b> gross profit ÷ gross loss</span></div>
        <h3>Gross profit vs gross loss</h3>
        {@render barList(bars([
          { label: 'Gross profit', value: c.pfGP, color: 'var(--green)' },
          { label: 'Gross loss', value: c.pfGL, color: 'var(--red)' },
        ]))}
        <h3>By symbol (net PnL)</h3>
        {@render barList(bars(symPf(m.trades)))}
      {:else if cardKey === 'wl'}
        <div class="stats">
          <span><b class="pos">{usd(m.avgW)}</b> Avg win</span>
          <span><b class="neg">{usd(m.avgL)}</b> Avg loss</span>
          <span><b>{ratio(m.wl)}</b> Ratio</span>
        </div>
        <h3>Win distribution</h3>
        {@render histChart(m.pnls.filter(p => p > 0), 'var(--green)')}
        <h3>Loss distribution (absolute)</h3>
        {@render histChart(m.pnls.filter(p => p < 0).map(p => -p), 'var(--red)')}
      {:else if cardKey === 'dd'}
        <div class="stats">
          <span><b class="neg">{usd(-m.maxDD)}</b> Max drawdown</span>
          <span><b>{ratio(m.recovery)}</b> Recovery factor</span>
          <span><b class={cls(m.net)}>{usd(m.net)}</b> Net PnL</span>
        </div>
        {#if ddCurve}
          <h3>Equity curve · peak → trough</h3>
          <svg class="curve" viewBox="0 0 {ddCurve.W} {ddCurve.H}" preserveAspectRatio="none">
            <path d={ddCurve.d} fill="none" />
            {#if m.ddPeakIdx != null && m.ddTroughIdx != null}
              <line class="mark" x1={ddCurve.x(m.ddPeakIdx)} y1="0" x2={ddCurve.x(m.ddPeakIdx)} y2={ddCurve.H} />
              <line class="mark trough" x1={ddCurve.x(m.ddTroughIdx)} y1="0" x2={ddCurve.x(m.ddTroughIdx)} y2={ddCurve.H} />
            {/if}
          </svg>
        {/if}
      {/if}
    </div>
  </div>
</div>

{#snippet histChart(values, color)}
  {#if values.length}
    <div class="bars">
      {#each hist(values) as b, i (i)}
        <div class="bar">
          <span class="bl">≥ {money(b.lo)}</span>
          <span class="bt"><span class="fill" style="width:{b.pct}%;background:{color}"></span></span>
          <span class="bv">{b.n}</span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty">No trades in this bucket.</p>
  {/if}
{/snippet}

{#snippet barList(rows)}
  <div class="bars">
    {#each rows as r, i (i)}
      <div class="bar">
        <span class="bl">{r.label}</span>
        <span class="bt"><span class="fill" style="width:{r.pct}%;background:{r.tone}"></span></span>
        <span class="bv">{money(r.value)}</span>
      </div>
    {/each}
  </div>
{/snippet}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 6vh 16px;
    z-index: 60;
  }
  .modal {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 12px;
    width: 100%;
    max-width: 460px;
    max-height: 88vh;
    overflow: auto;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
  }
  .head h2 {
    margin: 0;
    font-size: 15px;
  }
  .x {
    background: transparent;
    border: 0;
    color: var(--dim);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }
  .body {
    padding: 14px 16px 18px;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    font-size: 12px;
    color: var(--dim);
    margin-bottom: 14px;
  }
  .stats b {
    font-family: var(--mono);
    font-size: 15px;
    display: block;
    color: var(--txt);
  }
  .stats b.pos {
    color: var(--green);
  }
  .stats b.neg {
    color: var(--red);
  }
  h3 {
    margin: 14px 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
  }
  .curve {
    width: 100%;
    height: 90px;
  }
  .curve path {
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .curve .mark {
    stroke: var(--green);
    stroke-width: 1;
    stroke-dasharray: 3 2;
    vector-effect: non-scaling-stroke;
  }
  .curve .mark.trough {
    stroke: var(--red);
  }
  .bars {
    display: grid;
    gap: 5px;
  }
  .bar {
    display: grid;
    grid-template-columns: 130px 1fr 78px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .bl {
    color: var(--dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bt {
    background: var(--panel2);
    border-radius: 4px;
    height: 12px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
  }
  .bv {
    font-family: var(--mono);
    text-align: right;
    color: var(--txt);
  }
</style>
