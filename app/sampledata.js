// @ts-check
'use strict';
/* Blotterbook · sample data — the deterministic two-year demo dataset, as a TradingView-format
   CSV string. Extracted from data.js (A27) into its own tiny module so BOTH the vanilla surfaces
   (via data.js, which re-exports it) AND the Svelte staging app can import it WITHOUT pulling in
   the DOM-coupled view layer (render.js/ui.js/datamanager.js). Depends only on core.js helpers.
   Pure: same seed → same output. */
import { pad2, fmtDate } from './core.js';

export function demoCSV() {
  let seed = 246813579;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const syms = ['MESM2025', 'MESM2025', 'MESM2025', 'MNQM2025', 'MNQM2025', 'MCLN2025'];
  const rows = [['Time', 'Action', 'Realized PnL (value)']];
  const start = new Date(2024, 6, 1),
    end = new Date(2026, 5, 30); // two years: Jul 1 2024 → Jun 30 2026
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // weekdays only
    if (rnd() < 0.15) continue; // a few days flat/off
    const nt = 2 + Math.floor(rnd() * 4); // 2–5 trades/day
    for (let i = 0; i < nt; i++) {
      const sym = syms[Math.floor(rnd() * syms.length)];
      const side = rnd() < 0.5 ? 'long' : 'short';
      const base = sym.startsWith('MNQ') ? 14 : sym.startsWith('MCL') ? 11 : 8;
      // positive expectancy: ~58% winners, winners larger than losers → a profitable month
      const win = rnd() < 0.58;
      let pnl = win ? base * (3 + rnd() * 20) : -base * (1.5 + rnd() * 9);
      pnl = Math.round(pnl * 4) / 4; // quarter-point ticks
      const hh = pad2(9 + Math.floor(rnd() * 6)),
        mm = pad2(Math.floor(rnd() * 60));
      const ts = `${fmtDate(d)} ${hh}:${mm}:00`;
      rows.push([ts, `"Close ${side} position for symbol ${sym} at price 100.00"`, String(pnl)]);
    }
  }
  return rows.map(r => r.join(',')).join('\n');
}
