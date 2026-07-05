/* Synthetic adapter tests. Run: node scripts/test-adapters.mjs
   These exercise detection + parsing + normalization against representative
   sample exports for each platform. Real exports should still be spot-checked
   for the beta adapters, but this guards the shape and the fills matcher.
   ESM (A20): app/adapters.js is now a native ES module, so this imports its
   default export instead of require()-ing it. */
import A from '../src/lib/core/adapters.ts';
import * as I from '../src/lib/core/intake.ts';
import { tradeId } from '../src/lib/core/store.ts';

let pass = 0,
  fail = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ok  ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '  → ' + extra : ''));
  }
}
function shape(t) {
  return t && t.time && /^\d{4}-\d{2}-\d{2}/.test(t.date) && !isNaN(t.pnl) && 'symbol' in t && 'root' in t && 'side' in t;
}

const C = {
  tradingview: `Time,Action,Realized PnL (value)
2026-06-02 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",50.00
2026-06-02 11:30:00,"Close short position for symbol MNQM2025 at price 18000.00",-20.00`,

  // Real export shape (paper-trading order history, 2026-07-04 — A106): newest-first, one row per
  // ORDER, Status gates executions, Fill price is the avg, Closing time is the fill moment.
  'tradingview-orders': `Symbol,Side,Type,Quantity,Limit price,Stop price,Fill price,Status,Commission,Placing time,Closing time,Order ID,Level ID,Leverage,Margin
CME_MINI:MES1!,Sell,Market,1,,,7550.00,Filled,,2026-06-20 10:30:00,2026-06-20 10:30:00,3,,,
CME_MINI:MES1!,Buy,Limit,1,7540.00,,7540.00,Filled,,2026-06-20 10:00:00,2026-06-20 10:05:00,2,,,
CME_MINI:MES1!,Buy,Limit,1,7530.00,,,Cancelled,,2026-06-20 09:55:00,2026-06-20 10:04:00,1,,,`,

  motivewave: `Instrument,Side,Quantity,Entry Time,Entry Price,Exit Time,Exit Price,P/L
MESM2025,Buy,1,2026-06-02 09:31:00,5300.00,2026-06-02 09:45:00,5310.00,50.00
MNQM2025,Sell,1,2026-06-02 10:00:00,18010.00,2026-06-02 10:20:00,18000.00,20.00`,

  tradovate: `orderId,Account,B/S,Contract,Product,filledQty,Fill Time,Avg Fill Price
1,DEMO,Buy,MESM2025,MES,1,2026-06-02 09:31:00,5300.00
2,DEMO,Sell,MESM2025,MES,1,2026-06-02 09:45:00,5310.00`,

  // Tradovate / NinjaTrader — Performance export (the platform's own round-trip pairing; A209).
  // Real-format rows from docs/csv-examples: row 2 is a SHORT (sold before bought) with the
  // '$(x.xx)' accounting-negative pnl the exports use for losses.
  'tradovate-perf': `symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration
ESM6,-2,0,0.25,540725260010,540725260021,1,7494.25,7494.75,$25.00,06/14/2026 18:03:54,06/14/2026 18:04:19,25sec
MESM6,-2,0,0.25,540725260033,540725260130,1,7490.50,7491.75,$(6.25),06/14/2026 18:50:51,06/14/2026 18:13:48,37min 2sec`,

  // Tradovate / NinjaTrader — Fills export (per-fill executions WITH real commission — A208/A209).
  // Carries '_'-prefixed meta twins (incl. a UTC _timestamp) — the adapter must read the exact
  // human columns (local Timestamp, Contract) rather than substring-matching into the meta ones.
  'tradovate-fills': `_id,_orderId,_contractId,_timestamp,_tradeDate,_action,_qty,_price,_active,_accountId,Fill ID,Order ID,Timestamp,Date,Account,B/S,Quantity,Price,_priceFormat,_priceFormatType,_tickSize,Contract,Product,Product Description,commission
540725260010,540725260007,3570919,2026-06-14 23:03:54.732Z,2026-06-15,0,1,7494.25,true,54066902,540725260010,540725260007,06/14/2026 18:03:54,6/14/26,DEMO, Buy,1,7494.25,-2,0,0.25,ESM6,ES,E-Mini S&P 500,1.29
540725260021,540725260018,3570919,2026-06-14 23:04:19.743Z,2026-06-15,1,1,7494.75,true,54066902,540725260021,540725260018,06/14/2026 18:04:19,6/14/26,DEMO, Sell,1,7494.75,-2,0,0.25,ESM6,ES,E-Mini S&P 500,1.29`,

  // Quantower — Trades export (A209): per-fill realized Gross P/L + Fee, AM/PM times, signed qty,
  // newest-first, with the 'Strike price' / '"Gross P/L,ticks"' trap columns exact-match must dodge.
  quantower: `Account,Date/Time,Symbol,Description,Symbol type,Expiration date,Strike price,Side,Order type,Quantity,Price,Gross P/L,Fee,Net P/L,Trade value,Trade ID,Order ID,Position ID,Connection name,Comment,Exchange,"Gross P/L,ticks","Gross P/L(Qty),ticks",
Account 1 (USD),7/5/2026 5:06:02 PM,MESU26,AMP/CQG,Futures,9/17/2026 7:00:00 PM,0,Sell,Market,-1,7556.5,7.5,1.10,6.40,-37782.5,t4,o4,,Sim,,CME,6,6,
Account 1 (USD),7/5/2026 5:05:23 PM,MESU26,AMP/CQG,Futures,9/17/2026 7:00:00 PM,0,Buy,Market,1,7555,0,1.10,-1.10,37775,t3,o3,,Sim,,CME,0,0,
Account 1 (USD),7/5/2026 5:05:12 PM,MESU26,AMP/CQG,Futures,9/17/2026 7:00:00 PM,0,Buy,Limit,1,7551.5,15,0,15,37757.5,t2,o2,,Sim,,CME,12,12,
Account 1 (USD),7/5/2026 5:04:32 PM,MESU26,AMP/CQG,Futures,9/17/2026 7:00:00 PM,0,Sell,Market,-1,7554.5,0,0,0,-37772.5,t1,o1,,Sim,,CME,0,0,`,

  rithmic: `Account,Buy/Sell,Symbol,Qty Filled,Avg Fill Price,Update Time
DEMO,Buy,MNQM2025,1,18000.00,2026-06-02 09:31:00
DEMO,Sell,MNQM2025,1,18010.00,2026-06-02 09:50:00`,

  // Sierra Chart — tab separated
  sierrachart: `Symbol\tQuantity\tBuySell\tFillPrice\tDateTime
MCLN2025\t1\tBuy\t70.00\t2026-06-02 09:31:00
MCLN2025\t1\tSell\t70.50\t2026-06-02 10:10:00`,

  tradestation: `Symbol,Type,Quantity,Price,Date/Time
MESM2025,Buy,1,5300.00,06/02/2026 09:31:00
MESM2025,Sell,1,5305.00,06/02/2026 09:55:00`,

  webull: `Symbol,Side,Status,Filled,Avg Price,Filled Time
AAPL,Buy,Filled,10,200.00,06/02/2026 09:31:00
AAPL,Sell,Filled,10,205.00,06/02/2026 15:55:00`,

  ibkr: `Symbol,DateTime,Buy/Sell,Quantity,TradePrice,Realized P/L
TSLA,2026-06-02 09:31:00,BUY,10,250.00,0
TSLA,2026-06-02 14:00:00,SELL,-10,255.00,120.00`,

  schwab: `Account Statement for 12345678
Account Trade History
Exec Time,Side,Qty,Pos Effect,Symbol,Price
06/02/2026 09:31:00,BUY,1,TO OPEN,/MESM25,5300.00
06/02/2026 09:48:00,SELL,1,TO CLOSE,/MESM25,5312.00`,
};

