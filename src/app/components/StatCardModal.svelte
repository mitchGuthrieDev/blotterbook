<script lang="ts">
  // Stat-card detail modal (A35 — parity with vanilla widgets.js CARD_VIEWS / openCardModal, F14).
  // Clicking a headline Overview card opens this drill-down. All data comes from compute() metrics +
  // costModel (A29 — reuses dowBuckets/DOW_LABEL/minMax from core); charts are small inline SVG/bars.
  import { usd, money, ratio, minMax, linePath, dowBuckets, DOW_LABEL } from '../../lib/core.ts';
  import type { Metrics } from '../../lib/core.ts';
  import type { CostModel, Trade } from '../../lib/types.ts';
  import * as Dialog from '$ui/dialog';
  import { styleProps } from '../lib/actions.ts';

  interface Props {
    cardKey: string;
    metrics: Metrics;
    cost: CostModel;
    onclose: () => void;
  }
  let { cardKey, metrics: m, cost: c, onclose }: Props = $props();

  // Signed-value → text-color utility (replaces the scoped .pos/.neg rules; A128/ADR-002).
  const tone = (v: number) => (v > 0 ? 'text-green' : v < 0 ? 'text-red' : 'text-txt');

  interface BarRow {
    label: string;
    value: number;
    color?: string;
    n?: number;
  }
  // A102: named aliases for the snippet/return shapes below (was inline anonymous object types).
  type SplitSeg = { value: number; color: string; label: string };
  type SymPfRow = { root: string; n: number; pf: number; net: number };
  type RenderedBar = { label: string; value: number; pct: number; tone: string };
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
  function symPfRows(trades: Trade[]): SymPfRow[] {
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

  // A97 (R18 — promoted to all surfaces, CH16): each headline definition lives in the drill-down modal
  // that owns the card (net/win/wl/dd), pulled from the trimmed Definitions panel.

  const title = $derived(
    { net: 'Net PnL', win: 'Win Rate', pf: 'Profit Factor', wl: 'Avg Win / Loss', dd: 'Max Drawdown' }[cardKey] || 'Detail'
  );
  const ddCurve = $derived(cardKey === 'dd' || cardKey === 'net' ? curvePath(m.curve) : null);
</script>

<Dialog.Root open onOpenChange={(o: boolean) => !o && onclose()}>
  <Dialog.Content class="modal" aria-label={title}>
    <div class="flex items-center justify-between border-b border-line px-4 py-3.5">
      <h2 class="m-0 text-[15px]">{title}</h2>
      <Dialog.Close class="x cursor-pointer border-0 bg-transparent text-[22px] leading-none text-dim hover:text-txt" aria-label="Close"
        >×</Dialog.Close
      >
    </div>
    <div class="px-4 pb-[18px] pt-3.5">
      {#if cardKey === 'net'}
        <div class="mb-3.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[12px] text-dim">
          <span><b class="block font-mono text-[15px] {tone(m.net)}">{usd(m.net)}</b> Gross</span>
          <span><b class="block font-mono text-[15px] {tone(c.netPreTax)}">{usd(c.netPreTax)}</b> Net (pre-tax)</span>
          <span><b class="block font-mono text-[15px] {tone(c.afterTax)}">{usd(c.afterTax)}</b> Take-home</span>
        </div>
        <p class="mb-3.5 mt-0 text-[12px] leading-[1.55] text-dim">Net PnL = gross − per-symbol commissions − subscriptions (a full month per calendar month in your date range). Take-home is Net PnL after the estimated Section 1256 tax.</p>
        {#if ddCurve}<svg class="curve h-[90px] w-full" viewBox="0 0 {ddCurve.W} {ddCurve.H}" preserveAspectRatio="none"><path d={ddCurve.d} fill="none" /></svg>{/if}
        <h3 class="mb-2 mt-3.5 text-[11px] uppercase tracking-[0.5px] text-faint">Gross → net → take-home</h3>
        {@render barList(bars([
          { label: 'Gross', value: m.net },
          { label: '− Commissions', value: -c.totalComm },
          { label: '− Subscriptions', value: -c.fixedPeriod },
          { label: 'Net (pre-tax)', value: c.netPreTax },
          { label: '− 1256 tax', value: -c.tax },
          { label: 'Take-home', value: c.afterTax },
        ]))}
      {:else if cardKey === 'win'}
        <div class="mb-3.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[12px] text-dim">
          <span><b class="block font-mono text-[15px] text-green">{m.wins}</b> Wins</span>
          <span><b class="block font-mono text-[15px] text-red">{m.losses}</b> Losses</span>
          <span><b class="block font-mono text-[15px] text-txt">{m.scratch}</b> Break-even</span>
        </div>
        <p class="mb-3.5 mt-0 text-[12px] leading-[1.55] text-dim">Win = realized PnL &gt; 0, Loss = &lt; 0, Scratch = exactly 0. Win Rate = wins ÷ total trades (scratches stay in the denominator).</p>
        {@render splitBar([
          { value: m.wins, color: 'var(--green)', label: 'Wins' },
          { value: m.losses, color: 'var(--red)', label: 'Losses' },
          { value: m.scratch, color: 'var(--faint)', label: 'Break-even' },
        ])}
        <h3 class="mb-2 mt-3.5 text-[11px] uppercase tracking-[0.5px] text-faint">PnL by weekday</h3>
        {@render barList(bars(dowBuckets(m.trades).map((d, i) => ({ label: `${DOW_LABEL[i]} (${d.n})`, value: d.pnl, n: d.n })).filter(d => d.n)))}
        <h3 class="mb-2 mt-3.5 text-[11px] uppercase tracking-[0.5px] text-faint">Long vs short (net PnL)</h3>
        {@render barList(bars([
          { label: `Long (${m.long.n})`, value: m.long.pnl },
          { label: `Short (${m.short.n})`, value: m.short.pnl },
        ]))}
      {:else if cardKey === 'pf'}
        <div class="mb-3.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[12px] text-dim"><span><b class="block font-mono text-[15px] text-txt">{ratio(m.pf)}</b> gross profit ÷ gross loss</span></div>
        <h3 class="mb-2 mt-3.5 text-[11px] uppercase tracking-[0.5px] text-faint">Gross profit vs gross loss</h3>
        {@render barList(bars([
          { label: 'Gross profit', value: c.pfGP, color: 'var(--green)' },
          { label: 'Gross loss', value: c.pfGL, color: 'var(--red)' },
        ]))}
        <h3 class="mb-2 mt-3.5 text-[11px] uppercase tracking-[0.5px] text-faint">By symbol</h3>
        {@render symPfTable(symPfRows(m.trades))}
      {:else if cardKey === 'wl'}
        <div class="mb-3.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[12px] text-dim">
          <span><b class="block font-mono text-[15px] text-green">{usd(m.avgW)}</b> Avg win</span>
          <span><b class="block font-mono text-[15px] text-red">{usd(m.avgL)}</b> Avg loss</span>
          <span><b class="block font-mono text-[15px] text-txt">{ratio(m.wl)}</b> Ratio</span>
        </div>
        <p class="mb-3.5 mt-0 text-[12px] leading-[1.55] text-dim">Avg Winner = gross profit ÷ winning trades; Avg Loser = gross loss ÷ losing trades. Payoff Ratio = Avg Winner ÷ |Avg Loser| — above 1 means your winners are bigger than your losers; pair it with win rate to read the edge.</p>
        <h3 class="mb-2 mt-3.5 text-[11px] uppercase tracking-[0.5px] text-faint">Win distribution</h3>
        {@render histChart(m.pnls.filter(p => p > 0), 'var(--green)')}
        <h3 class="mb-2 mt-3.5 text-[11px] uppercase tracking-[0.5px] text-faint">Loss distribution (absolute)</h3>
        {@render histChart(m.pnls.filter(p => p < 0).map(p => -p), 'var(--red)')}
      {:else if cardKey === 'dd'}
        <div class="mb-3.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[12px] text-dim">
          <span><b class="block font-mono text-[15px] text-red">{usd(-m.maxDD)}</b> Max drawdown</span>
          <span><b class="block font-mono text-[15px] text-txt">{ratio(m.recovery)}</b> Recovery factor</span>
          <span><b class="block font-mono text-[15px] {tone(m.net)}">{usd(m.net)}</b> Net PnL</span>
        </div>
        <p class="mb-3.5 mt-0 border-l-2 border-warn pl-2.5 text-[12px] leading-[1.55] text-dim">Max Drawdown is REALIZED only — computed on the closed-trade equity curve, peak-to-trough. The % is peak-relative and the duration counts trades from that peak to the trough. It does NOT capture open-position heat between entry and exit, and the % is undefined until the curve first goes positive.</p>
        {#if ddCurve}
          <h3 class="mb-2 mt-3.5 text-[11px] uppercase tracking-[0.5px] text-faint">Equity curve · peak → trough</h3>
          <svg class="curve h-[90px] w-full" viewBox="0 0 {ddCurve.W} {ddCurve.H}" preserveAspectRatio="none">
            <path d={ddCurve.d} fill="none" />
            {#if m.ddPeakIdx != null && m.ddTroughIdx != null}
              <line class="mark" x1={ddCurve.x(m.ddPeakIdx)} y1="0" x2={ddCurve.x(m.ddPeakIdx)} y2={ddCurve.H} />
              <line class="mark trough" x1={ddCurve.x(m.ddTroughIdx)} y1="0" x2={ddCurve.x(m.ddTroughIdx)} y2={ddCurve.H} />
            {/if}
          </svg>
        {/if}
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

{#snippet splitBar(segs: SplitSeg[])}
  <div class="split mb-3.5 flex h-[18px] gap-px overflow-hidden rounded-[5px]">
    {#each segs.filter(s => s.value > 0) as s, i (i)}
      <span class="seg flex min-w-[14px] items-center justify-center font-mono text-[10px] font-bold text-bg" use:styleProps={{ flex: s.value, background: s.color }} title="{s.label}: {s.value}">{s.value}</span>
    {/each}
  </div>
{/snippet}

{#snippet symPfTable(rows: SymPfRow[])}
  <table class="symtab w-full border-collapse text-[12px]">
    <thead><tr><th class="border-b border-line px-1.5 py-1 text-left font-semibold text-faint">Symbol</th><th class="border-b border-line px-1.5 py-1 text-right font-semibold text-faint">Trades</th><th class="border-b border-line px-1.5 py-1 text-right font-semibold text-faint">PF</th><th class="border-b border-line px-1.5 py-1 text-right font-semibold text-faint">Net</th></tr></thead>
    <tbody>
      {#each rows as r (r.root)}
        <tr><td class="border-b border-line px-1.5 py-1 text-left font-mono">{r.root}</td><td class="border-b border-line px-1.5 py-1 text-right font-mono">{r.n}</td><td class="border-b border-line px-1.5 py-1 text-right font-mono">{ratio(r.pf)}</td><td class="border-b border-line px-1.5 py-1 text-right font-mono {tone(r.net)}">{usd(r.net)}</td></tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet histChart(values: number[], color: string)}
  {#if values.length}
    <div class="bars grid gap-[5px]">
      {#each hist(values) as b, i (i)}
        <div class="grid grid-cols-[130px_1fr_78px] items-center gap-2 text-[12px]">
          <span class="overflow-hidden text-ellipsis whitespace-nowrap text-dim">≥ {money(b.lo)}</span>
          <span class="h-3 overflow-hidden rounded-[4px] bg-panel2"><span class="block h-full" use:styleProps={{ width: b.pct + '%', background: color }}></span></span>
          <span class="text-right font-mono text-txt">{b.n}</span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-[12px] text-dim">No trades in this bucket.</p>
  {/if}
{/snippet}

{#snippet barList(rows: RenderedBar[])}
  <div class="bars grid gap-[5px]">
    {#each rows as r, i (i)}
      <div class="grid grid-cols-[130px_1fr_78px] items-center gap-2 text-[12px]">
        <span class="overflow-hidden text-ellipsis whitespace-nowrap text-dim">{r.label}</span>
        <span class="h-3 overflow-hidden rounded-[4px] bg-panel2"><span class="block h-full" use:styleProps={{ width: r.pct + '%', background: r.tone }}></span></span>
        <span class="text-right font-mono text-txt">{money(r.value)}</span>
      </div>
    {/each}
  </div>
{/snippet}

<style>
  .curve path {
    stroke: var(--primary);
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
</style>
