/* A175 — dedicated unit coverage for compute() and the shared formatters (from the A66 calc audit:
   the metrics engine previously had NO suite of its own — winRate/pf/expectancy/drawdown/Sharpe/
   Sortino/streaks/concPct/sessionOf/long-short were unfixtured). Every block pins a value the audit
   hand-worked; the A168–A174 degenerate-case fixes are regression-pinned here too.

   Also: dailySeries MID-series assertions (test-curveandreport pins the endpoint), the Analytics
   histogram boundary pack, and the A169 TZ-pinned priorBounds repro (this file re-spawns itself
   with --tz-child under three timezones, because TZ must be set before node starts).

   Run: node scripts/test-compute.mjs */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// --- serve static/data/*.json to loadRefData() from disk (no network in node) ---
globalThis.fetch = async url => {
  const name = String(url).split('?')[0].split('/').pop();
  if (name === 'manifest.json') return { ok: true, json: async () => ({ files: {} }) };
  const txt = readFileSync('static/data/' + name, 'utf8');
  return { ok: true, json: async () => JSON.parse(txt) };
};

const core = await import('../src/lib/core/core.ts');
const { compute, costModel, loadRefData, sessionOf, dowBuckets, usd, money, usdWhole, axMoney, ratio, num, fmtDur, tone } = core;
await loadRefData();

// ── child mode (A169): print the prior-period Trades KPI under the spawning TZ ──
if (process.argv[2] === '--tz-child') {
  const { buildReportVM } = await import('../src/app/lib/reports.ts');
  const T = (time, pnl) => ({ time, date: time.slice(0, 10), pnl, symbol: 'MES', root: 'MES', side: 'long' });
  // April 2026 window (30 days) → the prior window is EXACTLY Mar 2..Mar 31: the +1000 trade on
  // Mar 1 must stay outside. The old epoch math under a US timezone slid the start across the
  // spring-forward day and pulled Mar 1 (and its P&L) in.
  const trades = [T('2026-03-01 10:00:00', 1000), T('2026-03-02 10:00:00', 1), T('2026-04-10 10:00:00', 5)];
  const vm = buildReportVM(
    trades,
    { scope: 'custom', from: '2026-04-01', to: '2026-04-30', calYear: 2026, calMonth: 3 },
    true,
    { broker: 'AMP' },
    { broker: 'AMP', feed: '—', state: '—', stateRate: 0, platform: 0 }
  );
  const trKpi = vm.kpis.find(k => k.label === 'Trades');
  console.log(JSON.stringify({ prior: trKpi?.prior ?? null }));
  process.exit(0);
}

let pass = 0,
  fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ok  ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + extra : ''));
  }
}
const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const t = (time, pnl, side = 'long', root = 'MES', qty = 1) => ({ time, date: time.slice(0, 10), pnl, symbol: root, root, side, qty });

