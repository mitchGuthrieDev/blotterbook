/* A98 — unit coverage for the two primary end-user DELIVERABLES that previously had only e2e
   render coverage (not calc coverage): the performance curve (src/lib/curveseries.ts dailySeries)
   and the export report (src/lib/report.ts buildReport). Also spot-checks costModel() with qty>1
   trades and the isoWeek() 52/53 boundary. Pure-logic only (A29).

   The cost model + curve read live reference data (broker/exchange tables) that the app fetches via
   loadRefData(); here we stub global.fetch to serve the committed static/data/*.json from disk so
   the math runs against the real rate tables. Run: node scripts/test-curveandreport.mjs */
import { readFileSync } from 'node:fs';

// --- serve static/data/*.json to loadRefData() from disk (no network in node) ---
globalThis.fetch = async url => {
  const name = String(url).split('?')[0].split('/').pop();
  if (name === 'manifest.json') return { ok: true, json: async () => ({ files: {} }) };
  const txt = readFileSync('static/data/' + name, 'utf8');
  return { ok: true, json: async () => JSON.parse(txt) };
};

const { compute, costModel, isoWeek, rateFor, blendedRateFor, loadRefData, money } = await import('../src/lib/core.ts');
const { dailySeries } = await import('../src/lib/curveseries.ts');
const { buildReport } = await import('../src/lib/report.ts');

await loadRefData();

let pass = 0,
  fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ok  ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '  → ' + extra : ''));
  }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
// trade factory: t('2026-01-05 10:30:00', pnl, root, side, qty)
const t = (time, pnl, root = 'MES', side = 'long', qty = 1) => ({
  time,
  date: time.slice(0, 10),
  pnl,
  symbol: root + 'H2026',
  root,
  side,
  qty,
});

console.log('A98 — curveseries / report / costModel(qty) / isoWeek');

// ── isoWeek() — ISO-8601 week-of-year, incl. the 52/53 boundary (use numeric ctor → TZ-stable) ──
ok('isoWeek: 2026-01-01 (Thu) is week 1', isoWeek(new Date(2026, 0, 1)) === 1, String(isoWeek(new Date(2026, 0, 1))));
ok('isoWeek: 2021-01-04 (Mon) is week 1', isoWeek(new Date(2021, 0, 4)) === 1, String(isoWeek(new Date(2021, 0, 4))));
ok('isoWeek: 2020-12-31 (Thu) is week 53', isoWeek(new Date(2020, 11, 31)) === 53, String(isoWeek(new Date(2020, 11, 31))));
ok('isoWeek: 2021-01-01 (Fri) is still week 53 of 2020', isoWeek(new Date(2021, 0, 1)) === 53, String(isoWeek(new Date(2021, 0, 1))));
ok('isoWeek: 2019-12-30 (Mon) is week 1 of 2020', isoWeek(new Date(2019, 11, 30)) === 1, String(isoWeek(new Date(2019, 11, 30))));

// ── costModel() with qty>1: round-turn = rate × 2 × qty, contracts = Σqty ──
{
  const rate = rateFor('AMP', 'MES').rate;
  const trades = [t('2026-01-05 10:00:00', 100, 'MES', 'long', 2), t('2026-01-06 11:00:00', -40, 'MES', 'short', 3)];
  const m = compute(trades);
  const c = costModel(m, { broker: 'AMP' });
  ok('costModel: contracts = Σqty (2+3=5)', c.contracts === 5, String(c.contracts));
  ok('costModel: totalComm = rate×2×Σqty', approx(c.totalComm, rate * 2 * 5), `${c.totalComm} vs ${rate * 2 * 5}`);
  const sym = c.bySym.find(s => s.root === 'MES');
  ok('costModel: bySym MES count=2, qty=5', sym && sym.count === 2 && sym.qty === 5, JSON.stringify(sym));
  ok('costModel: bySym MES total = rate×2×5', sym && approx(sym.total, rate * 2 * 5), sym && String(sym.total));
  // qty scales commission linearly: a qty=2 trade costs exactly 2× a qty=1 trade.
  const c1 = costModel(compute([t('2026-01-05 10:00:00', 0, 'MES', 'long', 1)]), { broker: 'AMP' });
  const c2 = costModel(compute([t('2026-01-05 10:00:00', 0, 'MES', 'long', 2)]), { broker: 'AMP' });
  ok('costModel: qty=2 commission is 2× qty=1', approx(c2.totalComm, c1.totalComm * 2), `${c2.totalComm} vs ${c1.totalComm * 2}`);
  // Σ of per-symbol totals reconciles with totalComm.
  ok(
    'costModel: Σ bySym.total === totalComm',
    approx(
      c.bySym.reduce((a, s) => a + s.total, 0),
      c.totalComm
    )
  );
}

