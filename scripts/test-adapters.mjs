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

  motivewave: `Instrument,Side,Quantity,Entry Time,Entry Price,Exit Time,Exit Price,P/L
MESM2025,Buy,1,2026-06-02 09:31:00,5300.00,2026-06-02 09:45:00,5310.00,50.00
MNQM2025,Sell,1,2026-06-02 10:00:00,18010.00,2026-06-02 10:20:00,18000.00,20.00`,

  tradovate: `orderId,Account,B/S,Contract,Product,filledQty,Fill Time,Avg Fill Price
1,DEMO,Buy,MESM2025,MES,1,2026-06-02 09:31:00,5300.00
2,DEMO,Sell,MESM2025,MES,1,2026-06-02 09:45:00,5310.00`,

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
