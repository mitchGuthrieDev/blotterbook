'use strict';
import { esc } from '../assets/util.js';
import { Store } from './store.js';
import { dailySeries as computeDailySeries } from './curveseries.js';
import {
  SVGNS,
  pad2,
  fmtDate,
  minMax,
  $,
  DOW_LABEL,
  usd,
  money,
  cls,
  compute,
  costModel,
  curBroker,
  rateFor,
  feedName,
  stateRate,
  BROKERS,
  sessionOf,
  isoWeek,
} from './core.js';
import { selectFromGraph, renderDayTrades, syncFilterOptions, updateJournalEditor, cancelDaySave } from './data.js';
import { state } from './state.js';
/* Blotterbook app · render — dashboard rendering (cards, equity curve, calendar, advanced stats, break-even) + the scope/filter/render driver
   Migrated to native ES modules (A20): explicit imports replace the former shared global scope. */

/* ============================================================
   Rendering — cards
   ============================================================ */
export function renderCards(m, c = costModel(m)) {
  // c may be passed in to avoid recomputing per render (CH11)
  // F14 (promoted to all surfaces, CH16): the five headline cards open read-only metric-detail
  // modals. Keyboard-operable buttons on app + demo + staging (the modal is read-only, so demo
  // mirrors it with no lock-down).
  const co = (key, label) =>
    `<div class="card clickable" role="button" tabindex="0" data-card="${key}" aria-label="${label} — open details">`;
  document.getElementById('cards').innerHTML = `
   ${co('net', 'Net PnL')}<div class="k">Net PnL</div>
     <div class="v ${cls(c.netPreTax)}">${usd(c.netPreTax)}</div>
     <div class="sub">${m.n} trades · gross ${usd(m.net)}</div>
     <div class="sub">take-home ${usd(c.afterTax)} · after 1256 tax</div></div>
   ${co('win', 'Win Rate')}<div class="k">Win Rate</div>
     <div class="v">${m.winRate.toFixed(1)}%</div>
     <div class="sub">${m.wins} W / ${m.losses} L${m.scratch ? ` / ${m.scratch} BE` : ''}</div></div>
   ${co('pf', 'Profit Factor')}<div class="k">Profit Factor</div>
     <div class="v ${c.pf >= 1 ? 'pos' : 'neg'}">${c.pf === Infinity ? '∞' : c.pf.toFixed(2)}</div>
     <div class="sub">${usd(c.pfGP)} / ${usd(Math.abs(c.pfGL), false)} · net of comm</div></div>
   ${co('wl', 'Avg Win/Loss')}<div class="k">Avg Win/Loss</div>
     <div class="v">${m.wl === Infinity ? '∞' : m.wl.toFixed(2)}</div>
     <div class="sub"><span class="pos">${usd(m.avgW)}</span> / <span class="neg">${usd(m.avgL)}</span></div></div>
   ${co('dd', 'Max Drawdown')}<div class="k">Max Drawdown</div>
     <div class="v neg">${usd(-m.maxDD)}</div>
     <div class="sub">realized, closed-trade</div></div>`;
}

/* ============================================================
   Rendering — performance graph (date-based, overlays, hover, click marker)
   ============================================================ */
export const curveSel = { gross: true, net: false, take: false };

export function dateRange(m) {
  if (state.SCOPE === 'month') return [new Date(state.calYear, state.calMonth, 1), new Date(state.calYear, state.calMonth + 1, 0)];
  if (!m || m.firstDate === '—') {
    const t = new Date();
    return [t, t];
  }
  return [new Date(m.firstDate + 'T00:00:00'), new Date(m.lastDate + 'T00:00:00')];
}
// A32: the per-day gross/net/take math moved to the pure curveseries.js (shared with the Svelte
// curve). This wrapper feeds it the live DOM-derived setup so vanilla behavior is unchanged.
export function dailySeries(m, c = costModel(m)) {
  const { pts } = computeDailySeries(m, { broker: curBroker(), tEff: c.tEff, fixedMo: c.fixedMo });
  return { pts, subs: c.fixedPeriod, tEff: c.tEff };
}
/* "nice" axis ticks spanning [min,max] with ~count steps, always including 0. */
export function niceTicks(min, max, count) {
  const span = max - min || 1;
  const rawStep = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step,
    hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}
/* compact money for axis labels: $1.2k / $850 / -$3.4k */
export function axMoney(v) {
  const a = Math.abs(v),
    s = v < 0 ? '-' : '';
  if (a >= 1000) return s + '$' + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
  return s + '$' + Math.round(a);
}

