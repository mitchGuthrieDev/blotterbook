/* Blotterbook app · widgets — activity terminal, session-status pill, and save/load/revert
   workspace templates, plus the subscriptions that turn shared app events into terminal log
   lines. Promoted from the staging sandbox to every surface (CH16) — loaded on app, demo, and
   staging. Loaded AFTER datamanager.js and BEFORE main.js, so its event subscriptions are
   registered before boot() emits app:ready. */

import { esc, versionsReady } from '../assets/util.js';
import { Store } from './store.js';
import { STAGING_PAGE, PAGE_MODE, $, on, onEvent, usd, cls, minMax, DOW_LABEL, dowBuckets, costModel } from './core.js';
import { activeMetrics, renderCurve } from './render.js';
import { saveOrder, saveCollapsed, modalOpened, modalClosed, LS_ORDER, LS_COLLAPSE } from './ui.js';
import { state } from './state.js';

// Workspace templates also live in per-origin localStorage — namespace staging so its templates
// stay separate from prod/demo (matches LS_ORDER/LS_COLLAPSE in ui.js). STAGING_PAGE is in core.js.
export const WS_KEY = 'tj_ws_templates' + (STAGING_PAGE ? '_staging' : '');
// A12: must stay in sync with the data-key panel order in partials/app-dash.html
// (used by the "— Default —" workspace reset to restore the original arrangement).
export const DEFAULT_DASH_ORDER = ['perf', 'cal', 'cost', 'adv', 'defs', 'term'];
export const TERM_MAX_LINES = 200; // ring-buffer cap for the activity terminal

