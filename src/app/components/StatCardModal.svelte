<script lang="ts">
  // Stat-card detail modal (A35 — parity with vanilla widgets.js CARD_VIEWS / openCardModal, F14).
  // Clicking a headline Overview card opens this drill-down. All data comes from compute() metrics +
  // costModel (A29 — reuses dowBuckets/DOW_LABEL/minMax from core); charts are small inline SVG/bars.
  import { usd, money, cls, ratio, minMax, linePath, dowBuckets, DOW_LABEL } from '../../lib/core.ts';
  import type { Metrics } from '../../lib/core.ts';
  import type { CostModel, Trade } from '../../lib/types.ts';
  import { modal } from '../lib/modal.ts';
  import { styleProps } from '../lib/actions.ts';

  interface Props {
    cardKey: string;
    metrics: Metrics;
    cost: CostModel;
    onclose: () => void;
  }
  let { cardKey, metrics: m, cost: c, onclose }: Props = $props();

  interface BarRow {
    label: string;
    value: number;
    color?: string;
    n?: number;
  }
  // Signed horizontal bars scaled to the max abs value.
  function bars(rows: BarRow[]) {
    const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));
    return rows.map(r => ({ ...r, pct: (Math.abs(r.value) / max) * 100, tone: r.color || (r.value >= 0 ? 'var(--green)' : 'var(--red)') }));
  }
  // Cumulative-curve polyline (optionally marking peak→trough).
  function curvePath(curve: number[]) {
    if (!curve || curve.length < 2) return null;
    const { lo, hi } = minMax(curve);
    const span = hi - lo || 1;
    const W = 320,
      H = 90;
    const x = (i: number) => (i / (curve.length - 1)) * W;
    const y = (v: number) => H - ((v - lo) / span) * H;
    return { d: linePath(curve, x, y), x, y, W, H };
  }
  // Simple histogram (8 bins) of a value set.
  function hist(values: number[]) {
    if (!values.length) return [];
    const { lo, hi } = minMax(values);
    const span = hi - lo || 1;
    const bins = new Array(8).fill(0);
    for (const v of values) bins[Math.min(7, Math.floor(((v - lo) / span) * 8))]++;
    const max = Math.max(1, ...bins);
    return bins.map((n, i) => ({ pct: (n / max) * 100, lo: lo + (span * i) / 8, n }));
  }
  // Per-symbol gross profit factor + net (parity with vanilla cmSymPf — table, not bars).
  function symPfRows(trades: Trade[]) {
    const map = new Map<string, { gp: number; gl: number; n: number }>();
    for (const t of trades) {
      const r = t.root || '?';
      if (!map.has(r)) map.set(r, { gp: 0, gl: 0, n: 0 });
      const o = map.get(r)!;
      o.n++;
      if (t.pnl > 0) o.gp += t.pnl;
      else o.gl += t.pnl;
    }
    return [...map.entries()]
      .map(([root, o]) => ({ root, n: o.n, pf: o.gl !== 0 ? o.gp / Math.abs(o.gl) : Infinity, net: o.gp + o.gl }))
      .sort((a, b) => b.net - a.net);
  }

  const title = $derived(
    { net: 'Net PnL', win: 'Win Rate', pf: 'Profit Factor', wl: 'Avg Win / Loss', dd: 'Max Drawdown' }[cardKey] || 'Detail'
  );
  const ddCurve = $derived(cardKey === 'dd' || cardKey === 'net' ? curvePath(m.curve) : null);
</script>

<div class="overlay" role="presentation" onclick={(e: MouseEvent) => e.target === e.currentTarget && onclose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" use:modal={{ onclose }}>
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
        {@render splitBar([
          { value: m.wins, color: 'var(--green)', label: 'Wins' },
          { value: m.losses, color: 'var(--red)', label: 'Losses' },
          { value: m.scratch, color: 'var(--faint)', label: 'Break-even' },
        ])}
        <h3>PnL by weekday</h3>
        {@render barList(bars(dowBuckets(m.trades).map((d, i) => ({ label: `${DOW_LABEL[i]} (${d.n})`, value: d.pnl, n: d.n })).filter(d => d.n)))}
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
        <h3>By symbol</h3>
        {@render symPfTable(symPfRows(m.trades))}
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

{#snippet splitBar(segs: Array<{ value: number; color: string; label: string }>)}
  <div class="split">
    {#each segs.filter(s => s.value > 0) as s, i (i)}
      <span class="seg" use:styleProps={{ flex: s.value, background: s.color }} title="{s.label}: {s.value}">{s.value}</span>
    {/each}
  </div>
{/snippet}

{#snippet symPfTable(rows: Array<{ root: string; n: number; pf: number; net: number }>)}
  <table class="symtab">
    <thead><tr><th>Symbol</th><th>Trades</th><th>PF</th><th>Net</th></tr></thead>
    <tbody>
      {#each rows as r (r.root)}
        <tr><td>{r.root}</td><td>{r.n}</td><td>{ratio(r.pf)}</td><td class={cls(r.net)}>{usd(r.net)}</td></tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet histChart(values: number[], color: string)}
  {#if values.length}
    <div class="bars">
      {#each hist(values) as b, i (i)}
        <div class="bar">
          <span class="bl">≥ {money(b.lo)}</span>
          <span class="bt"><span class="fill" use:styleProps={{ width: b.pct + '%', background: color }}></span></span>
          <span class="bv">{b.n}</span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty">No trades in this bucket.</p>
  {/if}
{/snippet}

{#snippet barList(rows: Array<{ label: string; value: number; pct: number; tone: string }>)}
  <div class="bars">
    {#each rows as r, i (i)}
      <div class="bar">
        <span class="bl">{r.label}</span>
        <span class="bt"><span class="fill" use:styleProps={{ width: r.pct + '%', background: r.tone }}></span></span>
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
  .split {
    display: flex;
    height: 18px;
    border-radius: 5px;
    overflow: hidden;
    margin-bottom: 14px;
    gap: 1px;
  }
  .seg {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    color: #0d1014;
    font-size: 10px;
    font-weight: 700;
    font-family: var(--mono);
  }
  .symtab {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .symtab th {
    text-align: right;
    color: var(--faint);
    font-weight: 600;
    padding: 4px 6px;
    border-bottom: 1px solid var(--line);
  }
  .symtab th:first-child {
    text-align: left;
  }
  .symtab td {
    text-align: right;
    padding: 4px 6px;
    font-family: var(--mono);
    border-bottom: 1px solid var(--line);
  }
  .symtab td:first-child {
    text-align: left;
  }
  .symtab td.pos {
    color: var(--green);
  }
  .symtab td.neg {
    color: var(--red);
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