console.log('Detection:');
for (const id of Object.keys(C)) ok('detect ' + id, (A.detect(C[id]) || {}).id === id, JSON.stringify(A.detect(C[id])));

console.log('\nParsing + normalization:');
for (const id of Object.keys(C)) {
  const r = A.parse(C[id]);
  ok('parse ' + id + ' ok', r.ok, r.error);
  if (r.ok) {
    ok('  ' + id + ' platform=' + id, r.platform === id);
    ok('  ' + id + ' has trades', r.trades.length >= 1);
    ok('  ' + id + ' shape', r.trades.every(shape));
  }
}

console.log('\nFills matcher (PnL + hold time):');
let r = A.parse(C.tradovate);
ok(
  'tradovate 1 long, +$50 (MES pt=5)',
  r.ok && r.trades.length === 1 && r.trades[0].side === 'long' && Math.abs(r.trades[0].pnl - 50) < 1e-6,
  JSON.stringify(r.trades)
);
ok('tradovate hold time present', r.ok && r.trades[0].holdMs > 0);

// A209: the Tradovate/NinjaTrader family — Performance (closed) + Fills (real commissions).
r = A.parse(C['tradovate-perf']);
ok(
  'tradovate/NT performance: 2 closed trades — $(x.xx) negative parses, short from sold-first order',
  r.ok &&
    r.trades.length === 2 &&
    r.trades[0].pnl === 25 &&
    r.trades[0].side === 'long' &&
    r.trades[1].pnl === -6.25 &&
    r.trades[1].side === 'short' &&
    r.trades[1].root === 'MES',
  JSON.stringify(r.trades)
);
ok('tradovate/NT performance: family label, non-beta', r.ok && r.label === 'Tradovate / NinjaTrader (performance)' && !r.beta);
r = A.parse(C['tradovate-fills']);
ok(
  'tradovate/NT fills: paired w/ REAL round-turn commission 2.58 (A208); exact Contract + local Timestamp win over the _meta twins',
  r.ok &&
    r.trades.length === 1 &&
    Math.abs(r.trades[0].pnl - 25) < 1e-6 &&
    Math.abs(r.trades[0].commission - 2.58) < 1e-6 &&
    r.trades[0].symbol === 'ESM6' &&
    r.trades[0].time === '2026-06-14 18:04:19',
  JSON.stringify(r.trades)
);

// A209: Quantower — per-fill realized P/L wins, Fee → commission, AM/PM times, out-scores TradeStation.
r = A.parse(C.quantower);
ok(
  'quantower: 2 round trips from newest-first AM/PM fills — realized P/L verbatim, Fee → round-turn commission',
  r.ok &&
    r.trades.length === 2 &&
    r.trades.some(t => t.side === 'short' && t.pnl === 15 && (t.commission ?? 0) === 0) &&
    r.trades.some(t => t.side === 'long' && t.pnl === 7.5 && Math.abs((t.commission ?? 0) - 2.2) < 1e-9) &&
    r.trades.every(t => t.root === 'MES' && t.time.startsWith('2026-07-05 17:')),
  JSON.stringify(r.trades)
);
ok('quantower: detected as Quantower (not TradeStation — the old misdetection)', A.detect(C.quantower)?.id === 'quantower');

r = A.parse(C.rithmic);
ok('rithmic 1 long, +$20 (MNQ pt=2)', r.ok && r.trades.length === 1 && Math.abs(r.trades[0].pnl - 20) < 1e-6, JSON.stringify(r.trades));

r = A.parse(C.sierrachart);
ok('sierra 1 long, +$500 (MCL pt=100)', r.ok && r.trades.length === 1 && Math.abs(r.trades[0].pnl - 50) < 1e-6, JSON.stringify(r.trades));