// ── dailySeries(): subscription accrual once per DISTINCT month + reconciles with costModel ──
{
  // Trades across 3 distinct months → fixedPeriod = fixedMo × 3.
  const trades = [
    t('2026-01-05 10:00:00', 200, 'MES', 'long', 1),
    t('2026-01-20 12:00:00', -50, 'MES', 'short', 1),
    t('2026-02-10 09:45:00', 120, 'MES', 'long', 2),
    t('2026-03-03 14:00:00', 80, 'MES', 'long', 1),
  ];
  const m = compute(trades);
  const inputs = { broker: 'AMP', platform: 50, feedCost: 15, stateRate: 5 };
  const c = costModel(m, inputs);
  const tEff = blendedRateFor(5);
  const ser = dailySeries(m, { broker: 'AMP', tEff, fixedMo: 50 + 15 });
  const last = ser.pts[ser.pts.length - 1];
  ok('dailySeries: 3 distinct months counted', m.months === 3, String(m.months));
  ok('dailySeries: one point per trading day (4)', ser.pts.length === 4, String(ser.pts.length));
  ok('dailySeries: final gross = Σ pnl = compute().net', approx(last.gross, m.net), `${last.gross} vs ${m.net}`);
  ok('dailySeries: final net reconciles with costModel.netPreTax', approx(last.net, c.netPreTax), `${last.net} vs ${c.netPreTax}`);
  ok('dailySeries: final take reconciles with costModel.afterTax', approx(last.take, c.afterTax), `${last.take} vs ${c.afterTax}`);
  // net is monotone-cumulative on gross; take applies tax only on positive net.
  ok('dailySeries: take = net − tax(net) on positive net', approx(last.take, last.net - last.net * tEff), `${last.take}`);
}

// ── A117: subscriptions accrue over the ELAPSED SPAN (gap months billed), not just active months ──
{
  // Trades in Jan and Mar only — Feb has none. Span = 3 months (Jan,Feb,Mar); active months = 2.
  const trades = [t('2026-01-10 10:00:00', 100, 'MES', 'long', 1), t('2026-03-10 10:00:00', 100, 'MES', 'long', 1)];
  const m = compute(trades);
  const c = costModel(m, { broker: 'AMP', platform: 30, feedCost: 0, stateRate: 0 });
  ok('A117: compute active months = 2', m.months === 2, String(m.months));
  ok('A117: costModel bills the full 3-month span', c.months === 3 && approx(c.fixedPeriod, 30 * 3), `${c.months} / ${c.fixedPeriod}`);
  // The curve must still reconcile with costModel under the span accrual.
  const ser = dailySeries(m, { broker: 'AMP', tEff: 0, fixedMo: 30 });
  const last = ser.pts[ser.pts.length - 1];
  ok('A117: curve endpoint reconciles with costModel.netPreTax (span)', approx(last.net, c.netPreTax), `${last.net} vs ${c.netPreTax}`);
}

// ── dailySeries(): single month accrues the subscription exactly once ──
{
  const trades = [t('2026-04-02 10:00:00', 300, 'MES', 'long', 1), t('2026-04-15 11:00:00', -100, 'MES', 'short', 1)];
  const m = compute(trades);
  const ser = dailySeries(m, { broker: 'AMP', tEff: 0, fixedMo: 99 });
  const last = ser.pts[ser.pts.length - 1];
  const comm = rateFor('AMP', 'MES').rate * 2 * 2;
  ok('dailySeries: single month subtracts fixedMo once', approx(last.net, 200 - comm - 99), `${last.net}`);
  ok('dailySeries: tEff=0 → take === net', approx(last.take, last.net), `${last.take} vs ${last.net}`);
}

// ── dailySeries(): negative net is not taxed (take === net) ──
{
  const trades = [t('2026-05-04 10:00:00', -500, 'MES', 'short', 1)];
  const m = compute(trades);
  const ser = dailySeries(m, { broker: 'AMP', tEff: 0.3, fixedMo: 65 });
  const last = ser.pts[ser.pts.length - 1];
  ok('dailySeries: negative net is untaxed (take === net)', last.net < 0 && approx(last.take, last.net), `${last.take} vs ${last.net}`);
}

// ── buildReport(): faithfully reflects compute()/costModel() (no internal disagreement) ──
{
  const trades = [
    t('2026-01-05 10:00:00', 200, 'MES', 'long', 1),
    t('2026-01-20 12:00:00', -50, 'NQ', 'short', 1),
    t('2026-02-10 09:45:00', 120, 'MES', 'long', 2),
  ];
  const m = compute(trades);
  const c = costModel(m, { broker: 'AMP', platform: 50, feedCost: 15, stateRate: 5 });
  const labels = {
    broker: 'AMP',
    feed: 'Bundle',
    state: 'Arkansas',
    scope: 'all time',
    stateRate: 5,
    platform: 50,
    generated: new Date(2026, 5, 29, 9, 30),
  };
  const rep = buildReport(m, c, labels);
  const headVal = name => (rep.headline.find(r => r[0] === name) || [])[1];
  const costVal = name => (rep.costRows.find(r => r[0] === name) || [])[1];
  ok(
    'report: Net P&L tile === money(costModel.netPreTax)',
    headVal('Net P&L (pre-tax)') === money(c.netPreTax),
    headVal('Net P&L (pre-tax)')
  );
  ok(
    'report: Take-home tile === money(costModel.afterTax)',
    headVal('Take-home (post-tax)') === money(c.afterTax),
    headVal('Take-home (post-tax)')
  );
  ok('report: Gross tile === money(compute.net)', headVal('Gross P&L') === money(m.net), headVal('Gross P&L'));
  ok('report: Trades tile === compute.n', headVal('Trades') === String(m.n), headVal('Trades'));
  ok('report: cost-breakdown net row === money(netPreTax)', costVal('Net P&L (pre-tax)') === money(c.netPreTax));
  ok('report: cost-breakdown take-home === money(afterTax)', costVal('After-tax take-home') === money(c.afterTax));
  // commission rows mirror costModel.bySym exactly (one row per symbol, totals match).
  ok('report: commRows count === bySym count', rep.commRows.length === c.bySym.length, `${rep.commRows.length} vs ${c.bySym.length}`);
  const commOk = rep.commRows.every((row, i) => row.total === money(c.bySym[i].total) && row.qty === c.bySym[i].qty);
  ok('report: each commRow total/qty matches its bySym entry', commOk);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
