<script>
  // Performance curve (A32). Daily cumulative series with selectable gross / net / take-home
  // overlays, computed by the shared pure dailySeries() (A29 — same math as the vanilla curve)
  // from the lifted cost inputs. Plus day note-dots, a hover/keyboard cursor with an aria-live
  // tooltip (B33), and click-to-select-day cross-link (B37).
  import { usd, money, blendedRateFor } from '../../core.js';
  import { dailySeries } from '../../curveseries.js';
  import Panel from './Panel.svelte';

  let { metrics, costInputs, journalDates = new Set(), selectedDate = null, onselect = () => {}, panel = {} } = $props();

  const W = 800;
  const H = 240;
  const PX = 10;
  const PY = 16;
  const SERIES = [
    { key: 'gross', label: 'Gross', color: 'var(--green)' },
    { key: 'net', label: 'Net', color: 'var(--accent)' },
    { key: 'take', label: 'Take-home', color: 'var(--take)' },
  ];

  let sel = $state({ gross: true, net: false, take: false });
  let cursor = $state(null);

  const enabled = $derived(SERIES.filter(s => sel[s.key]).length ? SERIES.filter(s => sel[s.key]) : [SERIES[0]]);
  const view = $derived(build(metrics, costInputs, enabled));
  const tip = $derived(
    view && cursor != null && view.pts[cursor].date
      ? `${view.pts[cursor].date} · ${enabled.map(s => `${s.label} ${usd(view.pts[cursor][s.key])}`).join(' · ')}`
      : ''
  );
  const selIdx = $derived(view && selectedDate ? (view.idxByDate.get(selectedDate) ?? null) : null);
  const grossOnly = $derived(enabled.length === 1 && enabled[0].key === 'gross');

  function build(m, ci, ser) {
    const { pts: raw } = dailySeries(m, {
      broker: ci.broker,
      tEff: blendedRateFor(ci.stateRate),
      fixedMo: (ci.platform || 0) + (ci.feedCost || 0),
    });
    if (raw.length < 1) return null;
    const pts = [{ date: null, gross: 0, net: 0, take: 0 }, ...raw];
    if (pts.length < 2) return null;
    let lo = Infinity,
      hi = -Infinity;
    for (const p of pts) for (const s of ser) {
      if (p[s.key] < lo) lo = p[s.key];
      if (p[s.key] > hi) hi = p[s.key];
    }
    const span = hi - lo || 1;
    const x = i => PX + (i / (pts.length - 1)) * (W - 2 * PX);
    const y = v => PY + (1 - (v - lo) / span) * (H - 2 * PY);
    const prim = ser[0].key;
    const lines = ser.map(s => ({ ...s, d: pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(' ') }));
    const baseY = (H - PY).toFixed(1);
    const area = `${pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[prim]).toFixed(1)}`).join(' ')} L${x(pts.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
    const idxByDate = new Map();
    pts.forEach((p, i) => p.date && idxByDate.set(p.date, i));
    const notes = [];
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
    return { pts, x, y, lo, hi, len: pts.length, lines, area, prim, idxByDate, notes, dd, primColor: ser[0].color, zeroY: lo <= 0 && hi >= 0 ? y(0) : null };
  }

  function toggle(key) {
    const on = Object.keys(sel).filter(k => sel[k]);
    if (sel[key] && on.length === 1) return; // keep at least one
    sel[key] = !sel[key];
  }

  function idxFromEvent(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * W;
    return Math.max(1, Math.min(view.len - 1, Math.round(((vbx - PX) / (W - 2 * PX)) * (view.len - 1))));
  }
  const move = e => (cursor = idxFromEvent(e));
  const pick = () => {
    if (cursor != null && view.pts[cursor].date) onselect(view.pts[cursor].date);
  };
  function onkeydown(e) {
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
        <button type="button" class:on={sel[s.key]} aria-pressed={sel[s.key]} style="--sw:{s.color}" onclick={() => toggle(s.key)}>{s.label}</button>
      {/each}
    </div>
  {/snippet}

  {#if view}
    <svg
      class="equity"
      viewBox="0 0 {W} {H}"
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
      <path d={view.area} fill="url(#eqfill)" />
      {#if grossOnly && view.dd}<rect class="ddband" x={view.dd.x0} y={PY} width={Math.max(0, view.dd.x1 - view.dd.x0)} height={H - 2 * PY} />{/if}
      {#if view.zeroY != null}<line class="zero" x1={PX} y1={view.zeroY} x2={W - PX} y2={view.zeroY} vector-effect="non-scaling-stroke" />{/if}
      {#if selIdx != null}<line class="sel" x1={view.x(selIdx)} y1={PY} x2={view.x(selIdx)} y2={H - PY} vector-effect="non-scaling-stroke" />{/if}
      {#each view.lines as ln (ln.key)}
        <path class="line" d={ln.d} fill="none" stroke={ln.color} vector-effect="non-scaling-stroke" />
      {/each}
      {#each view.notes as nd (nd.date)}
        <circle class="notedot" cx={nd.x} cy={nd.y} r="3" vector-effect="non-scaling-stroke" />
      {/each}
      {#if cursor != null}
        <line class="cursor" x1={view.x(cursor)} y1={PY} x2={view.x(cursor)} y2={H - PY} vector-effect="non-scaling-stroke" />
        <circle class="dot" cx={view.x(cursor)} cy={view.y(view.pts[cursor][view.prim])} r="3.5" vector-effect="non-scaling-stroke" />
      {/if}
    </svg>
    <div class="axis">
      <span>{money(view.lo)}</span>
      <span class="tip" aria-live="polite">{tip || 'cumulative P&L'}</span>
      <span>{money(view.hi)}</span>
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
  .line {
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .zero {
    stroke: var(--line);
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
  .notedot {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 1.5;
  }
  .axis {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--faint);
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