r = A.parse(C.webull);
ok('webull 1 long, +$50 (stock pt=1)', r.ok && r.trades.length === 1 && Math.abs(r.trades[0].pnl - 50) < 1e-6, JSON.stringify(r.trades));

r = A.parse(C.ibkr);
ok('ibkr uses Realized P/L = $120', r.ok && r.trades.length === 1 && Math.abs(r.trades[0].pnl - 120) < 1e-6, JSON.stringify(r.trades));

r = A.parse(C.schwab);
ok(
  'schwab 1 long, +$60 (MES pt=5, 12pt)',
  r.ok && r.trades.length === 1 && Math.abs(r.trades[0].pnl - 60) < 1e-6,
  JSON.stringify(r.trades)
);

console.log('\nB7 robustness:');
// (1) Schwab: a blank optional Pos Effect cell must not truncate later trades.
const schwabBlank = `Account Statement for 12345678
Account Trade History
Exec Time,Side,Qty,Pos Effect,Symbol,Price
06/02/2026 09:31:00,BUY,1,,/MESM25,5300.00
06/02/2026 09:48:00,SELL,1,TO CLOSE,/MESM25,5312.00`;
r = A.parse(schwabBlank);
ok(
  'schwab keeps trades past a blank Pos Effect cell',
  r.ok && r.trades.length === 1 && Math.abs(r.trades[0].pnl - 60) < 1e-6,
  JSON.stringify(r)
);
// (2) parseCSV drops all-empty lines.
ok('parseCSV skips all-empty rows', A.parseCSV('a,b\n,\n1,2').length === 2, JSON.stringify(A.parseCSV('a,b\n,\n1,2')));
// (3) Flip fill attributes its FULL realized PnL (close 1 + open 1 in one sell of qty 2).
const flip = `Symbol,DateTime,Buy/Sell,Quantity,TradePrice,Realized P/L
TSLA,2026-06-02 09:31:00,BUY,1,250.00,0
TSLA,2026-06-02 14:00:00,SELL,2,255.00,500.00
TSLA,2026-06-02 15:00:00,BUY,1,256.00,0`;
r = A.parse(flip);
// The SELL qty 2 closes the 1 long (realized $500) and opens 1 short; the $500 must land
// fully on the closed contract, not be diluted to $250 by the new lot (500 * 1/2).
ok('flip fill attributes full $500 realized', r.ok && Math.abs(r.trades[0].pnl - 500) < 1e-6, JSON.stringify(r.trades));

console.log('\nB14 detection distinctiveness:');
// A real TradeStation export (combined Date/Time) still auto-detects.
ok(
  'tradestation still detects (has Date/Time)',
  (A.detect(C.tradestation) || {}).id === 'tradestation',
  JSON.stringify(A.detect(C.tradestation))
);
// A generic fills export with split Time/Date columns must NOT auto-claim as TradeStation.
const generic = 'Symbol,Side,Quantity,Price,Time\nXYZ,Buy,1,100.00,09:31:00';
ok(
  'generic split-time export does not misdetect as tradestation',
  (A.detect(generic) || {}).id !== 'tradestation',
  JSON.stringify(A.detect(generic))
);

console.log('\nB5 date format:');
ok('M/D/Y stays US (06/02 → Jun 2)', A.normTime('06/02/2026 09:31:00').slice(0, 10) === '2026-06-02', A.normTime('06/02/2026 09:31:00'));
ok(
  'D/M/Y detected when day>12 (25/06 → Jun 25)',
  A.normTime('25/06/2026 09:31:00').slice(0, 10) === '2026-06-25',
  A.normTime('25/06/2026 09:31:00')
);

console.log('\nB24 number locale parsing:');
ok('US thousands "$1,234.50" → 1234.5', A.num('$1,234.50') === 1234.5, String(A.num('$1,234.50')));
ok('EU "1.234,50" → 1234.5', A.num('1.234,50') === 1234.5, String(A.num('1.234,50')));
ok('EU decimal "123,45" → 123.45', A.num('123,45') === 123.45, String(A.num('123,45')));
ok('US "1,234" stays thousands → 1234', A.num('1,234') === 1234, String(A.num('1,234')));
ok('accounting "(1.234,50)" → -1234.5', A.num('(1.234,50)') === -1234.5, String(A.num('(1.234,50)')));
ok('plain "5310.00" → 5310', A.num('5310.00') === 5310, String(A.num('5310.00')));
ok('EU multi-group "1.234.567,89" → 1234567.89', A.num('1.234.567,89') === 1234567.89, String(A.num('1.234.567,89')));

console.log('\nB26 whole-file date order:');
// Uniform D/M/Y file: only one row has day>12, but BOTH must parse as D/M/Y, not just that one.
const dmyFile = `Time,Action,Realized PnL (value)
13/06/2026 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",50.00
05/03/2026 11:30:00,"Close long position for symbol MESM2025 at price 5320.00",20.00`;
let rd = A.parse(dmyFile);
ok(
  'D/M/Y file: day>12 row → Jun 13',
  rd.ok && rd.trades.some(t => t.date === '2026-06-13'),
  JSON.stringify(rd.trades && rd.trades.map(t => t.date))
);
ok(
  'D/M/Y file: ambiguous 05/03 → Mar 5 (not May 3)',
  rd.ok && rd.trades.some(t => t.date === '2026-03-05'),
  JSON.stringify(rd.trades && rd.trades.map(t => t.date))
);

console.log('\nB25 same-second fills (newest-first export):');
// A newest-first export (later times listed first). The MES entry+exit share one second, and the
// file lists the exit (sell) before the entry (buy). Other-second rows establish the descending
// order, so the same-second pair must be reversed back to execution order: buy 5310 → sell 5311 =
// long +$5. Without the tiebreak FIFO would see sell-first and book a short.
const sameSec = `Symbol,Quantity,BuySell,FillPrice,DateTime
MESM2025,1,Sell,5311.00,2026-06-02 09:31:00
MESM2025,1,Buy,5310.00,2026-06-02 09:31:00
MNQM2025,1,Sell,18000.00,2026-06-02 09:30:00
MNQM2025,1,Buy,17990.00,2026-06-02 09:29:00`;
let rss = A.parse(sameSec);
const mes = (rss.trades || []).find(t => t.root === 'MES');
ok(
  'same-second newest-first pairs as long +$5',
  rss.ok && mes && mes.side === 'long' && Math.abs(mes.pnl - 5) < 1e-6,
  JSON.stringify(rss.trades)
);

