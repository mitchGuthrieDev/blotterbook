<script lang="ts">
  // Performance curve (A32; axis furniture added in A43). Daily cumulative series with selectable
  // gross / net / take-home overlays, computed by the shared pure dailySeries() (A29 — same math as
  // the vanilla curve) from the lifted cost inputs. Plus horizontal/vertical gridlines with y-$ and
  // x-date tick labels, end-of-line value labels, day note-dots, a hover/keyboard cursor with an
  // aria-live tooltip (B33), and click-to-select-day cross-link (B37).
  //
  // The viewBox WIDTH tracks the measured pixel width (like vanilla renderCurve) so the SVG text
  // labels aren't horizontally stretched — height is fixed, so both axes render at ~1:1.
  import { usd, money, axMoney, niceTicks, linePath, blendedRateFor } from '../../lib/core/core.ts';
  import type { Metrics } from '../../lib/core/core.ts';
  import { dailySeries } from '../../lib/core/curveseries.ts';
  import type { DailyPoint } from '../../lib/core/curveseries.ts';
  import type { CostInputs, PanelBundle } from '../../lib/core/types.ts';
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

  // A97 (R18 — promoted to all surfaces, CH16): the "Performance graph" definition is shown on the
  // chart it describes rather than in the standalone Definitions panel.

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
    // F28: each series carries its own area-fill path (gradient) alongside its line, so net + take-home
    // get the same filled treatment as gross and the three can be stacked back-to-front.
    lines: Array<Series & { d: string; area: string }>;
    prim: SeriesKey;
    idxByDate: Map<string, number>;
    notes: Array<{ x: number; y: number; date: string }>;
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
    { key: 'net', label: 'Net', color: 'var(--primary)' },
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

  function build(m: Metrics, ci: CostInputs, ser: Series[], w: number): View | null {
    const { pts: raw } = dailySeries(m, {
      broker: String(ci.broker ?? ''),
      tEff: blendedRateFor(ci.stateRate),
      // Clamp each term to ≥0 to mirror costModel's B13 guard (A116) so the curve's net/take endpoint
      // can't diverge from the cost panel on a negative input.
      fixedMo: Math.max(0, Number(ci.platform) || 0) + Math.max(0, Number(ci.feedCost) || 0),
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
    // F28: each series gets a line PLUS a closed area path (line → down to baseline → back) for its
    // gradient fill. Rendered in SERIES order (gross, net, take), so they stack back-to-front.
    const baseY = (H - padB).toFixed(1);
    const xN = x(pts.length - 1).toFixed(1);
    const x0 = x(0).toFixed(1);
    const lines = ser.map(s => {
      const d = linePath(pts.map(p => p[s.key]), x, y);
      return { ...s, d, area: `${d} L${xN},${baseY} L${x0},${baseY} Z` };
    });
    const idxByDate = new Map<string, number>();
    pts.forEach((p, i) => p.date && idxByDate.set(p.date, i));
    const notes: Array<{ x: number; y: number; date: string }> = [];
    for (const [date, i] of idxByDate) if (journalDates.has(date)) notes.push({ x: x(i), y: y(pts[i][prim]), date });
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
      pts, x, y, lo, hi, len: pts.length, lines, prim, idxByDate, notes,
      zeroY: lo <= 0 && hi >= 0 ? y(0) : null,
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
    <div class="overlays flex gap-1" role="group" aria-label="Curve overlays">
      {#each SERIES as s (s.key)}
        <button
          type="button"
          class={[
            'cursor-pointer rounded-[5px] border border-line bg-panel2 px-[9px] py-1 text-[11px]',
            sel[s.key] ? 'border-[var(--sw)] text-txt shadow-[inset_0_-2px_0_var(--sw)]' : 'text-dim',
          ]}
          aria-pressed={sel[s.key]}
          use:styleProps={{ '--sw': s.color }}
          onclick={() => toggle(s.key)}>{s.label}</button>
      {/each}
    </div>
  {/snippet}

  {#if view}
    <div class="w-full" bind:clientWidth={cw}>
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
          <!-- F28: one gradient per series, in its own color — gross/green, net/accent, take-home/take. -->
          <linearGradient id="eqfill-gross" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--green)" stop-opacity="0.24" />
            <stop offset="100%" stop-color="var(--green)" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="eqfill-net" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.24" />
            <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="eqfill-take" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--take)" stop-opacity="0.24" />
            <stop offset="100%" stop-color="var(--take)" stop-opacity="0" />
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
        <!-- F28: render each enabled series back-to-front (gross → net → take) as a gradient fill then
             its line, so the layers overlay: gross furthest back, net middle, take-home in front. -->
        {#each view.lines as ln (ln.key)}
          <path class="areafill" d={ln.area} fill="url(#eqfill-{ln.key})" />
          <path class="line" d={ln.d} fill="none" stroke={ln.color} vector-effect="non-scaling-stroke" />
        {/each}
        {#if view.zeroY != null}<line class="zero" x1={padL} y1={view.zeroY} x2={view.w - padR} y2={view.zeroY} vector-effect="non-scaling-stroke" />{/if}
        {#if selIdx != null}<line class="sel" x1={view.x(selIdx)} y1={padT} x2={view.x(selIdx)} y2={H - padB} vector-effect="non-scaling-stroke" />{/if}
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
    <div class="axis mt-1 flex justify-center font-mono text-[11px]">
      <span class="tip text-center text-dim" aria-live="polite">{tip || 'cumulative P&L'}</span>
    </div>
    <p class="mt-2 text-[11px] leading-[1.45] text-dim">X axis is the calendar date (the selected month's first to last day, or the full sample in All-time scope); Y axis is cumulative PnL. Toggle the Gross / Net / Take-home overlays above; clicking a calendar day marks it here.</p>
  {:else}
    <p class="px-1 py-6 text-dim">Not enough trades to plot a curve.</p>
  {/if}
</Panel>

<style>
  .equity {
    width: 100%;
    height: 240px;
    display: block;
    cursor: crosshair;
    /* A122: a click focuses the chart (it's keyboard-navigable) — suppress the text-selection
       highlight that a click/drag would otherwise paint over the SVG's text labels. */
    user-select: none;
    -webkit-user-select: none;
  }
  /* A122: show the focus ring ONLY for keyboard focus (:focus-visible), never the blue outline on a
     mouse click — keyboard a11y is preserved, the click outline is gone. */
  .equity:focus {
    outline: none;
  }
  .equity:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  /* F28: the per-series gradient area fills sit behind the lines; they never intercept the pointer. */
  .areafill {
    pointer-events: none;
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
  .sel {
    stroke: var(--primary);
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
    fill: var(--primary);
    stroke: var(--bg);
    stroke-width: 1.5;
  }
</style>