export function logAction(msg, kind) {
  const win = document.getElementById('termwin');
  if (!win) return;
  const line = document.createElement('div');
  line.className = 'tl' + (kind ? ' evt-' + kind : '');
  const ts = document.createElement('span');
  ts.className = 'ts';
  ts.textContent = new Date().toTimeString().slice(0, 8) + '  ';
  const tm = document.createElement('span');
  tm.className = 'tm';
  tm.textContent = msg;
  line.appendChild(ts);
  line.appendChild(tm);
  win.insertBefore(line, win.firstChild); // newest on top (F12)
  while (win.children.length > TERM_MAX_LINES) win.removeChild(win.lastChild); // trim oldest (now last)
  win.scrollTop = 0; // keep the newest line in view
}
// 'degraded' is reserved/forward-looking — no caller sets it yet (the pill is honest flair,
// per the popup copy); only 'online'/'offline' fire today from the connectivity listeners.
export function setSession(state) {
  // 'online' | 'offline' | 'degraded'
  const pill = document.getElementById('sesspill');
  if (!pill) return;
  pill.classList.remove('online', 'offline', 'degraded');
  pill.classList.add(state);
  const txt = pill.querySelector('.sesstxt');
  if (txt) txt.textContent = { online: 'Online', offline: 'Offline', degraded: 'Degraded' }[state] || 'Session';
}
export function currentWorkspace() {
  const order = [...document.querySelectorAll('#dash .panel')].map(p => p.dataset.key);
  const collapsed = {};
  document.querySelectorAll('#dash .panel.collapsed').forEach(p => (collapsed[p.dataset.key] = 1));
  return { order, collapsed };
}
export function applyWorkspace(tpl) {
  const dash = document.getElementById('dash');
  if (!dash || !tpl) return;
  (tpl.order || DEFAULT_DASH_ORDER).forEach(k => {
    const el = dash.querySelector(`.panel[data-key="${k}"]`);
    if (el) dash.appendChild(el);
  });
  const col = tpl.collapsed || {};
  dash.querySelectorAll('.panel').forEach(p => p.classList.toggle('collapsed', !!col[p.dataset.key]));
  saveOrder();
  saveCollapsed(); // (shared, in ui.js)
  if (state.METRICS_ALL) renderCurve(activeMetrics());
}
export function readWsTemplates() {
  return Store.local.get(WS_KEY, {}) || {};
} // A13: via the Store.local seam
export function writeWsTemplates(o) {
  Store.local.set(WS_KEY, o);
}
export function refreshWsSelect(sel) {
  const el = document.getElementById('ws_tpl');
  if (!el) return;
  const tpls = readWsTemplates();
  el.innerHTML =
    '<option value="">— Default —</option>' +
    Object.keys(tpls)
      .map(n => `<option value="${esc(n)}">${esc(n)}</option>`)
      .join('');
  if (sel) el.value = sel;
}
export function initWidgets() {
  // session pill: state follows connectivity; click toggles the legend popup
  setSession(navigator.onLine === false ? 'offline' : 'online');
  window.addEventListener('online', () => {
    setSession('online');
    logAction('Connection restored');
  });
  window.addEventListener('offline', () => {
    setSession('offline');
    logAction('Connection lost — working offline', 'warn');
  });
  const pill = document.getElementById('sesspill'),
    pop = document.getElementById('sesspop');
  if (pill && pop) {
    pill.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = pop.hasAttribute('hidden');
      pop.toggleAttribute('hidden', !willOpen);
      pill.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    document.addEventListener('click', e => {
      if (!pop.hasAttribute('hidden') && !pill.contains(e.target) && !pop.contains(e.target)) {
        pop.setAttribute('hidden', '');
        pill.setAttribute('aria-expanded', 'false');
      }
    });
  }
  // workspace templates
  refreshWsSelect();
  // B23: the demo is a 1:1 mirror with data-mutating actions disabled. "Save layout" persists
  // templates to localStorage, so disable it in demo (loading a template / "— Default —" still work,
  // they don't write anything new).
  if (PAGE_MODE === 'demo') {
    const ws = $('ws_save');
    if (ws) {
      ws.disabled = true;
      ws.title = 'Saving layouts is disabled in the demo.';
    }
  }
  on('ws_save', 'click', () => {
    if (PAGE_MODE === 'demo') return;
    const name = (prompt('Name this workspace layout:') || '').trim();
    if (!name) return;
    const t = readWsTemplates();
    t[name] = currentWorkspace();
    writeWsTemplates(t);
    refreshWsSelect(name);
    logAction('Workspace template saved · ' + name);
  });
  on('ws_tpl', 'change', e => {
    const n = e.target.value;
    if (!n) {
      // "— Default —" → drop saved layout and reset to the default arrangement
      Store.local.remove(LS_ORDER);
      Store.local.remove(LS_COLLAPSE);
      applyWorkspace({ order: DEFAULT_DASH_ORDER, collapsed: {} });
      logAction('Layout reverted to default');
      return;
    }
    const t = readWsTemplates()[n];
    if (t) {
      applyWorkspace(t);
      logAction('Workspace template loaded · ' + n);
    }
  });
  // redraw the performance graph on resize so it re-measures its (grid) width
  let _rsz = null;
  window.addEventListener('resize', () => {
    clearTimeout(_rsz);
    _rsz = setTimeout(() => {
      if (state.METRICS_ALL) renderCurve(activeMetrics());
    }, 160);
  });
  // F14 (promoted to all surfaces, CH16): headline stat cards open read-only metric-detail modals
  // (delegated — cards re-render each pass). Active on app + demo + staging now that the cards carry
  // data-card and #cardModal ships on every page.
  const cardsEl = document.getElementById('cards');
  if (cardsEl) {
    cardsEl.addEventListener('click', e => {
      const c = e.target.closest('.card[data-card]');
      if (c) openCardModal(c.dataset.card);
    });
    cardsEl.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const c = e.target.closest('.card[data-card]');
      if (c) {
        e.preventDefault();
        openCardModal(c.dataset.card);
      }
    });
  }
  const cmEl = document.getElementById('cardModal');
  if (cmEl) {
    on('cm_close', 'click', closeCardModal);
    cmEl.addEventListener('click', e => {
      if (e.target === cmEl) closeCardModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && cmEl.classList.contains('open')) closeCardModal();
    });
  }
  // Read the version from the page badge rather than hardcoding it (single source — CH8).
  // Wait for the runtime version fetch to populate the badge first (CH12) so the log line
  // shows the live version, not the baked offline fallback.
  Promise.resolve(versionsReady).then(() => {
    const ver = (document.querySelector('.ver') || {}).textContent || '';
    logAction('Session ready' + (ver ? ' · ' + ver.trim() : ''));
  });
}