console.log('\nA113 unknown point-value flagged (not silently $1/point):');
// A Sierra-style fills export for SR3 (3-month SOFR) — absent from the POINT table → fallback $1/point.
const unknownPV = `Symbol\tQuantity\tBuySell\tFillPrice\tDateTime
SR3M2025\t1\tBuy\t96.00\t2026-06-02 09:31:00
SR3M2025\t1\tSell\t96.50\t2026-06-02 10:00:00`;
r = A.parse(unknownPV);
ok('unknown root → estimatedRoots lists SR3', r.ok && (r.estimatedRoots || []).includes('SR3'), JSON.stringify(r.estimatedRoots));
ok('unknown root → trade carries pvEstimated', r.ok && r.trades[0] && r.trades[0].pvEstimated === true, JSON.stringify(r.trades));
ok('unknown root PnL = price diff × $1/point (0.5)', r.ok && approx(r.trades[0].pnl, 0.5), JSON.stringify(r.trades));
// A known root must NOT be flagged.
ok('known root (MES) has no estimatedRoots', !A.parse(C.tradovate).estimatedRoots, JSON.stringify(A.parse(C.tradovate).estimatedRoots));

console.log('\nA114 distinct same-second trades are not collapsed:');
// Two identical TradingView close-events (same time/symbol/side/pnl, no qty/price to separate them).
const dupTwins = `Time,Action,Realized PnL (value)
2026-06-02 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",12.50
2026-06-02 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",12.50`;
rd = A.parse(dupTwins);
ok('two identical same-second trades both survive parse', rd.ok && rd.trades.length === 2, JSON.stringify(rd.trades));
ok('the 2nd identical trade carries a dup ordinal', rd.ok && rd.trades[1].dup === 1, JSON.stringify(rd.trades.map(t => t.dup)));
ok('identical trades get DISTINCT dedupe ids', rd.ok && tradeId(rd.trades[0]) !== tradeId(rd.trades[1]), tradeId(rd.trades[0]));
// Backward-compat: a unique trade's id is unchanged by the ordinal (dup unset → byte-identical key).
ok(
  'unique trade id stays backward-compatible (no dup suffix)',
  tradeId({ time: '2026-06-02 10:00:00', symbol: 'MESM2025', side: 'long', pnl: 12.5 }) === tradeId(rd.trades[0])
);

console.log('\nA115 multi-lot realized apportioned by price spread:');
// One SELL of qty 2 closes two longs opened at 100 and 110; broker realized = 30 over the fill.
// Must split 20 / 10 by price spread, NOT a flat 15 / 15 qty proration.
const multiLot = `Symbol,DateTime,Buy/Sell,Quantity,TradePrice,Realized P/L
TSLA,2026-06-02 09:31:00,BUY,1,100.00,0
TSLA,2026-06-02 09:32:00,BUY,1,110.00,0
TSLA,2026-06-02 14:00:00,SELL,2,120.00,30.00`;
const rm = A.parse(multiLot);
const mlPnls = (rm.trades || []).map(t => t.pnl).sort((a, b) => a - b);
ok(
  'multi-lot realized splits 10 / 20 by price spread',
  rm.ok && mlPnls.length === 2 && approx(mlPnls[0], 10) && approx(mlPnls[1], 20),
  JSON.stringify(mlPnls)
);
ok('apportioned parts sum to the broker realized (30)', rm.ok && approx(mlPnls[0] + mlPnls[1], 30), JSON.stringify(mlPnls));

console.log('\nA120 holdMs is timezone-stable across a DST boundary:');
// Entry 01:30 → exit 03:30 on US spring-forward day. tms() parses as UTC, so the hold is the
// wall-clock 2h regardless of the runner's timezone (local parsing would read 1h in US zones).
const dstHold = `Symbol,DateTime,Buy/Sell,Quantity,TradePrice,Realized P/L
6E,2026-03-08 01:30:00,BUY,1,1.0800,0
6E,2026-03-08 03:30:00,SELL,1,1.0810,0`;
const rdst = A.parse(dstHold);
ok(
  'holdMs = wall-clock 2h (tz-stable)',
  rdst.ok && rdst.trades[0] && rdst.trades[0].holdMs === 2 * 3600 * 1000,
  rdst.trades && rdst.trades[0] && String(rdst.trades[0].holdMs)
);

console.log('\nError handling:');
ok('empty file', !A.parse('').ok);
ok('garbage', !A.parse('foo,bar,baz\n1,2,3').ok);
ok('explicit platform mismatch returns no trades', !A.parse(C.webull, 'tradingview').ok);

