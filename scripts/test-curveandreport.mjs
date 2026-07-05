/* A98 — unit coverage for the two primary end-user DELIVERABLES that previously had only e2e
   render coverage (not calc coverage): the performance curve (src/lib/core/curveseries.ts dailySeries)
   and the export report (src/lib/core/report.ts buildReport). Also spot-checks costModel() with qty>1
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

const { compute, costModel, isoWeek, rateFor, blendedRateFor, loadRefData, money, tagBuckets } = await import('../src/lib/core/core.ts');
const { dailySeries } = await import('../src/lib/core/curveseries.ts');
const { buildReport } = await import('../src/lib/core/report.ts');

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

  // A156: the exports honor the configured title/account + section toggles (the download must
  // render exactly what the preview shows) — and the defaults preserve the pre-A156 payloads.
  ok('report: default md keeps the stock title + all sections', rep.reportMd.startsWith('# Blotterbook — Performance Report'));
  ok(
    'report: default md includes Summary + cost + stats',
    ['## Summary', '## Cost & tax breakdown', '## Key statistics'].every(h => rep.reportMd.includes(h))
  );
  const rep2 = buildReport(m, c, {
    ...labels,
    title: 'Q1 review',
    account: 'Apex 50k',
    sections: { kpis: true, cost: false, tax: false, advanced: false },
  });
  ok(
    'report: custom title leads the md + text + mailto',
    rep2.reportMd.startsWith('# Q1 review') &&
      rep2.reportText.startsWith('Q1 review') &&
      rep2.mailto.includes(encodeURIComponent('Q1 review'))
  );
  ok('report: account line rendered', rep2.reportMd.includes('**Account:** Apex 50k') && rep2.reportText.includes('Account: Apex 50k'));
  ok(
    'report: toggled-off sections omitted from md',
    !rep2.reportMd.includes('## Cost & tax breakdown') &&
      !rep2.reportMd.includes('## Key statistics') &&
      rep2.reportMd.includes('## Summary')
  );
  ok('report: toggled-off cost block omitted from text', !rep2.reportText.includes('Commissions:'));
}

// ── tagBuckets(): per-tag buckets over an external lookup + the DISJOINT untagged remainder (A165) ──
{
  const trades = [
    t('2026-01-05 10:00:00', 100), // scalp + fomo → counts in BOTH buckets
    t('2026-01-06 10:00:00', -40), // scalp
    t('2026-01-07 10:00:00', 60), // untagged
    t('2026-01-08 10:00:00', -10), // untagged (empty list)
  ];
  const TAGS = new Map([
    [trades[0], ['scalp', 'fomo']],
    [trades[1], ['scalp']],
    [trades[3], []],
  ]);
  const { tags, untagged } = tagBuckets(trades, tr => TAGS.get(tr) ?? []);
  const scalp = tags.get('scalp'),
    fomo = tags.get('fomo');
  ok('tagBuckets: scalp aggregates both its trades', scalp && scalp.n === 2 && scalp.pnl === 60 && scalp.wins === 1, JSON.stringify(scalp));
  ok('tagBuckets: a multi-tag trade counts once per tag', fomo && fomo.n === 1 && fomo.pnl === 100 && fomo.wins === 1);
  ok('tagBuckets: only real tags become buckets', tags.size === 2, String(tags.size));
  ok(
    'tagBuckets: untagged is the disjoint remainder (missing + empty lists)',
    untagged.n === 2 && untagged.pnl === 50 && untagged.wins === 1,
    JSON.stringify(untagged)
  );
}

// ── A171: commission-tier integrity — explicit micro list, notMicro backstop, fallback flag ──
{
  const { tierOf, rateFor } = await import('../src/lib/core/core.ts');
  // Non-M-prefixed micros must price micro now that the explicit list wins.
  for (const r of ['SIL', '2YY', '10Y', '30Y']) ok(`tierOf(${r}) === micro (explicit list)`, tierOf(r) === 'micro', tierOf(r));
  // Full-size roots newly covered by the fee table price standard with known rates.
  for (const r of ['ZN', 'ZC', '6J']) {
    ok(`tierOf(${r}) === std`, tierOf(r) === 'std', tierOf(r));
    ok(`rateFor(AMP, ${r}).known`, rateFor('AMP', r).known === true);
  }
  // MWE (full-size MGEX wheat) must NOT fall for the M-prefix heuristic: std tier, estimated rate.
  ok('tierOf(MWE) === std (notMicro backstop)', tierOf('MWE') === 'std', tierOf('MWE'));
  ok('rateFor(AMP, MWE) is flagged estimated', rateFor('AMP', 'MWE').known === false);
  // Unknown M-roots still fall back to the micro heuristic; unknown non-M roots to std.
  ok('tierOf(MXX) === micro (heuristic survives for unknowns)', tierOf('MXX') === 'micro');
  ok('tierOf(QQQ) === std (unknown non-M)', tierOf('QQQ') === 'std');
  // The estimated-rate footnote is driven by bySym.known === false.
  const { estimatedCommRoots } = await import('../src/lib/core/core.ts');
  const m = compute([t('2026-01-05 10:00:00', 100, 'MWE'), t('2026-01-06 10:00:00', 50, 'MES')]);
  const c = costModel(m, { broker: 'AMP' });
  ok('estimatedCommRoots surfaces exactly the fallback-rate roots', JSON.stringify(estimatedCommRoots(c)) === '["MWE"]');
}

// ── A173: spanMonths clamp — reversed inputs can't produce a negative subscription accrual ──
{
  const { spanMonths } = await import('../src/lib/core/core.ts');
  ok('spanMonths: missing dates → 0', spanMonths('—', '—') === 0 && spanMonths() === 0);
  ok('spanMonths: same month → 1', spanMonths('2026-03-02', '2026-03-30') === 1);
  ok('spanMonths: cross-year span counts calendar months', spanMonths('2025-11-15', '2026-02-01') === 4);
  ok('spanMonths: REVERSED input clamps to 1 (was -1 → negative subscription charge)', spanMonths('2026-03-01', '2026-01-31') === 1);
}

// ── A172: preview↔export parity — the Reports KPI strip and the exported Markdown headline agree ──
{
  const { buildReportVM } = await import('../src/app/lib/reports.ts');
  const trades = [
    t('2026-01-05 10:00:00', 200, 'MES', 'long', 1),
    t('2026-01-20 12:00:00', -50, 'NQ', 'short', 1),
    t('2026-02-10 09:45:00', 120, 'MES', 'long', 2),
  ];
  const inputs = { broker: 'AMP', platform: 50, feedCost: 15, stateRate: 5 };
  const vm = buildReportVM(trades, { scope: 'all', from: '', to: '', calYear: 2026, calMonth: 1 }, false, inputs, {
    broker: 'AMP',
    feed: 'Bundle',
    state: 'Arkansas',
    stateRate: 5,
    platform: 50,
  });
  const m = compute(trades);
  const c = costModel(m, inputs);
  const kpi = label => (vm.kpis.find(k => k.label === label) || {}).value;
  // One basis per label: the KPI strip shows the SAME numbers the export headline carries.
  ok('parity: KPI Net P&L (pre-tax) === costModel.netPreTax', kpi('Net P&L (pre-tax)') === money(c.netPreTax).replace('$', '+$'));
  ok('parity: KPI PF (net of comm.) === costModel.pf', kpi('Profit factor (net of comm.)') === c.pf.toFixed(2));
  // And both labels appear with those values in the exported Markdown of the same VM.
  ok('parity: md headline carries the same netPreTax', vm.md.includes(`| Net P&L (pre-tax) | ${money(c.netPreTax)} |`));
  ok(
    'parity: md headline carries the same commission-adjusted PF',
    vm.md.includes(`| Profit factor (net of comm.) | ${c.pf.toFixed(2)} |`)
  );
  // The old gross-basis KPI labels are gone from the preview strip.
  ok('parity: no bare gross "Net P&L" KPI remains', !vm.kpis.some(k => k.label === 'Net P&L'));
  ok('parity: no bare gross "Profit factor" KPI remains', !vm.kpis.some(k => k.label === 'Profit factor'));
  // A172: the tax table row is named for what it taxes (net P&L), not a §1256 gain.
  ok(
    'parity: tax table row renamed to Net P&L (pre-tax)',
    vm.taxRows.some(r => r[0] === 'Net P&L (pre-tax)')
  );
}

// ── A223: decimateMinMax — endpoints + extrema survive, budget respected, small series pass through ──
{
  const { decimateMinMax } = await import('../src/lib/core/curveseries.ts');
  const small = [0, 5, 3, 9, 1];
  ok(
    'decimate: small series passes through verbatim',
    JSON.stringify(decimateMinMax(small, 1500)) === JSON.stringify(small.map((v, i) => [i, v]))
  );
  // A 20k-point sawtooth with a planted global max and min.
  const big = Array.from({ length: 20000 }, (_, i) => Math.sin(i / 7) * 100);
  big[12345] = 9999; // planted global max
  big[6789] = -9999; // planted global min
  const dec = decimateMinMax(big, 1500);
  ok('decimate: within budget', dec.length <= 1500, dec.length);
  ok(
    'decimate: endpoints survive',
    dec[0][0] === 0 && dec[0][1] === big[0] && dec[dec.length - 1][0] === 19999 && dec[dec.length - 1][1] === big[19999]
  );
  ok(
    'decimate: planted extrema survive',
    dec.some(([i, v]) => i === 12345 && v === 9999) && dec.some(([i, v]) => i === 6789 && v === -9999)
  );
  ok(
    'decimate: indices strictly ordered',
    dec.every(([i], k) => k === 0 || i > dec[k - 1][0])
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