// ── the hand-worked definitional set (6 trades: 3 wins / 2 losses / 1 scratch, one per day) ──
{
  const m = compute([
    t('2026-03-02 10:00:00', 100, 'long'), // Mon
    t('2026-03-03 10:00:00', -50, 'short'), // Tue
    t('2026-03-04 10:00:00', 200, 'long'), // Wed
    t('2026-03-05 10:00:00', 0, ''), // Thu (scratch, unknown side)
    t('2026-03-06 10:00:00', -100, 'short'), // Fri
    t('2026-03-09 10:00:00', 50, 'long'), // Mon
  ]);
  ok('def: counts (n/wins/losses/scratch)', m.n === 6 && m.wins === 3 && m.losses === 2 && m.scratch === 1);
  ok('def: net/gp/gl', m.net === 200 && m.gp === 350 && m.gl === -150);
  ok('def: pf = 350/150', approx(m.pf, 2.333333, 1e-5), m.pf);
  ok('def: avgW/avgL', approx(m.avgW, 116.666667, 1e-5) && m.avgL === -75);
  ok('def: wl = avgW/|avgL|', approx(m.wl, 1.555556, 1e-5), m.wl);
  ok('def: winRate counts scratches in the denominator (3/6)', m.winRate === 50, m.winRate);
  ok('def: expectancy = net/n', approx(m.expectancy, 33.333333, 1e-5));
  ok('def: per-trade std dev (population)', approx(m.tStd, 98.6013, 1e-3), m.tStd);
  ok('def: equity curve carries the leading 0', JSON.stringify(m.curve) === '[0,100,50,250,250,150,200]');
  ok('def: maxDD walk finds the deeper LATER drawdown', m.maxDD === 100 && m.maxDDpct === 40);
  ok('def: dd curve indices (peak ci3 → trough ci5)', m.ddPeakIdx === 3 && m.ddTroughIdx === 5 && m.maxDDdur === 2);
  ok('def: best/worst trade', m.best === 200 && m.worst === -100);
  ok('def: recovery = net/maxDD', approx(m.recovery, 2, 1e-9));
  // one trade per day → daily dispersion equals the per-trade one
  ok('def: Sharpe (population, daily)', approx(m.sharpe, 0.338062, 1e-4), m.sharpe);
  ok('def: Sortino (target-0 downside RMS)', approx(m.sortino, 0.730297, 1e-4), m.sortino);
  ok('def: active days / winDays / avgDaily', m.active === 6 && m.winDays === 3 && approx(m.avgDaily, 33.333333, 1e-5));
  // concPct: top-5 wins (all 3) over cent-rounded net
  ok('def: concPct = 350/200', m.concPct === 175, m.concPct);
  // long/short split + the unknown-side remainder the Analytics footnote surfaces (A170)
  ok('def: long split', m.long.n === 3 && m.long.pnl === 350 && m.long.wins === 3);
  ok('def: short split', m.short.n === 2 && m.short.pnl === -150 && m.short.wins === 0);
  ok('def: unknown side = n − long − short', m.n - m.long.n - m.short.n === 1);
  // weekday aggregation ranks by AVERAGE per trade (CH18)
  ok('def: bestDow = Wed (avg 200)', m.bestDow && m.bestDow.i === 3 && m.bestDow.avg === 200);
  ok('def: worstDow = Fri (avg −100)', m.worstDow && m.worstDow.i === 5 && m.worstDow.avg === -100);
  ok('def: first/last date follow input order', m.firstDate === '2026-03-02' && m.lastDate === '2026-03-09');
}

// ── drawdown pack: inception drawdown + never-drawn-down (A170 null/zero conventions) ──
{
  const m = compute([t('2026-01-05 10:00:00', -60), t('2026-01-06 10:00:00', -40)]);
  ok('dd: inception drawdown measures from the 0 origin', m.maxDD === 100);
  ok('dd: inception maxDDpct is null (no positive peak), not 0.0%', m.maxDDpct === null);
  ok('dd: inception indices span origin→trough', m.ddPeakIdx === 0 && m.ddTroughIdx === 2 && m.maxDDdur === 2);
  const up = compute([t('2026-01-05 10:00:00', 10), t('2026-01-06 10:00:00', 20)]);
  ok('dd: never drawn down → 0% and no indices', up.maxDD === 0 && up.maxDDpct === 0 && up.ddPeakIdx === null && up.ddTroughIdx === null);
  ok('dd: recovery is ∞ with profit and no drawdown', up.recovery === Infinity);
}

// ── streaks: counts AND dollars, scratch breaks both runs ──
{
  const m = compute([
    t('2026-01-05 10:00:00', 10),
    t('2026-01-05 10:01:00', 25),
    t('2026-01-05 10:02:00', 0),
    t('2026-01-05 10:03:00', 30),
    t('2026-01-05 10:04:00', -5),
    t('2026-01-05 10:05:00', -6),
    t('2026-01-05 10:06:00', -7),
    t('2026-01-05 10:07:00', 1),
  ]);
  ok('streaks: scratch breaks the winning run (mcw 2, not 3)', m.mcw === 2, m.mcw);
  ok('streaks: mcl counts the 3-loss run', m.mcl === 3);
  ok('streaks: largest winning streak by DOLLARS (10+25)', m.maxWinStk === 35, m.maxWinStk);
  ok('streaks: largest losing streak by DOLLARS', m.maxLossStk === -18, m.maxLossStk);
}