console.log('\nA168 input-tolerance hardening:');
// (1) Semicolon-delimited (EU-Excel re-save) parses CORRECTLY — used to import pnl = 2026 (the year).
const semi = `Time;Action;Realized PnL (value)
2026-06-02 10:00:00;Close long position for symbol MESM2025 at price 5310.00;50,00
2026-06-03 11:00:00;Close short position for symbol MNQM2025 at price 18000.00;-20,00`;
const rsemi = A.parse(semi);
ok(
  'semicolon CSV parses with the real PnL (50 / -20), not the year',
  rsemi.ok && rsemi.trades.length === 2 && approx(rsemi.trades[0].pnl, 50) && approx(rsemi.trades[1].pnl, -20),
  JSON.stringify((rsemi.trades || []).map(t => t.pnl))
);
// (2) A stray d/m-looking fragment inside a NOTE cell must not re-date the file (anchored detection).
const poison = `Time,Action,Realized PnL (value)
06/02/2026 10:00:00,"Close long position for symbol MESM2025 at price 5310.00 note 14/3/2026",50.00`;
const rpoison = A.parse(poison);
ok(
  'date-order detection ignores non-date cells (06/02 stays Jun 2)',
  rpoison.ok && rpoison.trades[0].date === '2026-06-02',
  rpoison.trades && rpoison.trades[0].date
);
// (3) IBKR-style quoted "YYYY-MM-DD, HH:MM:SS" keeps its time.
ok(
  'ISO datetime with comma separator keeps the time',
  A.normTime('2026-06-02, 09:31:00') === '2026-06-02 09:31:00',
  A.normTime('2026-06-02, 09:31:00')
);
// (4) A fill with a garbage timestamp is SKIPPED (counted), not allowed to corrupt FIFO / vanish P&L.
const badFill = `orderId,Account,B/S,Contract,Product,filledQty,Fill Time,Avg Fill Price
1,DEMO,Buy,MESM2025,MES,1,20260602;093000,5300.00
2,DEMO,Sell,MESM2025,MES,1,2026-06-02 09:45:00,5310.00`;
const rbad = A.parse(badFill);
ok(
  'garbage-time fill is skipped and reported',
  rbad.ok === false || (rbad.skippedFills === 1 && !(rbad.trades || []).some(t => isNaN(t.holdMs ?? 0))),
  JSON.stringify({ ok: rbad.ok, skipped: rbad.skippedFills, n: (rbad.trades || []).length })
);
// (5) Suffixed / service-prefixed symbologies resolve to the real root.
ok(
  'rootSym strips venue suffixes + service prefixes',
  A.rootSym('ESM25-CME') === 'ES' && A.rootSym('MESM25.CME') === 'MES' && A.rootSym('F.US.MESM25') === 'MES',
  [A.rootSym('ESM25-CME'), A.rootSym('MESM25.CME'), A.rootSym('F.US.MESM25')].join('|')
);
// (6) Impossible calendar dates are rejected by the range-checked gate.
const badDate = `Time,Action,Realized PnL (value)
31/31/2026 10:00:00,"Close long position for symbol MESM2025 at price 5310.00",50.00`;
ok('impossible date (month 31) yields no trades', !A.parse(badDate).ok);
// (7) Dangling open lots are counted into the openLots notice.
const dangling = `orderId,Account,B/S,Contract,Product,filledQty,Fill Time,Avg Fill Price
1,DEMO,Buy,MESM2025,MES,2,2026-06-02 09:31:00,5300.00
2,DEMO,Sell,MESM2025,MES,1,2026-06-02 09:45:00,5310.00`;
const rdang = A.parse(dangling);
ok(
  'dangling open lot reported via openLots',
  rdang.ok && rdang.openLots === 1 && rdang.trades.length === 1,
  JSON.stringify({ open: rdang.openLots, n: (rdang.trades || []).length })
);

/* ---------- A106: TradingView order-history adapter (verified vs real export 2026-07-04) ---------- */
console.log('\nA106 TradingView order history:');
{
  const r = A.parse(C['tradingview-orders']);
  ok(
    'tv-orders: 1 long +$50 (MES pt=5, 10pts), cancelled row skipped',
    r.ok && r.trades.length === 1 && r.trades[0].side === 'long' && approx(r.trades[0].pnl, 50),
    JSON.stringify(r.trades)
  );
  ok('tv-orders: CME_MINI:MES1! resolves to root MES', r.ok && r.trades[0].root === 'MES');
  ok('tv-orders: hold time from Closing times (25 min)', r.ok && r.trades[0].holdMs === 25 * 60 * 1000, r.ok && r.trades[0].holdMs);
  ok('tv-orders: paper export (empty Commission) leaves trades unmarked', r.ok && r.trades[0].commission == null);
  // A real (broker-integrated) export may populate Commission — captured per round trip (A208).
  const withComm = C['tradingview-orders']
    .replace('Filled,,2026-06-20 10:30:00', 'Filled,1.40,2026-06-20 10:30:00')
    .replace('Filled,,2026-06-20 10:00:00', 'Filled,1.40,2026-06-20 10:00:00');
  const rc2 = A.parse(withComm);
  ok('tv-orders: populated Commission column → trade.commission ($2.80)', rc2.ok && rc2.trades[0].commission === 2.8);
  // The real balance-history export uses exchange-prefixed continuous symbols — root must resolve.
  const realBal = `Time,Balance before,Balance after,Realized PnL (value),Realized PnL (currency),Action
2026-07-01 23:57:27,100217.25,100186,-31.25,USD,"Close short position for symbol CME_MINI:MES1! at price 7549.00 for 1 units. Position AVG Price was 7542.750000, currency: USD, rate: 1.000000, point value: 5.000000"`;
  const rb2 = A.parse(realBal);
  ok(
    'tradingview balance-history (real shape): CME_MINI:MES1! → MES, pnl −31.25',
    rb2.ok && rb2.trades[0].root === 'MES' && approx(rb2.trades[0].pnl, -31.25) && rb2.trades[0].side === 'short',
    JSON.stringify(rb2.trades)
  );
  // The journal/positions exports are NOT trade data — the A178 gate must refuse, not misparse.
  const journal = `Time,Text
2026-07-01 23:57:27,Order 3246850422 for symbol CME_MINI:MES1! has been executed at price 7549.00 for 1 units`;
  ok('tv trading-journal export refuses (no adapter claim)', A.detect(journal) === null && !A.parse(journal).ok);
}