export function renderCurve(m, c = costModel(m)) {
  const svg = document.getElementById('curve'),
    tip = document.getElementById('curvetip');
  // Draw at the SVG's real pixel width (viewBox = pixel width) so labels aren't horizontally
  // stretched on a wide grid column (promoted from staging, CH16).
  const W = Math.max(600, Math.round(svg.getBoundingClientRect().width || 1000));
  const H = 260,
    padL = 62,
    padR = 20,
    padT = 18,
    padB = 46;
  if (!m || !m.n) {
    svg.innerHTML = '';
    if (tip) tip.style.display = 'none';
    return;
  }

  const [rd0, rd1] = dateRange(m);
  const d0ms = rd0.getTime(),
    d1ms = Math.max(rd1.getTime(), d0ms + 864e5);
  const { pts } = dailySeries(m, c);
  // Curve starts at the origin; subscriptions accrue month-by-month across pts (B8).
  const disp = [{ date: fmtDate(rd0), gross: 0, net: 0, take: 0 }, ...pts];

  const series = [];
  if (curveSel.gross) series.push({ key: 'gross', color: 'var(--green)', label: 'Gross' });
  if (curveSel.net) series.push({ key: 'net', color: 'var(--accent)', label: 'Net' });
  if (curveSel.take) series.push({ key: 'take', color: 'var(--take)', label: 'Take-home' });
  if (!series.length) series.push({ key: 'gross', color: 'var(--green)', label: 'Gross' }); // defensive

  let vals = [0];
  for (const p of disp) for (const s of series) vals.push(p[s.key]);
  const vmm = minMax(vals);
  let min = vmm.lo,
    max = vmm.hi;
  if (min === max) {
    min -= 1;
    max += 1;
  } // running min/max (B27)
  // expand the domain out to nice round tick bounds so the plot is framed cleanly
  const yticks = niceTicks(min, max, 5);
  min = Math.min(min, yticks[0]);
  max = Math.max(max, yticks[yticks.length - 1]);

  // linear scales mapping data → SVG pixels inside the padded plot box. yPx inverts
  // (1 - …) because SVG y grows downward, so a larger cumulative PnL sits higher up.
  const xMs = ms => padL + ((ms - d0ms) / (d1ms - d0ms)) * (W - padL - padR);
  const xOf = p => xMs(new Date(p.date + 'T00:00:00').getTime());
  const yPx = v => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);
  const zeroY = yPx(0);

  // horizontal gridlines + y labels
  let grid = yticks
    .map(v => {
      const y = yPx(v);
      return `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>
      <text x="${padL - 9}" y="${y + 3.5}" text-anchor="end">${axMoney(v)}</text>`;
    })
    .join('');
  // vertical gridlines + date labels (5 ticks across the range)
  const xticks = [0, 1, 2, 3, 4].map(i => d0ms + ((d1ms - d0ms) * i) / 4);
  grid += xticks
    .map((ms, i) => {
      const d = new Date(ms),
        x = xMs(ms);
      const vline = i > 0 && i < 4 ? `<line class="vgrid" x1="${x}" x2="${x}" y1="${padT}" y2="${H - padB}"/>` : '';
      return vline + `<text x="${x}" y="${H - padB + 16}" text-anchor="middle">${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}</text>`;
    })
    .join('');

  // gradient area fill under the primary (first) series
  const prim = series[0];
  const areaPts = disp.map(p => xOf(p) + ',' + yPx(p[prim.key])).join(' L ');
  const x0 = xOf(disp[0]),
    xN = xOf(disp[disp.length - 1]);
  const defs = `<defs><linearGradient id="cgrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${prim.color}" stop-opacity=".26"/>
      <stop offset="1" stop-color="${prim.color}" stop-opacity="0"/></linearGradient></defs>`;
  const area = `<path d="M${areaPts} L ${xN},${H - padB} L ${x0},${H - padB} Z" fill="url(#cgrad)"/>`;

  // drawdown band only when focused on gross alone (keeps multi-overlay views clean)
  let band = '';
  if (curveSel.gross && series.length === 1) {
    let peak = -Infinity;
    const top = [],
      bot = [];
    for (const p of disp) {
      peak = Math.max(peak, p.gross);
      top.push([xOf(p), yPx(peak)]);
      bot.push([xOf(p), yPx(p.gross)]);
    }
    band = `<path class="ddband" d="M${top.map(p => p.join(',')).join(' L ')} L ${bot
      .reverse()
      .map(p => p.join(','))
      .join(' L ')} Z"/>`;
  }
  const lines = series
    .map(
      s =>
        `<path d="M${disp.map(p => xOf(p) + ',' + yPx(p[s.key])).join(' L ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    )
    .join('');
  const endDots = series
    .map(s => {
      const last = disp[disp.length - 1];
      return `<circle cx="${xN}" cy="${yPx(last[s.key])}" r="3.2" fill="${s.color}"/>`;
    })
    .join('');
  const endLabels = series
    .map(s => {
      const last = disp[disp.length - 1];
      return `<text x="${W - padR}" y="${yPx(last[s.key]) - 7}" text-anchor="end" class="endlab" data-c="${s.color}" font-weight="600">${usd(last[s.key])}</text>`;
    })
    .join('');

  // selected-date marker
  let sel = '';
  if (state.selectedDate) {
    const sms = new Date(state.selectedDate + 'T00:00:00').getTime();
    if (sms >= d0ms && sms <= d1ms) {
      const x = xMs(sms);
      sel = `<line class="selmark" x1="${x}" x2="${x}" y1="${padT}" y2="${H - padB}"/>`;
      const sp = disp.find(p => p.date === state.selectedDate);
      if (sp) sel += series.map(s => `<circle cx="${x}" cy="${yPx(sp[s.key])}" r="3.5" fill="${s.color}"/>`).join('');
    }
  }
  // day-note indicators: a small blue dot on the curve at each date that has a note (CH16).
  // B37: precompute an exact date→point map (first occurrence wins, matching the old disp.find)
  // plus a date-ascending [ms,point] list, so placing N note dots is ~O(N log P) — exact match
  // is O(1) and the no-trade-day interpolation binary-searches the bracketing interval — instead
  // of the previous O(N×P) (a disp.find + a nested interpolation scan per note).
  let noteDots = '';
  if (state.JOURNAL_DATES && state.JOURNAL_DATES.size) {
    const ptByDate = new Map();
    for (const p of disp) if (!ptByDate.has(p.date)) ptByDate.set(p.date, p); // first match wins (the origin point for firstDate)
    const sorted = disp.map(p => ({ ms: new Date(p.date + 'T00:00:00').getTime(), p })); // disp is date-ascending
    const lastIx = sorted.length - 1;
    for (const nd of state.JOURNAL_DATES) {
      const t = new Date(nd + 'T00:00:00').getTime();
      if (t < d0ms || t > d1ms) continue;
      let val;
      const exact = ptByDate.get(nd);
      if (exact) {
        val = exact[prim.key];
      } else if (t <= sorted[0].ms) {
        val = sorted[0].p[prim.key];
      } else if (t >= sorted[lastIx].ms) {
        val = sorted[lastIx].p[prim.key];
      } else {
        // no trade that day → interpolate along the carried equity line between bracketing points
        let lo = 0,
          hi = lastIx;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (sorted[mid].ms <= t) lo = mid;
          else hi = mid;
        }
        const a = sorted[lo],
          b = sorted[hi];
        const f = (t - a.ms) / (b.ms - a.ms || 1);
        val = a.p[prim.key] + (b.p[prim.key] - a.p[prim.key]) * f;
      }
      noteDots += `<circle class="notedot" cx="${xMs(t)}" cy="${yPx(val || 0)}" r="3" fill="var(--accent)" stroke="var(--bg)" stroke-width="1"><title>Note · ${nd}</title></circle>`;
    }
  }
  // axis titles
  const axis = `<text class="axt" x="${padL + (W - padL - padR) / 2}" y="${H - 4}" text-anchor="middle">Date</text>
    <text class="axt" transform="rotate(-90)" x="${-(padT + (H - padB) / 2)}" y="15" text-anchor="middle">Cumulative PnL ($)</text>`;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML =
    defs +
    grid +
    area +
    band +
    `<line class="zero" x1="${padL}" x2="${W - padR}" y1="${zeroY}" y2="${zeroY}"/>` +
    lines +
    endDots +
    noteDots +
    endLabels +
    sel +
    axis;
  // A21: end-label colour via a custom property (CSSOM), not an inline style — and a class so it
  // beats the blanket `.curve text{fill:var(--dim)}` rule that a bare fill= attribute would lose to.
  svg.querySelectorAll('text.endlab').forEach(el => el.style.setProperty('--c', el.dataset.c));

  // hover guide
  const g = document.createElementNS(SVGNS, 'g');
  g.style.display = 'none';
  const gline = document.createElementNS(SVGNS, 'line');
  gline.setAttribute('class', 'cguide');
  g.appendChild(gline);
  const dots = series.map(s => {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('r', '3.5');
    c.setAttribute('fill', s.color);
    g.appendChild(c);
    return c;
  });
  svg.appendChild(g);

  // shared guide+tooltip painter, driven by either the mouse or the keyboard cursor (B10)
  function showGuideAt(best) {
    const x = xOf(best),
      r = svg.getBoundingClientRect();
    g.style.display = '';
    gline.setAttribute('x1', x);
    gline.setAttribute('x2', x);
    gline.setAttribute('y1', padT);
    gline.setAttribute('y2', H - padB);
    series.forEach((s, i) => {
      dots[i].setAttribute('cx', x);
      dots[i].setAttribute('cy', yPx(best[s.key]));
    });
    tip.style.display = 'block';
    tip.style.left = (x / W) * r.width + 'px';
    tip.style.top = '4px';
    tip.innerHTML =
      `<div class="td">${best.date}</div>` +
      series.map(s => `<div class="tr"><span class="sw" data-c="${s.color}"></span>${s.label} <b>${usd(best[s.key])}</b></div>`).join('');
    tip.querySelectorAll('.sw').forEach(el => el.style.setProperty('--c', el.dataset.c)); // A21: CSSOM, not inline style
  }
  const hideGuide = () => {
    g.style.display = 'none';
    tip.style.display = 'none';
  };
  const nearestTo = mx => {
    let best = disp[0],
      bd = 1e9;
    for (const p of disp) {
      const d = Math.abs(xOf(p) - mx);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  svg.onmousemove = ev => {
    const r = svg.getBoundingClientRect();
    const mx = ((ev.clientX - r.left) / r.width) * W;
    if (mx < padL - 2 || mx > W - padR + 2) {
      hideGuide();
      return;
    }
    showGuideAt(nearestTo(mx));
  };
  svg.onmouseleave = hideGuide;

  // click the graph → select that date and jump the calendar to its month
  svg.style.cursor = 'crosshair';
  svg.onclick = ev => {
    const r = svg.getBoundingClientRect();
    const mx = ((ev.clientX - r.left) / r.width) * W;
    if (mx < padL - 2 || mx > W - padR + 2) return;
    selectFromGraph(nearestTo(mx).date);
  };

  // keyboard parity (B10): focus the curve, arrow across dates, Enter/Space to mark one.
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'button');
  svg.setAttribute(
    'aria-label',
    'Equity curve. Use Left and Right arrows to move across dates and read each day’s value; press Enter to mark the focused date on the calendar.'
  );
  let kcur = disp.length - 1;
  svg.onkeydown = ev => {
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      kcur = Math.max(0, Math.min(disp.length - 1, kcur + (ev.key === 'ArrowRight' ? 1 : -1)));
      showGuideAt(disp[kcur]);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      kcur = 0;
      showGuideAt(disp[kcur]);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      kcur = disp.length - 1;
      showGuideAt(disp[kcur]);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      selectFromGraph(disp[kcur].date);
    }
  };
  svg.onfocus = () => {
    kcur = Math.max(0, Math.min(disp.length - 1, kcur));
    showGuideAt(disp[kcur]);
  };
  svg.onblur = hideGuide;
}

/* ============================================================
   Rendering — calendar (Sunday-first; click to mark on graph)
   ============================================================ */
export const MON = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export function renderCalendar() {
  const m = state.METRICS_ALL;
  if (!m) return;
  // Preserve keyboard focus across the wholesale innerHTML rebuild: if a day cell is focused,
  // remember its date and restore focus to the same cell afterwards (B10 follow-on, B15).
  const calEl = document.getElementById('cal'),
    ae = document.activeElement;
  const refocusDate = ae && calEl && calEl.contains(ae) && ae.dataset ? ae.dataset.date : null;
  const byDate = new Map(m.days.map(d => [d.date, d]));
  document.getElementById('mlabel').textContent = `${MON[state.calMonth]} ${state.calYear}`;
  let html =
    '<div class="dow wk">Week</div>' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('');
  const first = new Date(state.calYear, state.calMonth, 1);
  const offset = first.getDay(); // 0=Sun → Sunday-first grid
  let cur = new Date(state.calYear, state.calMonth, 1 - offset);
  for (let w = 0; w < 6; w++) {
    const weekCells = [];
    let weekPnl = 0,
      weekDays = 0,
      monthHit = false;
    for (let d = 0; d < 7; d++) {
      const y = cur.getFullYear(),
        mo = cur.getMonth(),
        da = cur.getDate();
      const key = `${y}-${pad2(mo + 1)}-${pad2(da)}`;
      const inMonth = mo === state.calMonth;
      if (inMonth) monthHit = true;
      const rec = byDate.get(key);
      const selc = key === state.selectedDate ? ' selday' : '';
      const note = state.JOURNAL_DATES.has(key) ? ' hasnote' : '';
      if (!inMonth) {
        weekCells.push(`<div class="cell off"></div>`);
      } else if (rec) {
        weekPnl += rec.pnl;
        weekDays++;
        const k = rec.pnl > 0 ? 'win' : rec.pnl < 0 ? 'loss' : '';
        const wr = rec.trades ? ((100 * rec.wins) / rec.trades).toFixed(0) : '0';
        const lbl = `${MON[mo]} ${da}: ${rec.trades} trade${rec.trades === 1 ? '' : 's'}, ${usd(rec.pnl)}`;
        weekCells.push(`<div class="cell ${k}${selc}${note}" data-date="${key}" tabindex="0" role="button" aria-label="${lbl}"><span class="dnum">${da}</span>
          <div class="pnl ${cls(rec.pnl)}">${usd(rec.pnl)}</div>
          <div class="meta">${rec.trades} tr · ${wr}%</div></div>`);
      } else {
        weekCells.push(
          `<div class="cell${selc}${note}" data-date="${key}" tabindex="0" role="button" aria-label="${MON[mo]} ${da}: no trades"><span class="dnum">${da}</span></div>`
        );
      }
      cur.setDate(cur.getDate() + 1);
    }
    if (w > 0 && !monthHit) break;
    const weekNo = isoWeek(new Date(cur.getTime() - 4 * 864e5)); // Wednesday of this row
    html +=
      `<div class="cell wkcell"><div class="wl">Wk ${weekNo}</div>
        <div class="wp ${cls(weekPnl)}">${weekDays ? usd(weekPnl) : '$0.00'}</div>
        <div class="wd">${weekDays} day${weekDays === 1 ? '' : 's'}</div></div>` + weekCells.join('');
  }
  calEl.innerHTML = html;
  if (refocusDate) {
    const c = calEl.querySelector(`.cell[data-date="${refocusDate}"]`);
    if (c) c.focus();
  }
  // F11: keep the notes box hidden unless a day is selected (without touching its text).
  const journal = document.getElementById('journal');
  if (journal) journal.style.display = state.selectedDate ? '' : 'none';
}

/* ============================================================
   Rendering — advanced statistics
   ============================================================ */
export function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 90) return s + 's';
  const mn = Math.round(s / 60);
  if (mn < 90) return mn + 'm';
  const h = Math.floor(mn / 60),
    rem = mn % 60;
  if (h < 24) return h + 'h' + (rem ? ' ' + rem + 'm' : '');
  const d = Math.floor(h / 24);
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}
export function renderAdv(m) {
  // hold time is only available for fills-based platform exports (round-trip matched)
  const held = (m.trades || []).filter(t => t.holdMs != null && t.holdMs > 0);
  const avgHold = held.length ? held.reduce((a, t) => a + t.holdMs, 0) / held.length : null;
  // payoff ratio (avgW / |avgL|) shares the wl figure computed in core; treat it as healthy at ≥1
  const payoff = m.wl === Infinity ? '∞' : isNaN(m.wl) ? '—' : m.wl.toFixed(2);
  const rows = [
    ['head', 'Performance Metrics'],
    ['Avg Daily PnL', `<span class="av ${cls(m.avgDaily)}">${usd(m.avgDaily)}</span>`],
    ['Best Trade', `<span class="av pos">${usd(m.best)}</span>`],
    ['Worst Trade', `<span class="av neg">${usd(m.worst)}</span>`],
    ['Winning Days', `<span class="av">${m.winDayPct.toFixed(1)}%</span>`],
    // F15: Max Drawdown as $, peak-relative %, and peak→trough span (was only on the curve / cards)
    [
      'Max Drawdown',
      m.maxDD > 0
        ? `<span class="av neg">${usd(-m.maxDD)}</span> <span class="av na">· ${m.maxDDpct.toFixed(1)}% · ${m.maxDDdur} trade${m.maxDDdur === 1 ? '' : 's'}</span>`
        : `<span class="av na">—</span>`,
    ],
    ['Sharpe (daily)', `<span class="av">${isNaN(m.sharpe) ? '—' : m.sharpe.toFixed(2)}</span>`],
    ['Sortino (daily)', `<span class="av">${isNaN(m.sortino) ? '—' : m.sortino.toFixed(2)}</span>`],
    ['head', 'Edge & Distribution'],
    ['Expectancy / Trade', `<span class="av ${cls(m.expectancy)}">${usd(m.expectancy)}</span>`],
    ['Avg Winner', `<span class="av pos">${usd(m.avgW)}</span>`],
    ['Avg Loser', `<span class="av neg">${usd(m.avgL)}</span>`],
    ['Payoff Ratio', `<span class="av ${m.wl === Infinity || m.wl >= 1 ? 'pos' : 'neg'}">${payoff}</span>`],
    ['Std Dev / Trade', `<span class="av">${usd(m.tStd, false)}</span>`],
    // F15: profit concentration — how much of net profit the top 5 winners carry (null = no net profit)
    [
      'Profit Concentration',
      m.concPct == null
        ? `<span class="av na">—</span>`
        : `<span class="av">${m.concPct.toFixed(0)}%</span> <span class="av na">· top 5</span>`,
    ],
    ['Long PnL', `<span class="av ${cls(m.long.pnl)}">${usd(m.long.pnl)}</span> <span class="av na">· ${m.long.n}</span>`],
    ['Short PnL', `<span class="av ${cls(m.short.pnl)}">${usd(m.short.pnl)}</span> <span class="av na">· ${m.short.n}</span>`],
    [
      'Best Day',
      m.bestDay
        ? `<span class="av pos">${usd(m.bestDay.pnl)}</span> <span class="av na">· ${m.bestDay.date}</span>`
        : `<span class="av na">—</span>`,
    ],
    [
      'Worst Day',
      m.worstDay
        ? `<span class="av neg">${usd(m.worstDay.pnl)}</span> <span class="av na">· ${m.worstDay.date}</span>`
        : `<span class="av na">—</span>`,
    ],
    // CH18: Best/Worst Weekday now rank by AVERAGE PnL per trade (· weekday · trade count), not total
    [
      'Best Weekday',
      m.bestDow
        ? `<span class="av ${cls(m.bestDow.avg)}">${usd(m.bestDow.avg)}</span> <span class="av na">· ${DOW_LABEL[m.bestDow.i]} · ${m.bestDow.n}</span>`
        : `<span class="av na">—</span>`,
    ],
    [
      'Worst Weekday',
      m.worstDow
        ? `<span class="av ${cls(m.worstDow.avg)}">${usd(m.worstDow.avg)}</span> <span class="av na">· ${DOW_LABEL[m.worstDow.i]} · ${m.worstDow.n}</span>`
        : `<span class="av na">—</span>`,
    ],
    ['head', 'Trading Patterns'],
    ['Active Days', `<span class="av">${m.active}</span>`],
    ['Avg Trades/Day', `<span class="av">${m.avgTrades.toFixed(1)}</span>`],
    [
      'Recovery Factor',
      `<span class="av ${cls(m.recovery)}">${m.recovery === Infinity ? '∞' : isNaN(m.recovery) ? '—' : m.recovery.toFixed(2)}</span>`,
    ],
    ['Max Consecutive Wins', `<span class="av pos">${m.mcw}</span>`],
    ['Max Consecutive Losses', `<span class="av neg">${m.mcl}</span>`],
    // F15: largest winning / losing streak by DOLLARS (the mcw/mcl above are trade counts)
    ['Largest Win Streak', `<span class="av pos">${usd(m.maxWinStk)}</span>`],
    ['Largest Loss Streak', `<span class="av neg">${usd(m.maxLossStk)}</span>`],
  ];
  if (avgHold != null) {
    rows.splice(rows.indexOf(rows.find(r => r[0] === 'Max Consecutive Losses')) + 1, 0, [
      'Avg Hold Time',
      `<span class="av">${fmtDur(avgHold)}</span> <span class="av na">· ${held.length}/${m.n}</span>`,
    ]);
  }
  // R5: wrap the value(s) in a single `.avg` group so every row has exactly two flex children
  // (label + value-group). Rows with a secondary value (e.g. "Long PnL … · 12") used to expose
  // three flex children, so space-between stranded the MAIN value in the middle of the row.
  document.getElementById('adv').innerHTML = rows
    .map(([a, b]) =>
      a === 'head' ? `<div class="subhead">${b}</div>` : `<div class="arow"><span class="al">${a}</span><span class="avg">${b}</span></div>`
    )
    .join('');
}

/* ============================================================
   Rendering — break-even / cost budget
   ============================================================ */
// Per-symbol commission rows + Total, single-sourced for the dashboard cost panel AND the export
// report so the two can't drift (CH23 — the report had lost the "Cts" column). `report` switches
// the report-style numeric cells (class="num") + plain "*" flag vs the dashboard's styled flag.
export function commSymRows(c, report) {
  const nc = report ? ' class="num"' : '';
  const flag = s => (s.known ? '' : report ? ' *' : ' <span class="flag">*</span>');
  const body = c.bySym
    .map(
      s =>
        `<tr><td>${esc(s.root)}${flag(s)}</td><td${nc}>${s.count}</td><td${nc}>${s.qty}</td>` +
        `<td${nc}>${money(s.rate)}</td><td${nc}>${money(s.rate * 2)}</td><td${nc}>${money(s.total)}</td></tr>`
    )
    .join('');
  const total =
    `<tr class="tot"><td>Total</td><td${nc}>${c.n}</td><td${nc}>${c.contracts}</td>` +
    `<td></td><td></td><td${nc}>${money(c.totalComm)}</td></tr>`;
  return body + total;
}
export function renderCalc(m, c = costModel(m)) {
  const tbl = document.getElementById('c_comm_table'),
    head = document.getElementById('c_head'),
    rowsEl = document.getElementById('c_rows'),
    cap = document.getElementById('c_cap');
  if (!m || !m.n) {
    tbl.innerHTML = '';
    head.innerHTML = '';
    rowsEl.innerHTML = '';
    cap.innerHTML = '';
    return;
  }
  const bePer = c.bePer;

  cap.innerHTML = `Broker: <b>${esc(BROKERS[c.broker].name)}</b> &nbsp;·&nbsp; Feed: ${esc(feedName())} &nbsp;·&nbsp; Platform $${esc(c.platform)}/mo`;

  const anyUnknown = c.bySym.some(s => !s.known);
  const commHtml =
    `<table class="commtab"><thead><tr><th>Symbol</th><th>Trades</th><th>Cts</th><th>$/side</th><th>$/RT</th><th>Commission</th></tr></thead>
     <tbody>${commSymRows(c, false)}</tbody></table>` +
    (anyUnknown
      ? `<div class="cnote"><span class="flag">*</span> No published exchange fee on file — priced with a fallback estimate. Add the symbol to <code>data/exchange-fees.json</code> for an exact figure.</div>`
      : '');
  // F6 (CH16): the per-symbol table lives in a collapsible subsection nested under the
  // "Commissions (all-in)" line below, so the standalone table here is empty.
  tbl.innerHTML = '';

  head.innerHTML = `<div class="k">Net P&L after costs &middot; ${scopeLabel()}</div>
     <div class="v ${cls(c.netPreTax)}">${money(c.netPreTax)}</div>
     <div class="sub">${c.n} trades &middot; ${c.months} month${c.months === 1 ? '' : 's'} of subscriptions &middot; gross ${money(c.gross)}</div>
     <div class="tax">After 1256 tax (${(c.tEff * 100).toFixed(1)}%): ${money(c.afterTax)} &nbsp;&middot;&nbsp; break-even ${money(bePer)}/trade</div>`;

  const row = (l, v, cl = '') => `<div class="crow ${cl}"><span class="cl">${l}</span><span class="cv">${v}</span></div>`;
  rowsEl.innerHTML =
    row('Gross P&L', `<span class="${cls(c.gross)}">${money(c.gross)}</span>`) +
    row('Commissions (all-in)', `<span class="neg">${money(-c.totalComm)}</span>`) +
    `<details class="csubtable"><summary>Per-symbol breakdown</summary><div class="csubbody">${commHtml}</div></details>` +
    row('Subscriptions (' + money(c.fixedMo) + '/mo &times; ' + c.months + ')', `<span class="neg">${money(-c.fixedPeriod)}</span>`) +
    row('Net P&L (pre-tax)', `<span class="${cls(c.netPreTax)}">${money(c.netPreTax)}</span>`, 'tot') +
    // 1256 tax (F10/CH16): one headline line with the total, the rate detail tucked into a
    // collapsible breakdown (like the per-symbol commissions above).
    row('Est. 1256 tax (net profit only)', `<span class="neg">${money(-c.tax)}</span>`) +
    `<details class="csubtable"><summary>Tax breakdown</summary><div class="csubbody">` +
    row('State top rate', stateRate().toFixed(2) + '%', 'sub') +
    row('Blended 1256 rate', (c.tEff * 100).toFixed(1) + '%', 'sub') +
    `</div></details>` +
    row('After-tax take-home', `<span class="${cls(c.afterTax)}">${money(c.afterTax)}</span>`, 'tot');
}

/* ============================================================
   Scope + filters + driver
   ============================================================ */
export const tradeKey = t => t.id || Store.tradeId(t);
export async function loadTradeMeta() {
  if (!Store.available()) {
    state.TRADE_META = new Map();
    return;
  }
  try {
    const all = await Store.allTradeMeta();
    state.TRADE_META = new Map(all.map(m => [m.id, m]));
  } catch (_) {
    state.TRADE_META = new Map();
  }
}

export const FILTERS = { from: '', to: '', symbol: '', side: '', session: '', tag: '', dows: new Set() };
export function filtersActive() {
  return !!(FILTERS.from || FILTERS.to || FILTERS.symbol || FILTERS.side || FILTERS.session || FILTERS.tag || FILTERS.dows.size);
}
export function applyFilters(arr) {
  return arr.filter(t => {
    if (FILTERS.from && t.date < FILTERS.from) return false;
    if (FILTERS.to && t.date > FILTERS.to) return false;
    if (FILTERS.symbol && t.root !== FILTERS.symbol) return false;
    if (FILTERS.side && t.side !== FILTERS.side) return false;
    if (FILTERS.session && sessionOf(t) !== FILTERS.session) return false;
    if (FILTERS.tag) {
      const m = state.TRADE_META.get(tradeKey(t));
      if (!m || !(m.tags || []).includes(FILTERS.tag)) return false;
    }
    if (FILTERS.dows.size && !FILTERS.dows.has(new Date(t.date + 'T00:00:00').getDay())) return false;
    return true;
  });
}
/* Filters apply to the WHOLE dashboard — the calendar, cards, cost, stats, and the performance
   graph all reflect the active filter bar + scope. */
export function baseTrades() {
  return applyFilters(state.TRADES);
}

export function scopeLabel() {
  return state.SCOPE === 'all' ? 'all time' : `${MON[state.calMonth]} ${state.calYear}`;
}
export function activeMetrics() {
  if (state.SCOPE === 'all') return state.METRICS_ALL;
  const mk = `${state.calYear}-${pad2(state.calMonth + 1)}`;
  return compute(baseTrades().filter(t => t.date.startsWith(mk)));
}
export function renderDash() {
  if (!state.METRICS_ALL) return;
  const m = activeMetrics(),
    c = costModel(m); // compute the cost model once, share it (CH11)
  renderCards(m, c);
  renderAdv(m);
  renderCalc(m, c);
  renderCurve(m, c);
  // F16: keep the selected day's intraday trades list in sync with the active filters/scope
  if (state.selectedDate) renderDayTrades(state.selectedDate);
  document.getElementById('scopenote').textContent =
    state.SCOPE === 'all' ? `all ${state.METRICS_ALL.n} trades` : `${MON[state.calMonth]} ${state.calYear}`;
}
export function setScope(s) {
  state.SCOPE = s;
  document.querySelectorAll('#scope button').forEach(b => {
    const on = b.dataset.s === s;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false'); // B41: AT state, in lockstep with .on
  });
  renderDash();
}
export function setDashVisible(v) {
  document.getElementById('dash').style.display = v ? '' : 'none';
  document.getElementById('scoperow').style.display = v ? '' : 'none';
  document.body.classList.toggle('loaded', v); // drives top-bar / setup visibility
  // Broker & Costs starts minimized on a populated dashboard; expanded on the landing.
  const setup = document.getElementById('setup');
  if (setup) setup.classList.toggle('collapsed', v);
}
/* The not-loaded view is the centered landing block (#landing) in the markup,
   shown via the body:not(.loaded) rule; the cards row stays empty until load. */
export function showEmpty() {
  const c = $('cards');
  if (c) c.innerHTML = '';
}
export function resetApp() {
  cancelDaySave(); // B28: kill any pending day-note autosave so it can't resurrect a cleared note
  state.TRADES = [];
  state.METRICS_ALL = null;
  state.selectedDate = null;
  const f = $('file');
  if (f) f.value = '';
  setDashVisible(false);
  $('srcmeta').innerHTML = '';
  $('srcname').textContent = 'no data loaded';
  updateJournalEditor();
  showEmpty();
}

/* Render whatever is in TRADES (already the full, merged set). */
export function renderLoaded(name, metaHtml) {
  if (!state.TRADES.length) {
    resetApp();
    return;
  }
  setDashVisible(true);
  state.selectedDate = null;
  state.METRICS_ALL = compute(baseTrades());
  if (name) document.getElementById('srcname').textContent = name;
  document.getElementById('srcmeta').innerHTML = metaHtml || '';
  const ld = state.METRICS_ALL.lastDate !== '—' ? state.METRICS_ALL.lastDate : fmtDate(new Date());
  const [yy, mm] = ld.split('-').map(Number);
  state.calYear = yy;
  state.calMonth = mm - 1;
  syncFilterOptions();
  updateJournalEditor();
  renderCalendar();
  renderDash();
}