/* ============================================================
   F14 (staging) — stat-card metric-detail modals. Each headline card opens a reusable
   #cardModal populated with a metric-specific breakdown + a focused inline-SVG chart.
   All data comes from the active metrics object (compute()); no new persistence.
   ============================================================ */
export function cmColor(x) {
  return x > 0 ? 'var(--green)' : x < 0 ? 'var(--red)' : 'var(--accent)';
}
export function cmStats(pairs) {
  return (
    '<div class="cm-stats">' +
    pairs.map(([l, v, cl]) => `<div class="cm-stat"><div class="cl">${esc(l)}</div><div class="cv ${cl || ''}">${v}</div></div>`).join('') +
    '</div>'
  );
}
export function cmChart(title, inner) {
  return `<div class="cmchart"><h4>${esc(title)}</h4>${inner}</div>`;
}
export function cmBars(rows) {
  // rows: {label, value, color?, display?}
  const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));
  return (
    '<div class="cmbars">' +
    rows
      .map(r => {
        const w = Math.round((100 * Math.abs(r.value)) / max),
          col = r.color || cmColor(r.value);
        return (
          `<div class="cmbar"><span class="cmbl">${esc(r.label)}</span>` +
          `<span class="cmbt"><span class="cmbf" data-w="${w}" data-c="${col}"></span></span>` +
          `<span class="cmbv">${r.display != null ? r.display : usd(r.value)}</span></div>`
        );
      })
      .join('') +
    '</div>'
  );
}
export function cmSplit(segs) {
  // proportional stacked bar; segs: {value,color,label}
  const tot = Math.max(
    1,
    segs.reduce((a, s) => a + s.value, 0)
  );
  return (
    '<div class="cmsplit">' +
    segs
      .filter(s => s.value > 0)
      .map(
        s =>
          `<span class="cmseg" data-w="${((100 * s.value) / tot).toFixed(2)}" data-c="${s.color}" title="${esc(s.label)}: ${s.value}">${s.value}</span>`
      )
      .join('') +
    '</div>'
  );
}
export function cmCurve(curve, marks) {
  const W = 620,
    H = 150,
    pad = 8;
  if (!curve || curve.length < 2) return '<svg class="cmcurve" viewBox="0 0 ' + W + ' ' + H + '"></svg>';
  const mm = minMax(curve),
    lo = mm.lo,
    hi = mm.hi,
    span = hi - lo || 1; // running min/max, no arg-spread (B27)
  const x = i => pad + ((W - 2 * pad) * i) / (curve.length - 1),
    y = v => H - pad - ((H - 2 * pad) * (v - lo)) / span;
  const d = curve.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const zero =
    lo < 0 && hi > 0
      ? `<line x1="${pad}" y1="${y(0).toFixed(1)}" x2="${W - pad}" y2="${y(0).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 3"/>`
      : '';
  let mk = '';
  if (marks) {
    if (marks.peakIdx != null)
      mk += `<circle cx="${x(marks.peakIdx).toFixed(1)}" cy="${y(curve[marks.peakIdx]).toFixed(1)}" r="4" fill="var(--green)"/>`;
    if (marks.troughIdx != null)
      mk += `<circle cx="${x(marks.troughIdx).toFixed(1)}" cy="${y(curve[marks.troughIdx]).toFixed(1)}" r="4" fill="var(--red)"/>`;
  }
  return (
    `<svg class="cmcurve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${zero}` +
    `<path d="${d}" fill="none" stroke="${cmColor(curve[curve.length - 1])}" stroke-width="2"/>${mk}</svg>`
  );
}
export function cmHist(values, color) {
  const W = 620,
    H = 120,
    pad = 8,
    bins = 14;
  if (!values.length) return '<svg class="cmhist" viewBox="0 0 ' + W + ' ' + H + '"></svg>';
  const mm = minMax(values),
    lo = mm.lo,
    hi = mm.hi,
    span = hi - lo || 1; // running min/max, no arg-spread (B27)
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    let b = Math.floor((bins * (v - lo)) / span);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const mx = Math.max(...counts) || 1,
    bw = (W - 2 * pad) / bins;
  const bars = counts
    .map((ct, i) => {
      const h = ((H - 2 * pad) * ct) / mx;
      return `<rect x="${(pad + i * bw).toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"/>`;
    })
    .join('');
  return `<svg class="cmhist" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>`;
}
export function cmDow(trades) {
  // CH23: shared dowBuckets() + DOW_LABEL from core
  return dowBuckets(trades)
    .map((x, i) => ({ label: DOW_LABEL[i] + ' (' + x.n + ')', value: x.pnl, n: x.n }))
    .filter(x => x.n);
}
export function cmSymPf(trades) {
  const map = new Map();
  for (const t of trades) {
    const r = t.root || '?';
    if (!map.has(r)) map.set(r, { gp: 0, gl: 0, n: 0 });
    const o = map.get(r);
    o.n++;
    if (t.pnl > 0) o.gp += t.pnl;
    else o.gl += t.pnl;
  }
  const rows = [...map.entries()]
    .map(([r, o]) => ({ root: r, n: o.n, pf: o.gl !== 0 ? o.gp / Math.abs(o.gl) : Infinity, net: o.gp + o.gl }))
    .sort((a, b) => b.net - a.net);
  return (
    '<table class="cmtab"><thead><tr><th>Symbol</th><th>Trades</th><th>PF (gross)</th><th>Net</th></tr></thead><tbody>' +
    rows
      .map(
        r =>
          `<tr><td>${esc(r.root)}</td><td>${r.n}</td><td>${r.pf === Infinity ? '∞' : r.pf.toFixed(2)}</td><td class="${cls(r.net)}">${usd(r.net)}</td></tr>`
      )
      .join('') +
    '</tbody></table>'
  );
}
export const CARD_VIEWS = {
  net: (m, c) => ({
    title: 'Net PnL',
    sub: `${m.n} trades`,
    html:
      cmStats([
        ['Gross', usd(m.net), cls(m.net)],
        ['Net (pre-tax)', usd(c.netPreTax), cls(c.netPreTax)],
        ['Take-home', usd(c.afterTax), cls(c.afterTax)],
      ]) +
      cmChart('Cumulative PnL (gross)', cmCurve(m.curve)) +
      cmChart(
        'Gross → net → take-home',
        cmBars([
          { label: 'Gross', value: m.net },
          { label: '− Commissions', value: -c.totalComm },
          { label: '− Subscriptions', value: -c.fixedPeriod },
          { label: 'Net (pre-tax)', value: c.netPreTax },
          { label: '− 1256 tax', value: -c.tax },
          { label: 'Take-home', value: c.afterTax },
        ])
      ),
  }),
  win: m => ({
    title: 'Win Rate',
    sub: `${m.winRate.toFixed(1)}% · ${m.n} trades`,
    html:
      cmSplit([
        { value: m.wins, color: 'var(--green)', label: 'Wins' },
        { value: m.losses, color: 'var(--red)', label: 'Losses' },
        { value: m.scratch, color: 'var(--faint)', label: 'Break-even' },
      ]) +
      cmStats([
        ['Wins', m.wins],
        ['Losses', m.losses],
        ['Break-even', m.scratch],
      ]) +
      cmChart('PnL by weekday', cmBars(cmDow(m.trades))) +
      cmChart(
        'Long vs short (net PnL)',
        cmBars([
          { label: `Long (${m.long.n})`, value: m.long.pnl },
          { label: `Short (${m.short.n})`, value: m.short.pnl },
        ])
      ),
  }),
  pf: (m, c) => ({
    title: 'Profit Factor',
    sub: `${c.pf === Infinity ? '∞' : c.pf.toFixed(2)} · gross profit ÷ gross loss (net of commissions)`,
    html:
      cmChart(
        'Gross profit vs gross loss',
        cmBars([
          { label: 'Gross profit', value: c.pfGP, color: 'var(--green)' },
          { label: 'Gross loss', value: c.pfGL, color: 'var(--red)' },
        ])
      ) + cmChart('By symbol', cmSymPf(m.trades)),
  }),
  wl: m => ({
    title: 'Avg Win / Loss',
    sub: `ratio ${m.wl === Infinity ? '∞' : m.wl.toFixed(2)}`,
    html:
      cmStats([
        ['Avg win', usd(m.avgW), 'pos'],
        ['Avg loss', usd(m.avgL), 'neg'],
        ['Ratio', m.wl === Infinity ? '∞' : m.wl.toFixed(2)],
      ]) +
      cmChart(
        'Win distribution',
        cmHist(
          m.pnls.filter(p => p > 0),
          'var(--green)'
        )
      ) +
      cmChart(
        'Loss distribution (absolute)',
        cmHist(
          m.pnls.filter(p => p < 0).map(p => -p),
          'var(--red)'
        )
      ),
  }),
  dd: m => ({
    title: 'Max Drawdown',
    sub: `${usd(-m.maxDD)} · realized, closed-trade`,
    html:
      cmStats([
        ['Max drawdown', usd(-m.maxDD), 'neg'],
        ['Recovery factor', m.recovery === Infinity ? '∞' : isNaN(m.recovery) ? '—' : m.recovery.toFixed(2)],
        ['Net PnL', usd(m.net), cls(m.net)],
      ]) + cmChart('Equity curve · peak → trough', cmCurve(m.curve, { peakIdx: m.ddPeakIdx, troughIdx: m.ddTroughIdx })),
  }),
};
export function openCardModal(key) {
  const ov = document.getElementById('cardModal');
  if (!ov) return;
  const m = state.METRICS_ALL ? activeMetrics() : state.METRICS_ALL;
  if (!m || !m.n) return;
  const view = CARD_VIEWS[key];
  if (!view) return;
  const v = view(m, costModel(m));
  document.getElementById('cm_title').textContent = v.title;
  document.getElementById('cm_sub').textContent = v.sub || '';
  const body = document.getElementById('cm_body');
  body.innerHTML = v.html;
  // A21: feed data-driven bar width/colour via custom properties (CSSOM), not inline style=
  body.querySelectorAll('[data-w]').forEach(el => {
    el.style.setProperty('--w', el.dataset.w + '%');
    if (el.dataset.c) el.style.setProperty('--c', el.dataset.c);
  });
  ov.classList.add('open');
  modalOpened(ov); // B36: scroll lock handled here
  logAction('Opened ' + v.title + ' details');
}
export function closeCardModal() {
  const ov = document.getElementById('cardModal');
  if (!ov || !ov.classList.contains('open')) return;
  ov.classList.remove('open');
  modalClosed(ov);
}

/* Subscribe to shared app-action events → terminal log lines (all surfaces, CH16). */
onEvent('app:ready', initWidgets);
onEvent('data:loaded', d => logAction('Loaded · ' + ((d && d.name) || 'data') + ' · ' + (d && d.count) + ' trades')); // B20: initial dataset (demo sample / restored)
onEvent('data:imported', d => logAction('CSV imported · ' + ((d && d.name) || 'file') + ' · now ' + (d && d.count) + ' trades'));
onEvent('note:saved', d => logAction('Day note saved · ' + (d && d.date)));
onEvent('trade:deleted', d => logAction('Trade deleted · ' + (d && d.id), 'warn'));
onEvent('backup:created', () => logAction('Session backup created'));
onEvent('data:erased', () => logAction('All local data erased', 'err'));