/* ---------- A208: real per-fill commissions → per-trade commission ---------- */
console.log('\nA208 commission capture (IBKR):');
// IBKR reports IBCommission as a NEGATIVE cash amount. Round trip = entry share + exit share.
const ibkrComm = `Symbol,DateTime,Buy/Sell,Quantity,TradePrice,Realized P/L,IBCommission
TSLA,2026-06-02 09:31:00,BUY,10,250.00,0,-2.00
TSLA,2026-06-02 14:00:00,SELL,-10,255.00,120.00,-2.50`;
let rc = A.parse(ibkrComm);
ok(
  'ibkr full round trip carries entry+exit commission ($4.50)',
  rc.ok && rc.trades.length === 1 && rc.trades[0].commission === 4.5,
  JSON.stringify(rc.trades)
);
// Partial close: entry 2 @ $2.00, exits 1+1 @ $1.00 each → each trade = half the entry + its exit.
const ibkrPartial = `Symbol,DateTime,Buy/Sell,Quantity,TradePrice,IBCommission
TSLA,2026-06-02 09:31:00,BUY,2,250.00,-2.00
TSLA,2026-06-02 10:00:00,SELL,-1,255.00,-1.00
TSLA,2026-06-02 11:00:00,SELL,-1,256.00,-1.00`;
rc = A.parse(ibkrPartial);
ok(
  'ibkr partial closes prorate the entry commission (2 × $2.00)',
  rc.ok && rc.trades.length === 2 && rc.trades.every(t => t.commission === 2),
  JSON.stringify((rc.trades || []).map(t => t.commission))
);
// No commission column → the field stays absent (costModel falls back to the modeled rate).
rc = A.parse(C.ibkr);
ok('ibkr without a commission column leaves trades unmarked', rc.ok && rc.trades.every(t => t.commission == null));
rc = A.parse(C.tradovate);
ok('fills adapter without commission support leaves trades unmarked', rc.ok && rc.trades.every(t => t.commission == null));

/* ---------- Cross-export reconciliation (TV calc audit 2026-07-04) ---------- */
console.log('\nCross-export reconciliation (reconcileImport):');
{
  // Mini replica of the real TradingView case: a closed (authoritative) export covering
  // 10:00–10:13, and a fills export whose truncated head mispriced two round trips.
  const T = (time, pnl, extra = {}) => ({
    time,
    date: time.slice(0, 10),
    pnl,
    symbol: 'CME_MINI:MES1!',
    root: 'MES',
    side: 'short',
    ...extra,
  });
  const auth1 = T('2026-06-17 10:00:00', 61.25, { id: 'a1', fileIds: ['balf'] });
  const auth2 = T('2026-06-17 10:13:00', 63.75, { id: 'a2', fileIds: ['balf'] });
  const opts = {
    isAuthority: t => !!t.fileIds?.includes('balf'),
    isDerivedPeer: t => !!t.fileIds?.includes('ordf'),
  };
  const dPhantomMismatch = T('2026-06-17 10:00:00', 271.25, { holdMs: 60000, fileIds: ['ordf'] }); // wrong pnl at a real event
  const dPhantomNoEvent = T('2026-06-17 10:10:00', 92.5, { holdMs: 60000, fileIds: ['ordf'] }); // no authoritative event at all
  const dMatch = T('2026-06-17 10:13:00', 63.75, { holdMs: 90000, fileIds: ['ordf'] }); // corroborated → dedupe/enrich
  const dOutside = T('2026-06-17 09:00:00', 10, { holdMs: 5000, fileIds: ['ordf'] }); // before the window → untouched

  // Fills import into an authoritative store: both phantoms drop, corroborated + outside kept.
  let r = I.reconcileImport([auth1, auth2], [dPhantomMismatch, dPhantomNoEvent, dMatch, dOutside], 'fills', opts);
  ok('recon: phantoms inside the authority window drop (mismatch + no-event)', r.conflicted === 2 && r.evictIds.length === 0);
  ok('recon: corroborated + outside-window trades survive', r.add.length === 2 && r.add.includes(dMatch) && r.add.includes(dOutside));

  // Reverse order: the closed export arrives second — stored derived phantoms evict, matches stay.
  const dp1 = { ...dPhantomMismatch, id: 'd1' },
    dp2 = { ...dPhantomNoEvent, id: 'd2' },
    dm = { ...dMatch, id: 'd3' };
  r = I.reconcileImport([dp1, dp2, dm], [auth1, auth2], 'closed', opts);
  ok('recon: reverse order evicts the same phantoms (converges)', r.conflicted === 2 && r.evictIds.sort().join() === 'd1,d2');
  ok('recon: reverse order keeps the corroborated derived record', !r.evictIds.includes('d3') && r.add.length === 2);

  // No classifiers (no provenance) → conservative fallback: only the exact collision resolves.
  r = I.reconcileImport([{ ...auth1, holdMs: undefined }], [dPhantomMismatch, dPhantomNoEvent], 'fills');
  ok('recon: fallback resolves exact collisions only', r.conflicted === 1 && r.add.length === 1);

  // A different platform family is never touched (classifiers return false).
  const other = { isAuthority: () => false, isDerivedPeer: () => false };
  r = I.reconcileImport([auth1], [dPhantomMismatch], 'fills', other);
  ok('recon: cross-family imports untouched by the window rule (fallback still guards exact keys)', r.add.length + r.conflicted === 1);
}

/* ---------- A177/A178 intake hardening ---------- */
console.log('\nA177/A178 intake hardening:');