// ── degenerate sets: empty / one-trade / all-scratch / float-dust (A170 conventions) ──
{
  const e = compute([]);
  ok('empty: zeros not NaN where a value exists', e.n === 0 && e.net === 0 && e.winRate === 0 && e.expectancy === 0 && e.maxDD === 0);
  ok('empty: pf/wl undefined (NaN → "—"), not ∞', Number.isNaN(e.pf) && Number.isNaN(e.wl));
  ok('empty: sharpe/sortino/recovery undefined', Number.isNaN(e.sharpe) && Number.isNaN(e.sortino) && Number.isNaN(e.recovery));
  ok('empty: date sentinels', e.firstDate === '—' && e.lastDate === '—');
  const one = compute([t('2026-01-05 10:00:00', 100)]);
  ok('one-trade: pf/wl legitimately ∞ (wins, no losses)', one.pf === Infinity && one.wl === Infinity && one.winRate === 100);
  ok('one-trade: sharpe undefined (zero dispersion), sortino ∞ (no downside)', Number.isNaN(one.sharpe) && one.sortino === Infinity);
  const scr = compute([t('2026-01-05 10:00:00', 0), t('2026-01-06 10:00:00', 0)]);
  ok('all-scratch: pf/wl undefined, NOT ∞ (matches costModel.pf — A170)', Number.isNaN(scr.pf) && Number.isNaN(scr.wl));
  const dust = compute([t('2026-01-05 10:00:00', 0.1), t('2026-01-06 10:00:00', 0.2), t('2026-01-07 10:00:00', -0.3)]);
  ok('float-dust: concPct null on a cent-rounded $0 net (was ~5.4e17%)', dust.concPct === null, dust.concPct);
}

// ── sessionOf: half-open 09:30–16:00 boundaries ──
{
  const at = time => sessionOf({ time });
  ok('sessionOf: 09:29:59 → eth', at('2026-01-05 09:29:59') === 'eth');
  ok('sessionOf: 09:30:00 → rth (inclusive open)', at('2026-01-05 09:30:00') === 'rth');
  ok('sessionOf: 15:59:59 → rth', at('2026-01-05 15:59:59') === 'rth');
  ok('sessionOf: 16:00:00 → eth (exclusive close)', at('2026-01-05 16:00:00') === 'eth');
  ok('sessionOf: missing time → eth', at('') === 'eth');
}

// ── dowBuckets: Sun-first indexing, all 7 buckets ──
{
  const d = dowBuckets([t('2026-03-01 10:00:00', 40), t('2026-03-02 10:00:00', 10), t('2026-03-07 10:00:00', -5)]); // Sun/Mon/Sat
  ok('dowBuckets: 7 buckets, Sun=0 and Sat=6 populated', d.length === 7 && d[0].pnl === 40 && d[1].pnl === 10 && d[6].pnl === -5);
  ok('dowBuckets: untraded weekdays stay zeroed', d[3].n === 0 && d[3].pnl === 0);
}

// ── formatting suite: usd/money/usdWhole/axMoney/ratio/num/fmtDur/tone ──
{
  ok('usd: signs + grouping', usd(1234.5) === '+$1,234.50' && usd(-1234.5) === '-$1,234.50' && usd(0) === '$0.00');
  ok('usd: sub-cent residue clamps to unsigned $0.00 (A170)', usd(-1e-13) === '$0.00' && usd(0.004) === '$0.00');
  ok('usd: ∞ passes through', usd(Infinity) === '∞');
  ok('money: unsigned form', money(1234.5) === '$1,234.50' && money(-56) === '-$56.00');
  ok(
    'usdWhole: sign from the ROUNDED value (A170)',
    usdWhole(-0.4) === '+$0' && usdWhole(-0.6) === '-$1' && usdWhole(1234.4) === '+$1,234'
  );
  ok('axMoney: threshold on the rounded value (A174)', axMoney(999.4) === '$999' && axMoney(999.5) === '$1.0k');
  ok('axMoney: k tiers', axMoney(1234) === '$1.2k' && axMoney(9999.6) === '$10k' && axMoney(-3400) === '-$3.4k');
  ok('axMoney: M tier (A174)', axMoney(1.5e6) === '$1.5M' && axMoney(1e7) === '$10M');
  ok('ratio: ∞ / NaN / finite', ratio(Infinity) === '∞' && ratio(NaN) === '—' && ratio(7 / 3) === '2.33');
  ok('num: matches ratio conventions (A170)', num(Infinity) === '∞' && num(NaN) === '—' && num(0.338) === '0.34');
  ok('fmtDur: tiers', fmtDur(45000) === '45s' && fmtDur(12 * 60000) === '12m' && fmtDur(3 * 3600000 + 20 * 60000) === '3h 20m');
  ok('tone: $0 (and sub-cent residue) is NEUTRAL, not green (A170)', tone(0) === undefined && tone(0.004) === undefined);
  ok('tone: pos/neg', tone(1) === 'pos' && tone(-1) === 'neg');
}

