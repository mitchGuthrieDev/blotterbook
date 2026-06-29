<script lang="ts">
  // Performance curve (A32; axis furniture added in A43). Daily cumulative series with selectable
  // gross / net / take-home overlays, computed by the shared pure dailySeries() (A29 — same math as
  // the vanilla curve) from the lifted cost inputs. Plus horizontal/vertical gridlines with y-$ and
  // x-date tick labels, end-of-line value labels, day note-dots, a hover/keyboard cursor with an
  // aria-live tooltip (B33), and click-to-select-day cross-link (B37).
  //
  // The viewBox WIDTH tracks the measured pixel width (like vanilla renderCurve) so the SVG text
  // labels aren't horizontally stretched — height is fixed, so both axes render at ~1:1.
  import { usd, money, axMoney, niceTicks, linePath, blendedRateFor } from '../../lib/core.ts';
  import type { Metrics } from '../../lib/core.ts';
  import { dailySeries } from '../../lib/curveseries.ts';
  import type { DailyPoint } from '../../lib/curveseries.ts';
  import type { CostInputs, PanelBundle } from '../../lib/types.ts';
  import Panel from './Panel.svelte';
  import { styleProps } from '../lib/actions.ts';

  interface Props {
    metrics: Metrics;
    costInputs: CostInputs;
    journalDates?: Set<string>;
    selectedDate?: string | null;
    onselect?: (d: string) => void;
    panel?: PanelBundle;
  }
  let { metrics, costInputs, journalDates = new Set(), selectedDate = null, onselect = () => {}, panel = {} as PanelBundle }: Props = $props();

  /** One overlay series descriptor; `key` indexes into a curve point's numeric fields. */
  type SeriesKey = 'gross' | 'net' | 'take';
  interface Series {
    key: SeriesKey;
    label: string;
    color: string;
  }
  /** A curve point: the synthetic origin (date null) prepended to the DailyPoint series. */
  interface CurvePoint {
    date: string | null;
    gross: number;
    net: number;
    take: number;
  }
  /** The fully resolved geometry/view model produced by build(). */
  interface View {
    pts: CurvePoint[];
    x: (i: number) => number;
    y: (v: number) => number;
    lo: number;
    hi: number;
    len: number;
    lines: Array<Series & { d: string }>;
    area: string;
    prim: SeriesKey;
    idxByDate: Map<string, number>;
    notes: Array<{ x: number; y: number; date: string }>;
    dd: { x0: number; x1: number } | null;
    primColor: string;
    zeroY: number | null;
    w: number;
    yticks: Array<{ v: number; y: number; label: string }>;
    xticks: Array<{ x: number; label: string }>;
    ends: Array<{ color: string; y: number; label: string }>;
  }

  const H = 240;
  const padL = 52; // y-axis $ labels
  const padR = 58; // end-of-line value labels
  const padT = 14;
  const padB = 22; // x-axis date labels
  const SERIES: Series[] = [
    { key: 'gross', label: 'Gross', color: 'var(--green)' },
    { key: 'net', label: 'Net', color: 'var(--accent)' },
    { key: 'take', label: 'Take-home', color: 'var(--take)' },
  ];

  let sel = $state<Record<SeriesKey, boolean>>({ gross: true, net: false, take: false });
  let cursor = $state<number | null>(null);
  let cw = $state(0); // measured plot width (px) → viewBox width, so labels don't stretch

  const W = $derived(Math.max(560, cw || 800));
  const enabled = $derived.by(() => {
    const on = SERIES.filter(s => sel[s.key]);
    return on.length ? on : [SERIES[0]];
  });
  const view = $derived(build(metrics, costInputs, enabled, W));
  const tip = $derived(
    view && cursor != null && view.pts[cursor].date
      ? `${view.pts[cursor].date} · ${enabled.map(s => `${s.label} ${usd(view.pts[cursor as number][s.key])}`).join(' · ')}`
      : ''
  );
  const selIdx = $derived(view && selectedDate ? (view.idxByDate.get(selectedDate) ?? null) : null);
  const grossOnly = $derived(enabled.length === 1 && enabled[0].key === 'gross');

  function build(m: Metrics, ci: CostInputs, ser: Series[], w: number): View | null {
    const { pts: raw } = dailySeries(m, {
      broker: String(ci.broker ?? ''),
      tEff: blendedRateFor(ci.stateRate),
      fixedMo: (Number(ci.platform) || 0) + (Number(ci.feedCost) || 0),
    });
    if (raw.length < 1) return null;
    const pts: CurvePoint[] = [{ date: null, gross: 0, net: 0, take: 0 }, ...raw];
    if (pts.length < 2) return null;
    let lo = Infinity,
      hi = -Infinity;
    for (const p of pts) for (const s of ser) {
      if (p[s.key] < lo) lo = p[s.key];
      if (p[s.key] > hi) hi = p[s.key];
    }
    // Frame the domain out to nice round tick bounds so the plot + gridlines sit cleanly.
    const ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]);
    hi = Math.max(hi, ticks[ticks.length - 1]);
    const span = hi - lo || 1;
    const x = (i: number) => padL + (i / (pts.length - 1)) * (w - padL - padR);
    const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);
    const prim = ser[0].key;
    const lines = ser.map(s => ({ ...s, d: linePath(pts.map(p => p[s.key]), x, y) }));
    const baseY = (H - padB).toFixed(1);
    const area = `${linePath(pts.map(p => p[prim]), x, y)} L${x(pts.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
    const idxByDate = new Map<string, number>();
    pts.forEach((p, i) => p.date && idxByDate.set(p.date, i));
    const notes: Array<{ x: number; y: number; date: string }> = [];
    for (const [date, i] of idxByDate) if (journalDates.has(date)) notes.push({ x: x(i), y: y(pts[i][prim]), date });
    // Realized drawdown peak→trough on the gross series (shaded only when gross is the sole overlay).
    let gpeak = -Infinity,
      gpeakI = 0,
      maxDD = 0,
      ddP = 0,
      ddT = 0;
    pts.forEach((p, i) => {
      if (p.gross > gpeak) {
        gpeak = p.gross;
        gpeakI = i;
      }
      const d = gpeak - p.gross;
      if (d > maxDD) {
        maxDD = d;
        ddP = gpeakI;
        ddT = i;
      }
    });
    const dd = maxDD > 0 ? { x0: x(ddP), x1: x(ddT) } : null;
    // Axis ticks: y $ gridlines (framed ticks) + x date labels (5 across the real dates).
    const yticks = ticks.map(v => ({ v, y: y(v), label: axMoney(v) }));
    const xticks: Array<{ x: number; label: string }> = [];
    const seen = new Set<string>();
    for (let k = 0; k <= 4; k++) {
      const i = Math.min(pts.length - 1, 1 + Math.round(((pts.length - 2) * k) / 4));
      const date = pts[i] && pts[i].date;
      if (date && !seen.has(date)) {
        seen.add(date);
        xticks.push({ x: x(i), label: date.slice(5).replace('-', '/') });
      }
    }
    const last = pts[pts.length - 1];
    const ends = ser.map(s => ({ color: s.color, y: y(last[s.key]), label: usd(last[s.key]) }));
    return {
      pts, x, y, lo, hi, len: pts.length, lines, area, prim, idxByDate, notes, dd,
      primColor: ser[0].color, zeroY: lo <= 0 && hi >= 0 ? y(0) : null,
      w, yticks, xticks, ends,
    };
  }

  function toggle(key: SeriesKey) {
    const on = (Object.keys(sel) as SeriesKey[]).filter(k => sel[k]);
    if (sel[key] && on.length === 1) return; // keep at least one
    sel[key] = !sel[key];
  }

  function idxFromEvent(e: PointerEvent) {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * view!.w;
    return Math.max(1, Math.min(view!.len - 1, Math.round(((vbx - padL) / (view!.w - padL - padR)) * (view!.len - 1))));
  }
  const move = (e: PointerEvent) => (cursor = idxFromEvent(e));
  const pick = () => {
    if (cursor != null && view && view.pts[cursor].date) onselect(view.pts[cursor].date as string);
  };
  function onkeydown(e: KeyboardEvent) {
    if (!view) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const base = cursor == null ? view.len - 1 : cursor;
      cursor = Math.max(1, Math.min(view.len - 1, base + (e.key === 'ArrowRight' ? 1 : -1)));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  }
</script>

<Panel {...panel} title="Performance">
  {#snippet actions()}
    <div class="overlays" role="group" aria-label="Curve overlays">
      {#each SERIES as s (s.key)}
        <button type="button" class:on={sel[s.key]} aria-pressed={sel[s.key]} use:styleProps={{ '--sw': s.color }} onclick={() => toggle(s.key)}>{s.label}</button>
      {/each}
    </div>
  {/snippet}

  {#if view}
    <div class="plot" bind:clientWidth={cw}>
      <!-- A deliberately keyboard-navigable chart widget: tabindex + arrow/Enter handlers, with the
           aria-label documenting the interaction; role="img" conveys the visual to AT. svelte-check
           treats every <svg> as non-interactive regardless of role, so the two interaction warnings
           are suppressed (one per line — combined-line ignores only apply the first code here). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <svg
        class="equity"
        viewBox="0 0 {view.w} {H}"
        preserveAspectRatio="none"
        role="img"
        aria-label="Cumulative performance curve — arrow keys inspect days, Enter selects"
        tabindex="0"
        onpointermove={move}
        onpointerleave={() => (cursor = null)}
        onclick={pick}
        {onkeydown}
      >
        <defs>
          <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color={view.primColor} stop-opacity="0.22" />
            <stop offset="100%" stop-color={view.primColor} stop-opacity="0" />
          </linearGradient>
        </defs>
        <!-- horizontal gridlines + y-axis $ labels -->
        {#each view.yticks as t (t.v)}
          <line class="grid" x1={padL} y1={t.y} x2={view.w - padR} y2={t.y} />
          <text class="ylab" x={padL - 6} y={t.y + 3.5} text-anchor="end">{t.label}</text>
        {/each}
        <!-- x-axis date labels -->
        {#each view.xticks as t, i (i)}
          <text class="xlab" x={t.x} y={H - padB + 15} text-anchor="middle">{t.label}</text>
        {/each}
        <path d={view.area} fill="url(#eqfill)" />
        {#if grossOnly && view.dd}<rect class="ddband" x={view.dd.x0} y={padT} width={Math.max(0, view.dd.x1 - view.dd.x0)} height={H - padT - padB} />{/if}
        {#if view.zeroY != null}<line class="zero" x1={padL} y1={view.zeroY} x2={view.w - padR} y2={view.zeroY} vector-effect="non-scaling-stroke" />{/if}
        {#if selIdx != null}<line class="sel" x1={view.x(selIdx)} y1={padT} x2={view.x(selIdx)} y2={H - padB} vector-effect="non-scaling-stroke" />{/if}
        {#each view.lines as ln (ln.key)}
          <path class="line" d={ln.d} fill="none" stroke={ln.color} vector-effect="non-scaling-stroke" />
        {/each}
        <!-- end-of-line value markers + labels -->
        {#each view.ends as e, i (i)}
          <circle class="enddot" cx={view.w - padR} cy={e.y} r="3" fill={e.color} />
          <text class="endlab" x={view.w - padR + 5} y={e.y + 3.5} text-anchor="start" use:styleProps={{ fill: e.color }}>{e.label}</text>
        {/each}
        {#each view.notes as nd (nd.date)}
          <circle class="notedot" cx={nd.x} cy={nd.y} r="3" vector-effect="non-scaling-stroke" />
        {/each}
        {#if cursor != null}
          <line class="cursor" x1={view.x(cursor)} y1={padT} x2={view.x(cursor)} y2={H - padB} vector-effect="non-scaling-stroke" />
          <circle class="dot" cx={view.x(cursor)} cy={view.y(view.pts[cursor][view.prim])} r="3.5" vector-effect="non-scaling-stroke" />
        {/if}
      </svg>
    </div>
    <div class="axis">
      <span class="tip" aria-live="polite">{tip || 'cumulative P&L'}</span>
    </div>
  {:else}
    <p class="empty">Not enough trades to plot a curve.</p>
  {/if}
</Panel>

<style>
  .overlays {
    display: flex;
    gap: 4px;
  }
  .overlays button {
    background: var(--panel2);
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 4px 9px;
    font-size: 11px;
    cursor: pointer;
  }
  .overlays button.on {
    color: var(--txt);
    border-color: var(--sw);
    box-shadow: inset 0 -2px 0 var(--sw);
  }
  .plot {
    width: 100%;
  }
  .equity {
    width: 100%;
    height: 240px;
    display: block;
    cursor: crosshair;
  }
  .equity:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .ylab,
  .xlab {
    fill: var(--faint);
    font-family: var(--mono);
    font-size: 10px;
  }
  .line {
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .zero {
    stroke: var(--dim);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .ddband {
    fill: var(--red);
    opacity: 0.08;
  }
  .sel {
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }
  .cursor {
    stroke: var(--dim);
    stroke-width: 1;
  }
  .dot {
    fill: var(--txt);
  }
  .enddot {
    stroke: var(--bg);
    stroke-width: 1;
  }
  .endlab {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
  }
  .notedot {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 1.5;
  }
  .axis {
    display: flex;
    justify-content: center;
    font-family: var(--mono);
    font-size: 11px;
    margin-top: 4px;
  }
  .axis .tip {
    color: var(--dim);
    text-align: center;
  }
  .empty {
    color: var(--dim);
    padding: 24px 4px;
  }
</style>