// A178 strict detection gate — non-platform CSVs must REFUSE, not auto-claim an adapter.
const bankStatement = `Date,Description,Amount,Balance
2026-06-01,ACH DEPOSIT PAYROLL,2500.00,10500.00
2026-06-02,DEBIT CARD PURCHASE COFFEE,-4.50,10495.50
2026-06-03,ONLINE TRANSFER TO SAVINGS,-500.00,9995.50`;
ok('bank-statement CSV refuses (no adapter claim)', A.detect(bankStatement) === null, JSON.stringify(A.detect(bankStatement)));
const rbank = A.parse(bankStatement);
ok('bank-statement refusal names the supported platforms', !rbank.ok && /supported/i.test(rbank.error || ''), rbank.error);
// Shuffled/partial generic headers — single keywords must not clear an adapter's minScore.
const shuffled = `Balance,Symbol,Notes,Price
100,hello,world,1.23
200,foo,bar,4.56`;
ok('shuffled generic headers refuse', !A.parse(shuffled).ok && A.detect(shuffled) === null, JSON.stringify(A.detect(shuffled)));
// Every real platform fixture must still clear its own gate (regression guard for minScore).
for (const id of Object.keys(C)) ok('minScore gate: ' + id + ' still detects', (A.detect(C[id]) || {}).id === id);

// A177 fuzz — junk input must yield graceful ok:false, never an exception.
function fuzz(name, input) {
  try {
    const r = A.parse(input);
    ok('fuzz: ' + name + ' → graceful refusal', r.ok === false && typeof r.error === 'string', JSON.stringify(r.error));
  } catch (e) {
    ok('fuzz: ' + name + ' → graceful refusal', false, 'THREW: ' + e.message);
  }
}
fuzz('binary blob (NULs)', 'PK\u0003\u0004' + '\u0000'.repeat(512));
fuzz('control-char soup', '\u0001\u0002\u0007\u0008'.repeat(400));
fuzz('10k-column line', 'a,'.repeat(10000) + 'a\n' + 'b,'.repeat(10000) + 'b');
fuzz('deeply quoted garbage', '"'.repeat(4001) + ',x\n"unterminated,"",,' + '"'.repeat(333));

// A177 intake gates (checkCsvFile / checkCsvText) — the pre-parse validation layer.
ok('intake: normal .csv passes', I.checkCsvFile({ name: 'trades.csv', size: 1024, type: 'text/csv' }) === null);
ok(
  'intake: Windows .csv (application/vnd.ms-excel MIME) passes on extension',
  I.checkCsvFile({ name: 'trades.csv', size: 1024, type: 'application/vnd.ms-excel' }) === null
);
ok('intake: extensionless text/plain passes on MIME', I.checkCsvFile({ name: 'export', size: 1024, type: 'text/plain' }) === null);
ok('intake: .exe with unknown MIME rejects', I.checkCsvFile({ name: 'totally-a-csv.exe', size: 1024, type: '' }) !== null);
ok('intake: oversize file rejects', I.checkCsvFile({ name: 'huge.csv', size: I.CSV_MAX_BYTES + 1, type: 'text/csv' }) !== null);
ok('intake: normal CSV text passes', I.checkCsvText('Time,Action,Realized PnL\n2026-06-02 10:00:00,close,50.00') === null);
ok('intake: NUL byte rejects as binary', I.checkCsvText('Time,Act\u0000ion,PnL\n1,2,3') !== null);
ok('intake: row cap rejects', I.checkCsvText('h\n' + '\n'.repeat(I.CSV_MAX_ROWS + 1)) !== null);