// ── Analytics histogram: boundary pack + scratch exclusion (A174) ──
{
  const { buildAnalytics } = await import('../src/app/lib/analytics.ts');
  const trades = [
    t('2026-01-05 10:00:00', 0), // scratch — excluded from the histogram entirely
    t('2026-01-05 10:01:00', -200), // half-open: lands in '-200..-100', not '<-200'
    t('2026-01-05 10:02:00', -200.01), // strictly below → '<-200'
    t('2026-01-05 10:03:00', 200), // top bucket is inclusive → '≥200'
    t('2026-01-05 10:04:00', 199.99), // '100..200'
    t('2026-01-05 10:05:00', 25), // '0..50'
  ];
  const vm = buildAnalytics(compute(trades), trades, () => []);
  const bucket = label => vm.dist.find(b => b.label === label)?.value;
  ok('hist: scratch excluded (counts sum to 5 of 6)', vm.dist.reduce((a, b) => a + b.value, 0) === 5);
  ok('hist: scratch count surfaced for the footnote', vm.scratch === 1);
  ok('hist: -200 in -200..-100 (half-open)', bucket('-200..-100') === 1 && bucket('<-200') === 1);
  ok('hist: 200 in the ≥200 bucket', bucket('≥200') === 1 && bucket('100..200') === 1);
  ok('hist: unknown-side remainder exposed (A170)', vm.unknownSide === 6 - vm.long.n - vm.short.n);
}

// ── dailySeries MID-series assertions (endpoint reconciliation lives in test-curveandreport) ──
{
  const { dailySeries } = await import('../src/lib/core/curveseries.ts');
  const trades = [t('2026-01-05 10:00:00', 100, 'long', 'MES', 1), t('2026-03-10 10:00:00', 50, 'long', 'MES', 2)];
  const m = compute(trades);
  const c = costModel(m, { broker: 'AMP', platform: 10, feedCost: 0, stateRate: 0 });
  const { pts } = dailySeries(m, { broker: 'AMP', tEff: 0.25, fixedMo: 10 });
  // AMP micro: 0.25 comm + 0.35 exch per side → $1.20 round-turn per contract.
  const p1 = pts[0];
  ok('series: day-1 gross', p1.gross === 100);
  ok('series: day-1 net = gross − comm − month-1 accrual', approx(p1.net, 100 - 1.2 - 10, 1e-9), p1.net);
  ok('series: day-1 take taxes the cumulative net', approx(p1.take, (100 - 1.2 - 10) * 0.75, 1e-9), p1.take);
  const p2 = pts[1];
  ok('series: gap month accrues (Jan+Feb+Mar = 3 × fixedMo)', approx(p2.net, 150 - 3.6 - 30, 1e-9), p2.net);
  ok('series: endpoint net === costModel netPreTax basis', approx(p2.net, c.gross - c.totalComm - c.fixedPeriod, 1e-9));
}

// ── A208: actual CSV commissions override the modeled tier rate ──
{
  const { estimatedCommRoots } = core;
  // AMP micro: 0.25 comm + 0.35 exch per side → $1.20 round-turn per contract (modeled).
  const withActual = { ...t('2026-01-05 10:00:00', 100), commission: 4.44 };
  const modeled = t('2026-01-06 10:00:00', 50);
  const m = compute([withActual, modeled]);
  const c = costModel(m, { broker: 'AMP', platform: 0, feedCost: 0, stateRate: 0 });
  ok('A208: actual commission used verbatim + modeled for the rest', approx(c.totalComm, 4.44 + 1.2, 1e-9), c.totalComm);
  ok('A208: actual counters surface the mix', c.actualCommTrades === 1 && approx(c.actualComm, 4.44, 1e-9));
  ok(
    'A208: bySym reconciles (total = actual + modeled, actual counted)',
    approx(c.bySym[0].total, 5.64, 1e-9) && c.bySym[0].actual === 1 && c.bySym[0].count === 2
  );
  // A zero commission is REAL data (a free fill), not "missing" — must not fall back to the model.
  const cz = costModel(compute([{ ...t('2026-01-05 10:00:00', 100), commission: 0 }]), { broker: 'AMP' });
  ok('A208: commission 0 is honored (no model fallback)', cz.totalComm === 0 && cz.actualCommTrades === 1);
  // An unknown root normally gets the estimated-rate asterisk — but not when ALL its trades are actual.
  const unk = costModel(compute([{ ...t('2026-01-05 10:00:00', 100, 'long', 'ZZZZ'), commission: 2 }]), { broker: 'AMP' });
  ok('A208: all-actual unknown root drops the estimate asterisk', estimatedCommRoots(unk).length === 0);
  const unk2 = costModel(compute([t('2026-01-05 10:00:00', 100, 'long', 'ZZZZ')]), { broker: 'AMP' });
  ok('A171 regression: modeled unknown root still asterisked', estimatedCommRoots(unk2).includes('ZZZZ'));
  // The daily curve applies the same rule, so the endpoint still reconciles.
  const { dailySeries } = await import('../src/lib/core/curveseries.ts');
  const { pts } = dailySeries(m, { broker: 'AMP', tEff: 0, fixedMo: 0 });
  ok('A208: curve endpoint reconciles with actual commissions', approx(pts[pts.length - 1].net, c.gross - c.totalComm, 1e-9));
}

