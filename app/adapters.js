"use strict";
/* ============================================================
   Platform CSV adapters + format auto-detection
   ------------------------------------------------------------
   Parsing is keyed to the trading *platform* the CSV came from
   (TradingView, Tradovate, …) — NOT the broker. Every adapter
   normalizes its export into Blotterbook's internal trade shape:

       { time, date, pnl, symbol, root, side
         [, qty, entryTime, exitTime, holdMs] }

   so compute() / costModel() never change. Two export styles:
     • "closed"  — each row is a finished position w/ realized PnL
                   (TradingView, MotiveWave).
     • "fills"   — individual buy/sell executions; pairFills() runs
                   a FIFO round-trip matcher to build closed trades
                   (and finally unlocks hold time).

   Adapters for platforms we don't yet have real exports for are
   marked `beta:true` — built from documented formats + synthetic
   tests; verify against a real export before trusting the numbers.
   ============================================================ */
(function () {

  /* ---------- low-level CSV ---------- */
  // Quote-aware splitter; auto-detects comma vs tab (Sierra Chart uses tabs).
  function parseCSV(text, delim) {
    if (delim == null) {
      const firstLine = text.slice(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n'));
      delim = (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ',';
    }
    const rows = []; let i = 0, field = '', row = [], q = false; const n = text.length;
    const push = () => { row.push(field); field = ''; };
    const eol = () => { push(); if (row.some(c => c !== '')) rows.push(row); row = []; }; // drop all-empty lines
    while (i < n) { const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
      else { if (c === '"') q = true; else if (c === delim) push(); else if (c === '\n') eol(); else if (c === '\r') {} else field += c; }
      i++;
    }
    if (field !== '' || row.length) eol();
    return rows;
  }

  /* ---------- helpers ---------- */
  const pad2 = n => String(n).padStart(2, '0');

  // Futures root: MESM2025 → MES, M2KZ2025 → M2K, MES1! → MES, CME_MINI:ES1! → ES
  function rootSym(s) {
    if (!s) return '?';
    s = s.toUpperCase().trim().replace(/^.*:/, '').replace(/^\//, ''); // drop exchange prefix and thinkorswim "/" futures marker
    s = s.replace(/[FGHJKMNQUVXZ]\d{1,4}$/, '').replace(/\d*!$/, '');
    s = s.replace(/[^A-Z0-9._-]/g, ''); // restrict to a safe symbol charset so a crafted CSV symbol can't inject HTML downstream
    return s || '?';
  }

  // tolerant number: "$1,234.50" → 1234.5, "(123.45)" → -123.45
  function num(x) {
    if (x == null) return NaN;
    let s = String(x).trim();
    if (!s) return NaN;
    let neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()$,\s]/g, '');
    const v = parseFloat(s);
    return isNaN(v) ? NaN : (neg ? -v : v);
  }

  // Normalize any timestamp to canonical "YYYY-MM-DD HH:MM:SS".
  function normTime(s) {
    if (!s) return '';
    s = String(s).trim().replace(/^"|"$/g, '');
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])} ${pad2(m[4] || 0)}:${pad2(m[5] || 0)}:${pad2(m[6] || 0)}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    if (m) { let h = +(m[4] || 0); const ap = (m[7] || '').toUpperCase();
      if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
      const Y = m[3].length === 2 ? '20' + m[3] : m[3];
      // Default to US M/D/Y; if the first field can't be a month (>12) but the second can, treat as D/M/Y.
      let mo = +m[1], day = +m[2];
      if (mo > 12 && day <= 12) { const t = mo; mo = day; day = t; }
      return `${Y}-${pad2(mo)}-${pad2(day)} ${pad2(h)}:${pad2(m[5] || 0)}:${pad2(m[6] || 0)}`;
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return s;
  }
  const tms = iso => new Date(String(iso).replace(' ', 'T')).getTime();
  const round2 = v => Math.round(v * 100) / 100;
  const sideWord = s => { s = String(s).toLowerCase();
    if (/\b(buy|bot|bought|b|long)\b/.test(s)) return 'buy';
    if (/\b(sell|sld|sold|s|short)\b/.test(s)) return 'sell';
    return ''; };

  /* ---------- futures point values (for fills exports without realized PnL) ---------- */
  const POINT = {
    ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5, EMD: 100, NKD: 5,
    CL: 1000, MCL: 100, QM: 500, NG: 10000, QG: 2500, RB: 42000, HO: 42000, BZ: 1000,
    GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000, MHG: 2500, PL: 50, PA: 100,
    ZB: 1000, UB: 1000, ZN: 1000, TN: 1000, ZF: 1000, ZT: 2000, ZQ: 4167, GE: 2500,
    ZC: 50, ZS: 50, ZW: 50, ZL: 600, ZM: 100, ZO: 50, KE: 50, HE: 400, LE: 400, GF: 500,
    '6E': 125000, '6B': 62500, '6J': 12500000, '6A': 100000, '6C': 100000, '6S': 125000,
    '6M': 500000, '6N': 100000, M6E: 12500, M6A: 10000
  };
  function pointValue(root) { return POINT[root] != null ? POINT[root] : 1; }

  /* ---------- fills → closed round-trips (FIFO, handles flips & partials) ----------
     fills: [{ time, symbol, side:'buy'|'sell', qty>0, price[, realized][, commission] }]
     A closing fill realizes PnL against the oldest open lots. PnL uses the fill's
     own `realized` (apportioned by matched qty) when the export provides it, else
     (exitPrice − entryPrice) × qty × pointValue(root). Output carries hold time. */
  function pairFills(fills) {
    const bySym = new Map();
    for (const f of fills) {
      if (!f || !f.symbol || !f.side || !(f.qty > 0) || isNaN(f.price)) continue;
      if (!bySym.has(f.symbol)) bySym.set(f.symbol, []);
      bySym.get(f.symbol).push(f);
    }
    const trades = [];
    for (const [sym, arr] of bySym) {
      arr.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
      const root = rootSym(sym), pv = pointValue(root);
      const open = []; // FIFO lots: { dir:1|-1, qty, price, time }
      for (const f of arr) {
        const dir = f.side === 'buy' ? 1 : -1;
        let remaining = f.qty;
        // Portion of this fill that closes opposing lots (the rest opens a new lot on a flip).
        // Realized PnL is apportioned over this closed qty, NOT f.qty, so a flip fill's full
        // realized PnL is attributed to the closed contracts instead of diluted by the new lot.
        let closeQty = 0;
        for (const lot of open) if (lot.dir !== dir) closeQty += lot.qty;
        closeQty = Math.min(f.qty, closeQty);
        while (remaining > 0 && open.length && open[0].dir !== dir) {
          const lot = open[0];
          const m = Math.min(lot.qty, remaining);
          const long = lot.dir === 1;
          let pnl;
          if (f.realized != null && closeQty > 0) pnl = f.realized * (m / closeQty);
          else pnl = (f.price - lot.price) * m * pv * (long ? 1 : -1);
          trades.push({
            time: f.time, date: f.time.slice(0, 10), symbol: sym, root,
            side: long ? 'long' : 'short', qty: m, pnl: round2(pnl),
            entryTime: lot.time, exitTime: f.time, holdMs: Math.max(0, tms(f.time) - tms(lot.time))
          });
          lot.qty -= m; remaining -= m;
          if (lot.qty <= 1e-9) open.shift();
        }
        if (remaining > 1e-9) open.push({ dir, qty: remaining, price: f.price, time: f.time });
      }
    }
    trades.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
    return trades;
  }

  /* ---------- header utilities ---------- */
  const lc = a => a.map(h => String(h).trim().toLowerCase());
  const finder = head => name => head.findIndex(h => h.includes(name));
  const hasAll = (head, names) => names.every(n => head.some(h => h.includes(n)));
  const hasAny = (head, names) => names.some(n => head.some(h => h.includes(n)));
  // first row index whose lowercased cells contain every substring in `names`
  function headerRow(rows, names) {
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const h = lc(rows[i]); if (names.every(n => h.some(c => c.includes(n)))) return i;
    } return -1;
  }

  /* ============================================================
     Adapters
     ============================================================ */

  /* TradingView — "List of trades" / balance history (closed positions). */
  const tradingview = {
    id: 'tradingview', label: 'TradingView', kind: 'closed', beta: false,
    sniff(text, rows) { const h = lc(rows[0] || []);
      return (hasAny(h, ['action']) && hasAny(h, ['realized pnl'])) ? 5 : 0; },
    toTrades(text, rows) {
      const head = lc(rows[0]); const ix = finder(head);
      const cT = ix('time'),
            cP = ix('realized pnl (value)') >= 0 ? ix('realized pnl (value)') : ix('realized pnl'),
            cA = ix('action');
      if (cT < 0 || cP < 0) throw new Error('missing Time or Realized PnL column');
      const out = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[cT]) continue;
        const pnl = num(row[cP]); if (isNaN(pnl)) continue;
        const action = cA >= 0 ? row[cA] : '';
        const sm = action.match(/symbol\s+(\S+)\s+at price/i);
        const symbol = sm ? sm[1] : '';
        const side = /close short/i.test(action) ? 'short' : /close long/i.test(action) ? 'long' : '';
        out.push({ time: normTime(row[cT]), date: normTime(row[cT]).slice(0, 10), pnl, symbol, root: rootSym(symbol), side });
      }
      return out;
    }
  };

  /* MotiveWave — Trade Report (closed; entry+exit+P/L per row → native hold time). */
  const motivewave = {
    id: 'motivewave', label: 'MotiveWave', kind: 'closed', beta: true,
    sniff(text, rows) { const h = lc(rows[0] || []);
      return (hasAny(h, ['entry price', 'entry time']) && hasAny(h, ['exit price', 'exit time']) && hasAny(h, ['p/l', 'pnl', 'profit'])) ? 5 : 0; },
    toTrades(text, rows) {
      const head = lc(rows[0]); const ix = finder(head);
      const cSym = ix('instrument') >= 0 ? ix('instrument') : ix('symbol');
      const cEntryT = ix('entry time') >= 0 ? ix('entry time') : ix('entry date');
      const cExitT = ix('exit time') >= 0 ? ix('exit time') : ix('exit date');
      const cP = ix('p/l') >= 0 ? ix('p/l') : (ix('pnl') >= 0 ? ix('pnl') : ix('profit'));
      const cSide = ix('side') >= 0 ? ix('side') : ix('position');
      const cQty = ix('quantity') >= 0 ? ix('quantity') : ix('qty');
      if (cExitT < 0 || cP < 0) throw new Error('missing Exit Time or P/L column');
      const out = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[cExitT]) continue;
        const pnl = num(row[cP]); if (isNaN(pnl)) continue;
        const symbol = (cSym >= 0 ? row[cSym] : '') || '';
        const exit = normTime(row[cExitT]); const entry = cEntryT >= 0 ? normTime(row[cEntryT]) : '';
        const sd = cSide >= 0 ? sideWord(row[cSide]) : '';
        out.push({ time: exit, date: exit.slice(0, 10), pnl, symbol, root: rootSym(symbol),
          side: sd === 'sell' ? 'short' : sd === 'buy' ? 'long' : '',
          qty: cQty >= 0 ? Math.abs(num(row[cQty])) || 1 : 1,
          entryTime: entry || undefined, exitTime: exit,
          holdMs: entry ? Math.max(0, tms(exit) - tms(entry)) : undefined });
      }
      return out;
    }
  };

  /* Tradovate — Orders export (fills). */
  const tradovate = {
    id: 'tradovate', label: 'Tradovate', kind: 'fills', beta: true,
    sniff(text, rows) { const h = lc(rows[0] || []);
      return (hasAny(h, ['b/s']) && hasAny(h, ['contract', 'product']) && hasAny(h, ['fill time', 'avg fill price', 'filledqty', 'filled qty', 'avgprice'])) ? 4 : 0; },
    toTrades(text, rows) {
      const head = lc(rows[0]); const ix = finder(head);
      const cBS = ix('b/s'), cSym = ix('contract') >= 0 ? ix('contract') : ix('product');
      const cQty = ix('filled qty') >= 0 ? ix('filled qty') : ix('filledqty');
      const cPx = ix('avg fill price') >= 0 ? ix('avg fill price') : ix('avgprice');
      const cT = ix('fill time') >= 0 ? ix('fill time') : ix('timestamp');
      if (cBS < 0 || cSym < 0 || cPx < 0) throw new Error('missing B/S, Contract or price column');
      const fills = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[cBS]) continue;
        const side = sideWord(row[cBS]); const price = num(row[cPx]);
        const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
        if (!side || isNaN(price) || !(qty > 0)) continue;
        fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
      }
      return pairFills(fills);
    }
  };

  /* Rithmic R|Trader — Completed Orders (fills). */
  const rithmic = {
    id: 'rithmic', label: 'Rithmic R|Trader', kind: 'fills', beta: true,
    sniff(text, rows) { const h = lc(rows[0] || []);
      return (hasAny(h, ['buy/sell']) && hasAny(h, ['symbol']) && hasAny(h, ['qty filled', 'avg fill price'])) ? 4 : 0; },
    toTrades(text, rows) {
      const head = lc(rows[0]); const ix = finder(head);
      const cBS = ix('buy/sell'), cSym = ix('symbol');
      const cQty = ix('qty filled') >= 0 ? ix('qty filled') : ix('qty');
      const cPx = ix('avg fill price') >= 0 ? ix('avg fill price') : ix('price');
      const cT = ix('update time') >= 0 ? ix('update time') : ix('create time');
      if (cBS < 0 || cSym < 0 || cPx < 0) throw new Error('missing Buy/Sell, Symbol or price column');
      const fills = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[cBS]) continue;
        const side = sideWord(row[cBS]); const price = num(row[cPx]);
        const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
        if (!side || isNaN(price) || !(qty > 0)) continue;
        fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
      }
      return pairFills(fills);
    }
  };

  /* Sierra Chart — Trade Activity Log (fills; usually tab-separated). */
  const sierrachart = {
    id: 'sierrachart', label: 'Sierra Chart', kind: 'fills', beta: true,
    sniff(text, rows) { const h = lc(rows[0] || []);
      const distinctive = hasAny(h, ['buysell', 'fillprice', 'internalorderid', 'activitytype', 'openclose']);
      return (distinctive && hasAny(h, ['symbol']) && hasAny(h, ['fillprice', 'fill price', 'price']) && hasAny(h, ['quantity', 'fillquantity', 'qty'])) ? 3 : 0; },
    toTrades(text, rows) {
      const head = lc(rows[0]); const ix = finder(head);
      const cBS = ix('buysell') >= 0 ? ix('buysell') : ix('buy/sell');
      const cSym = ix('symbol');
      const cQty = ix('fillquantity') >= 0 ? ix('fillquantity') : (ix('quantity') >= 0 ? ix('quantity') : ix('qty'));
      const cPx = ix('fillprice') >= 0 ? ix('fillprice') : (ix('fill price') >= 0 ? ix('fill price') : ix('price'));
      const cT = ix('datetime') >= 0 ? ix('datetime') : (ix('fill date-time') >= 0 ? ix('fill date-time') : ix('time'));
      if (cBS < 0 || cSym < 0 || cPx < 0) throw new Error('missing BuySell, Symbol or price column');
      const fills = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[cBS]) continue;
        const side = sideWord(row[cBS]); const price = num(row[cPx]);
        const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
        if (!side || isNaN(price) || !(qty > 0)) continue;
        fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
      }
      return pairFills(fills);
    }
  };

  /* TradeStation — trades/fills export. */
  const tradestation = {
    id: 'tradestation', label: 'TradeStation', kind: 'fills', beta: true,
    sniff(text, rows) { const h = lc(rows[0] || []);
      return (hasAny(h, ['symbol']) && hasAny(h, ['type', 'side', 'action']) && hasAny(h, ['shares', 'contracts', 'quantity', 'qty']) && hasAny(h, ['price']) && hasAny(h, ['time', 'date'])) ? 2 : 0; },
    toTrades(text, rows) {
      const head = lc(rows[0]); const ix = finder(head);
      const cSym = ix('symbol');
      const cSide = ix('type') >= 0 ? ix('type') : (ix('side') >= 0 ? ix('side') : ix('action'));
      const cQty = ix('shares') >= 0 ? ix('shares') : (ix('contracts') >= 0 ? ix('contracts') : (ix('quantity') >= 0 ? ix('quantity') : ix('qty')));
      const cPx = ix('price');
      const cT = ix('date/time') >= 0 ? ix('date/time') : (ix('time') >= 0 ? ix('time') : ix('date'));
      if (cSym < 0 || cSide < 0 || cPx < 0) throw new Error('missing Symbol, Type or Price column');
      const fills = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[cSym]) continue;
        const side = sideWord(row[cSide]); const price = num(row[cPx]);
        const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
        if (!side || isNaN(price) || !(qty > 0)) continue;
        fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
      }
      return pairFills(fills);
    }
  };

  /* Webull — Orders export (fills; equities). */
  const webull = {
    id: 'webull', label: 'Webull', kind: 'fills', beta: true,
    sniff(text, rows) { const h = lc(rows[0] || []);
      return (hasAny(h, ['symbol']) && hasAny(h, ['side']) && hasAny(h, ['avg price', 'price']) && hasAny(h, ['filled', 'qty']) && hasAny(h, ['filled time', 'placed time'])) ? 3 : 0; },
    toTrades(text, rows) {
      const head = lc(rows[0]); const ix = finder(head);
      const cSym = ix('symbol'), cSide = ix('side');
      const cQty = ix('filled') >= 0 ? ix('filled') : (ix('total qty') >= 0 ? ix('total qty') : ix('qty'));
      const cPx = ix('avg price') >= 0 ? ix('avg price') : ix('price');
      const cT = ix('filled time') >= 0 ? ix('filled time') : (ix('placed time') >= 0 ? ix('placed time') : ix('time'));
      const cStatus = ix('status');
      if (cSym < 0 || cSide < 0 || cPx < 0) throw new Error('missing Symbol, Side or Price column');
      const fills = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[cSym]) continue;
        if (cStatus >= 0 && row[cStatus] && !/fill/i.test(row[cStatus])) continue; // only filled
        const side = sideWord(row[cSide]); const price = num(row[cPx]);
        const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
        if (!side || isNaN(price) || !(qty > 0)) continue;
        fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
      }
      return pairFills(fills);
    }
  };

  /* Interactive Brokers — Flex/Activity trades (fills; uses Realized P/L when present). */
  const ibkr = {
    id: 'ibkr', label: 'Interactive Brokers', kind: 'fills', beta: true,
    sniff(text, rows) { const h = lc(rows[0] || []);
      const distinctive = hasAny(h, ['buy/sell', 'proceeds', 'ibcommission', 'realized p/l', 'realizedpnl', 'fifopnlrealized']);
      return (distinctive && hasAny(h, ['symbol']) && hasAny(h, ['datetime', 'date/time']) && hasAny(h, ['tradeprice', 't. price', 'price', 'proceeds'])) ? 3 : 0; },
    toTrades(text, rows) {
      const head = lc(rows[0]); const ix = finder(head);
      const cSym = ix('symbol');
      const cT = ix('datetime') >= 0 ? ix('datetime') : ix('date/time');
      const cBS = ix('buy/sell');
      const cQty = ix('quantity');
      const cPx = ix('tradeprice') >= 0 ? ix('tradeprice') : (ix('t. price') >= 0 ? ix('t. price') : ix('price'));
      const cReal = ix('realized p/l') >= 0 ? ix('realized p/l') : (ix('realizedpnl') >= 0 ? ix('realizedpnl') : ix('fifopnlrealized'));
      if (cSym < 0 || cPx < 0 || (cBS < 0 && cQty < 0)) throw new Error('missing Symbol, price or Buy/Sell column');
      const fills = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || !row[cSym]) continue;
        let qn = cQty >= 0 ? num(row[cQty]) : NaN;
        let side = cBS >= 0 ? sideWord(row[cBS]) : (qn > 0 ? 'buy' : qn < 0 ? 'sell' : '');
        const price = num(row[cPx]); const qty = isNaN(qn) ? 1 : Math.abs(qn);
        if (!side || isNaN(price) || !(qty > 0)) continue;
        const f = { time: normTime(row[cT]), symbol: row[cSym], side, qty, price };
        if (cReal >= 0) { const rp = num(row[cReal]); if (!isNaN(rp) && rp !== 0) f.realized = rp; }
        fills.push(f);
      }
      return pairFills(fills);
    }
  };

  /* Charles Schwab / thinkorswim — Account Statement "Account Trade History" (fills). */
  const schwab = {
    id: 'schwab', label: 'Schwab / thinkorswim', kind: 'fills', beta: true,
    sniff(text, rows) {
      if (/account trade history/i.test(text)) return 4;
      return headerRow(rows, ['exec time', 'side', 'symbol']) >= 0 ? 3 : 0;
    },
    toTrades(text, rows) {
      const hr = headerRow(rows, ['exec time', 'symbol']);
      if (hr < 0) throw new Error('no "Exec Time / Symbol" trade-history section found');
      const head = lc(rows[hr]); const ix = finder(head);
      const cT = ix('exec time'), cSide = ix('side'), cSym = ix('symbol');
      const cQty = ix('qty'), cPx = ix('price'), cPos = ix('pos effect');
      if (cT < 0 || cSide < 0 || cSym < 0 || cPx < 0) throw new Error('missing Exec Time / Side / Symbol / Price');
      const ncol = rows[hr].length;
      const fills = [];
      for (let r = hr + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.length < ncol - 1) break; // fewer columns ⇒ we've left the trade-history table
        if (!row[cSide]) continue; // a blank optional Side cell shouldn't truncate the rest of the section
        const side = sideWord(row[cSide]); const price = num(row[cPx]);
        const qty = cQty >= 0 ? Math.abs(num(row[cQty])) : 1;
        if (!side || isNaN(price) || !(qty > 0)) continue;
        fills.push({ time: normTime(row[cT]), symbol: row[cSym], side, qty, price });
      }
      return pairFills(fills);
    }
  };

  const ADAPTERS = [tradingview, motivewave, tradovate, rithmic, sierrachart, tradestation, webull, ibkr, schwab];
  const byId = id => ADAPTERS.find(a => a.id === id);

  /* Best-guess platform for an export (or null). */
  function detect(text) {
    let rows; try { rows = parseCSV(text); } catch (_) { return null; }
    if (!rows.length) return null;
    let best = null;
    for (const a of ADAPTERS) {
      let score = 0; try { score = a.sniff(text, rows) || 0; } catch (_) { score = 0; }
      if (score >= 2 && (!best || score > best.score)) best = { id: a.id, label: a.label, beta: !!a.beta, kind: a.kind, score };
    }
    return best;
  }

  /* Parse an export into normalized trades.
     platformId optional — when omitted, auto-detect. Returns:
       { ok, trades, platform, label, beta, kind, detected }  or  { ok:false, error } */
  function parse(text, platformId) {
    if (!text || !text.trim()) return { ok: false, error: 'The file is empty.' };
    let rows; try { rows = parseCSV(text); } catch (e) { return { ok: false, error: 'Could not read the file as CSV.' }; }
    if (rows.length < 2) return { ok: false, error: 'The file has no data rows.' };

    let adapter, detected = detect(text);
    if (platformId) { adapter = byId(platformId); if (!adapter) return { ok: false, error: 'Unknown platform "' + platformId + '".' }; }
    else if (detected) adapter = byId(detected.id);
    else return { ok: false, error: 'Could not recognize this platform’s export format. Choose your platform from the dropdown and try again.', detected: null };

    let trades;
    try { trades = adapter.toTrades(text, rows); }
    catch (e) { return { ok: false, error: `Could not parse this file as ${adapter.label}: ${e.message}.`, platform: adapter.id }; }

    trades = (trades || []).filter(t => t && t.time && !isNaN(t.pnl) && t.date && /^\d{4}-\d{2}-\d{2}/.test(t.date));
    if (!trades.length) return { ok: false, error: `No completed trades found in this file for the ${adapter.label} format.`, platform: adapter.id };
    trades.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

    return { ok: true, trades, platform: adapter.id, label: adapter.label, beta: !!adapter.beta, kind: adapter.kind,
      detected: detected ? detected.id : null };
  }

  const API = {
    parse, detect, pairFills, pointValue, rootSym, parseCSV, normTime,
    list: () => ADAPTERS.map(a => ({ id: a.id, label: a.label, beta: !!a.beta, kind: a.kind }))
  };

  const G = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  G.Adapters = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