/* ---------- F52: ATAS X — the .xlsx importer (minimal reader + adapter) ---------- */
console.log('\nF52 ATAS X (.xlsx → Journal CSV → adapter):');
{
  const fs = await import('node:fs');
  const X = await import('../src/lib/core/xlsx.ts');

  // Excel-serial conversion: the 1900-system anchor (25569 = Unix epoch) + second rounding.
  ok(
    'excelSerialToTime: serial 25569 → 1970-01-01 00:00:00',
    X.excelSerialToTime(25569) === '1970-01-01 00:00:00',
    X.excelSerialToTime(25569)
  );
  ok(
    'excelSerialToTime: float noise rounds to whole seconds (46191.5493634259 → 13:11:05)',
    X.excelSerialToTime(46191.5493634259) === '2026-06-18 13:11:05',
    X.excelSerialToTime(46191.5493634259)
  );

  // (a) THE REAL FILE — docs/csv-examples/atas-x/ is the permanent ground truth for this format.
  const atasDir = new URL('../docs/csv-examples/atas-x/', import.meta.url);
  const xlsxName = fs.readdirSync(atasDir).find(f => f.toLowerCase().endsWith('.xlsx'));
  ok('real ATAS xlsx present in docs/csv-examples/atas-x/', !!xlsxName, xlsxName);
  const nb = fs.readFileSync(new URL(xlsxName, atasDir));
  const buf = nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.byteLength);

  const sheets = await X.xlsxSheets(buf);
  ok(
    'xlsxSheets: all three sheets by name (Statistics/Journal/Executions)',
    sheets.has('Statistics') && sheets.has('Journal') && sheets.has('Executions'),
    JSON.stringify([...sheets.keys()])
  );
  const journal = sheets.get('Journal') || [];
  const jHead = (journal[0] || []).map(h => String(h).trim().toLowerCase());
  ok(
    'Journal sheet header matches the documented ATAS columns',
    [
      'account',
      'instrument',
      'open time',
      'open price',
      'open volume',
      'close time',
      'close price',
      'close volume',
      'price pnl',
      'pnl',
    ].every(c => jHead.includes(c)),
    JSON.stringify(jHead)
  );

  const csv = await X.atasXlsxToCsv(buf);
  ok('atasXlsxToCsv output passes the text intake gate', I.checkCsvText(csv) === null);
  ok('real ATAS xlsx detects as atas', (A.detect(csv) || {}).id === 'atas', JSON.stringify(A.detect(csv)));
  const r = A.parse(csv);
  ok('real ATAS xlsx parses ok (non-beta, closed)', r.ok && r.platform === 'atas' && !r.beta && r.kind === 'closed', r.error);
  const jRows = journal.slice(1).filter(row => row.some(c => c !== ''));
  ok('one trade per Journal data row (20)', r.ok && r.trades.length === jRows.length && r.trades.length > 0, r.ok && r.trades.length);
  ok('every trade has a valid shape', r.ok && r.trades.every(shape));
  ok(
    'every trade carries qty, entry/exit times and a non-negative holdMs',
    r.ok && r.trades.every(t => t.qty >= 1 && t.entryTime && t.exitTime && Number.isFinite(t.holdMs) && t.holdMs >= 0)
  );
  // Net assertion: the sheet's own PnL column is the expected sum — consistency, and no NaN leaks.
  const kPnl = jHead.indexOf('pnl');
  const expNet = jRows.reduce((a, row) => a + Number(row[kPnl]), 0);
  const net = r.ok ? r.trades.reduce((a, t) => a + t.pnl, 0) : NaN;
  ok('no NaN in the sheet PnL column or the parsed trades', !isNaN(expNet) && !isNaN(net));
  ok(`net PnL matches the sheet PnL column sum (${expNet.toFixed(2)})`, r.ok && approx(net, expNet), String(net));
  // Side derivation cross-check: ATAS also signs Open volume (+1 long entry, −1 short entry) —
  // the price-move/PnL-sign derivation must agree with it on EVERY row of the real file.
  const kOV = jHead.indexOf('open volume');
  const volSides = jRows.map(row => (Number(row[kOV]) > 0 ? 'long' : 'short'));
  ok(
    'derived side agrees with the signed Open volume on all rows',
    r.ok && r.trades.every((t, i) => t.side === volSides[i]),
    r.ok && JSON.stringify(r.trades.map(t => t.side))
  );
  // Spot-check the first trade against the sheet (row 2: MES@CME_Ind long, 13:11:05 → 13:11:30, +6.25).
  const t0 = r.ok ? r.trades[0] : {};
  ok(
    'first trade fields match the sheet (time/symbol/root/side/qty/pnl/holdMs)',
    r.ok &&
      t0.entryTime === '2026-06-18 13:11:05' &&
      t0.time === '2026-06-18 13:11:30' &&
      t0.symbol === 'MES' && // '@CME_Ind' venue suffix stripped
      t0.root === 'MES' &&
      t0.side === 'long' &&
      t0.qty === 1 &&
      approx(t0.pnl, 6.25) &&
      t0.holdMs === 25000,
    JSON.stringify(t0)
  );
  ok(
    'expiry-coded instrument keeps its symbol, resolves the root (MESU6@CME_Ind → MESU6/MES)',
    r.ok && r.trades.some(t => t.symbol === 'MESU6' && t.root === 'MES')
  );

  // (b) Synthetic Journal-CSV fixture — side derivation both ways + the '@CME_Ind' strip.
  const atasCsv = `Account,Instrument,Open time,Open price,Open volume,Close time,Close price,Close volume,Price PnL,Profit (ticks),PnL,Comment
DEMO1,MESU6@CME_Ind,2026-06-18 13:11:05,7565,1,2026-06-18 13:11:30,7566.25,-1,1.25,5,6.25,
DEMO1,MESU6@CME_Ind,2026-06-18 13:50:20,7566,2,2026-06-18 13:50:36,7564.5,-2,-1.5,-6,-15,
DEMO1,MESU6@CME_Ind,2026-06-18 14:00:00,7565,-1,2026-06-18 14:01:00,7564,1,1,4,5,
DEMO1,MESU6@CME_Ind,2026-06-18 14:10:00,7564,-1,2026-06-18 14:11:00,7565.25,1,-1.25,-5,-6.25,
DEMO1,MESU6@CME_Ind,2026-06-18 15:00:00,7565,1,2026-06-18 15:01:00,7565,-1,0,0,0,scratch`;
  ok('synthetic Journal CSV detects as atas', (A.detect(atasCsv) || {}).id === 'atas', JSON.stringify(A.detect(atasCsv)));
  const rs = A.parse(atasCsv);
  const sides = rs.ok ? rs.trades.map(t => t.side) : [];
  ok(
    'long win + long loss both derive long (move sign agrees with pnl sign)',
    rs.ok && sides[0] === 'long' && sides[1] === 'long',
    JSON.stringify(sides)
  );
  ok(
    'short win + short loss both derive short (signs disagree)',
    rs.ok && sides[2] === 'short' && sides[3] === 'short',
    JSON.stringify(sides)
  );
  ok('zero-move/zero-pnl scratch row gets side "" (unknown)', rs.ok && sides[4] === '', JSON.stringify(sides));
  ok(
    'PnL column (dollars) wins over Price PnL (points); qty from |Open volume|',
    rs.ok && approx(rs.trades[1].pnl, -15) && rs.trades[1].qty === 2,
    rs.ok && JSON.stringify(rs.trades[1])
  );
  ok('synthetic symbols strip the venue suffix before rootSym', rs.ok && rs.trades.every(t => t.symbol === 'MESU6' && t.root === 'MES'));

  // F52 intake routing: .xlsx takes the allowlisted binary path; the text gates stay strict.
  ok('intake: isXlsxFile routes the real export by extension', I.isXlsxFile({ name: xlsxName, type: '' }) === true);
  ok(
    'intake: isXlsxFile routes on the xlsx MIME even without the extension',
    I.isXlsxFile({ name: 'export', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) === true
  );
  ok('intake: a .csv does not route to the xlsx path', I.isXlsxFile({ name: 'trades.csv', type: 'text/csv' }) === false);
  ok('intake: xlsx within the cap passes checkXlsxFile', I.checkXlsxFile({ name: xlsxName, size: nb.byteLength, type: '' }) === null);
  ok('intake: oversize xlsx rejects', I.checkXlsxFile({ name: 'huge.xlsx', size: I.XLSX_MAX_BYTES + 1, type: '' }) !== null);
  ok('intake: the text gates still reject raw xlsx bytes as binary', I.checkCsvText(nb.toString('latin1')) !== null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