// ── A188: the event bus replay buffer — late subscribers can backfill boot events ──
{
  const { emit, busLog, onEvent } = core;
  const before = busLog().length;
  emit('test:boot', { n: 1 });
  emit('test:boot', { n: 2 });
  ok(
    'bus: emits are recorded in busLog with a timestamp',
    busLog().length === before + 2 && busLog()[busLog().length - 1].at instanceof Date
  );
  ok(
    'bus: entries carry name + detail for backfill formatting',
    busLog()[busLog().length - 1].name === 'test:boot' && busLog()[busLog().length - 1].detail.n === 2
  );
  // Live subscription still works alongside the log.
  let got = null;
  const off = onEvent('test:live', d => (got = d));
  emit('test:live', { hello: true });
  off();
  ok('bus: live onEvent still fires (and unsubscribes)', got && got.hello === true);
  // The buffer is a ring: it never exceeds 50 entries.
  for (let i = 0; i < 60; i++) emit('test:flood', { i });
  ok('bus: replay buffer caps at 50 entries (ring)', busLog().length === 50, busLog().length);
  ok('bus: ring keeps the NEWEST entries', busLog()[busLog().length - 1].detail.i === 59);
}

// ── A194: dowPnlRows — the Calendar 'By weekday' bucket/filter rule (A174) ──
{
  const { dowPnlRows } = core;
  const rows = dowPnlRows([
    { dow: 0, pnl: 40 }, // Sunday Globex session — must appear
    { dow: 1, pnl: 10 },
    { dow: 1, pnl: 5 },
    { dow: 5, pnl: -20 },
  ]);
  ok(
    'dowPnlRows: Sunday row present when it carries P&L',
    rows.some(r => r.i === 0 && r.pnl === 40)
  );
  ok('dowPnlRows: weekday buckets sum', rows.find(r => r.i === 1)?.pnl === 15 && rows.find(r => r.i === 5)?.pnl === -20);
  ok(
    'dowPnlRows: Mon–Fri always present (zeros included)',
    [1, 2, 3, 4, 5].every(i => rows.some(r => r.i === i))
  );
  ok('dowPnlRows: quiet Saturday dropped', !rows.some(r => r.i === 6));
  ok('dowPnlRows: rows reconcile with the input total', rows.reduce((a, r) => a + r.pnl, 0) === 35);
  const quiet = dowPnlRows([{ dow: 2, pnl: 100 }]);
  ok('dowPnlRows: no weekend rows on a weekday-only month', quiet.length === 5 && quiet[0].i === 1);
  ok(
    'dowPnlRows: out-of-range dow ignored',
    dowPnlRows([{ dow: 9, pnl: 5 }]).every(r => r.pnl === 0)
  );
}

// ── A194: pickFlavor — header flavor text ──
{
  const { FLAVOR_PHRASES, pickFlavor } = await import('../src/app/lib/flavor.ts');
  ok('flavor: list is non-trivial', FLAVOR_PHRASES.length >= 20);
  let all = true;
  for (let i = 0; i < 200; i++) if (!FLAVOR_PHRASES.includes(pickFlavor())) all = false;
  ok('flavor: pick always returns a member of the list', all);
  ok('flavor: empty list degrades to empty string', pickFlavor([]) === '');
}

// ── A169: priorBounds is DST-safe — pinned under three timezones via child processes ──
{
  for (const tz of ['UTC', 'America/New_York', 'Australia/Lord_Howe']) {
    const r = spawnSync(process.execPath, [process.argv[1], '--tz-child'], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    let prior = null;
    try {
      prior = JSON.parse((r.stdout || '').trim().split('\n').pop()).prior;
    } catch {
      /* fall through to the assertion with the raw output */
    }
    ok(`priorBounds: prior Trades === 1 under TZ=${tz} (Mar 1 stays out of Apr's prior window)`, prior === '1', r.stdout || r.stderr);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
