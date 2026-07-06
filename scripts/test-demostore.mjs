#!/usr/bin/env node
/* A31 — DemoStore (app/demostore.js): the in-memory Store used by the DEMO surface so demo never
   persists. Verifies it implements the Store interface with correct semantics (dedupe, sort,
   journal/meta/trademeta roundtrips, screenshot allow-list, purge) and that importing/using it in
   plain Node never touches IndexedDB or localStorage (neither exists here — any reference would
   throw). Runs with Node built-ins only. */
import assert from 'node:assert/strict';
import { createDemoStore } from '../src/lib/core/demostore.ts';

let pass = 0;
const ok = (name, cond) => {
  assert.ok(cond, name);
  console.log('  ok  ' + name);
  pass++;
};

console.log('A31 — DemoStore in-memory persistence seam');

const t = (time, pnl, root = 'MES', side = 'long') => ({
  time,
  date: time.slice(0, 10),
  pnl,
  symbol: root + 'H2026',
  root,
  side,
});

const s = createDemoStore();

// interface presence
for (const m of [
  'available',
  'init',
  'addTrades',
  'getAllTrades',
  'tradeCount',
  'saveJournal',
  'getJournal',
  'journalDates',
  'saveTradeMeta',
  'allTradeMeta',
  'getMeta',
  'setMeta',
  'exportAll',
  'importAll',
  'purge',
  'tradeId',
  'validShot',
  'getTombstones',
  'activeWorkspace',
  'listWorkspaces',
  'createWorkspace',
  'renameWorkspace',
  'deleteWorkspace',
  'setActiveWorkspace',
]) {
  ok('implements ' + m, typeof s[m] === 'function');
}
ok('available() is true', s.available() === true);
ok('has a local shim', s.local && typeof s.local.get === 'function');

// addTrades dedupe (same id twice) + total
const r1 = await s.addTrades([t('2026-01-02 10:00:00', 100), t('2026-01-01 09:30:00', -50)]);
ok('addTrades reports added=2', r1.added === 2 && r1.total === 2);
const r2 = await s.addTrades([t('2026-01-02 10:00:00', 100)]); // identical → duplicate
ok('addTrades dedupes identical trade', r2.added === 0 && r2.duplicate === 1);

// getAllTrades sorted by time ascending
const all = await s.getAllTrades();
ok('getAllTrades sorted by time', all.length === 2 && all[0].date === '2026-01-01' && all[1].date === '2026-01-02');
ok('tradeCount matches', (await s.tradeCount()) === 2);

// journal roundtrip + delete-on-empty
await s.saveJournal('2026-01-02', { text: 'good day', tags: ['a', ''], shots: [] });
ok('getJournal returns saved text', (await s.getJournal('2026-01-02')).text === 'good day');
ok('journalDates has the date', (await s.journalDates()).has('2026-01-02'));
// A153/A161: lock in the canonical tag form — every write runs cleanTags (trim + lowercase +
// strip markup + dedupe), the SAME rule the real Store and backup restore apply.
await s.saveJournal('2026-01-02', { text: 'good day', tags: ['Scalp', 'scalp', ' <b>X&Y</b> ', ''], shots: [] });
{
  const tags = (await s.getJournal('2026-01-02')).tags;
  ok(
    'tags canonicalized (lowercase + markup-strip + dedupe)',
    tags.length === 2 && tags[0] === 'scalp' && tags[1] === 'bxy/b',
    tags.join('|')
  );
}
await s.saveJournal('2026-01-02', { text: '', tags: [], shots: [] });
ok('empty save deletes the note', !(await s.journalDates()).has('2026-01-02'));

// meta roundtrip
await s.setMeta('setup', { broker: 'AMP' });
ok('getMeta returns value', (await s.getMeta('setup')).broker === 'AMP');

// trademeta + screenshot allow-list (validShot reused from store.js)
const goodShot = 'data:image/png;base64,AAAA';
const badShot = 'data:text/html;base64,AAAA';
await s.saveTradeMeta('id1', { tags: ['setup'], note: 'n', shots: [goodShot, badShot] });
const tm = (await s.allTradeMeta())[0];
ok('trademeta saved with tag', tm && tm.tags[0] === 'setup');
ok('rejects non-image screenshot', tm.shots.length === 1 && tm.shots[0] === goodShot);

// importAll is a no-op on demo (restore disabled)
const imp = await s.importAll({ trades: [t('2025-01-01 10:00:00', 5)] });
ok('importAll is a no-op', imp.added === 0 && (await s.tradeCount()) === 2);

// exportAll shape
const dump = await s.exportAll();
ok('exportAll has app + trades', dump.app === 'blotterbook' && Array.isArray(dump.trades));
ok('exportAll carries the CSV library (F37)', Array.isArray(dump.files) && Array.isArray(dump.filetexts));

// F37: per-file provenance methods (in-memory parity with the real Store)
const rec = {
  id: 'aaaa1111',
  name: 'a.csv',
  platform: 'tradingview',
  platformLabel: 'TradingView',
  size: 10,
  rows: 2,
  tradeCount: 2,
  overlap: 0,
  from: '2025-01-01',
  to: '2025-01-02',
  imported: '2026-07-04T00:00:00Z',
  included: true,
};
await s.addFile(rec, 'raw,text');
ok('addFile/getFiles roundtrip', (await s.getFiles())[0].name === 'a.csv');
ok('getFileText returns the raw text', (await s.getFileText('aaaa1111')) === 'raw,text');
await s.updateFile('aaaa1111', { label: 'Renamed', included: false });
const fUpd = (await s.getFiles())[0];
ok('updateFile patches label/included (id fixed)', fUpd.label === 'Renamed' && fUpd.included === false && fUpd.id === 'aaaa1111');
ok('filesBytes sums stored sizes', (await s.filesBytes()) === 10);
await s.updateFile('aaaa1111', { broker: 'SCHWAB' });
ok('updateFile sets a broker override (A211)', (await s.getFiles())[0].broker === 'SCHWAB');
await s.updateFile('aaaa1111', { broker: undefined });
ok('updateFile clears the broker override', (await s.getFiles())[0].broker === undefined);
// provenance merge on duplicate + the deleteFile cascade
await s.purge();
await s.addTrades([{ ...t('2025-02-01 10:00:00', 5), fileIds: ['f1'] }]);
await s.addTrades([
  { ...t('2025-02-01 10:00:00', 5), fileIds: ['f2'] }, // duplicate → merges provenance
  { ...t('2025-02-02 10:00:00', 7), fileIds: ['f2'] }, // exclusive to f2
]);
const merged = await s.getAllTrades();
ok('duplicate import merges fileIds (overlap keeps both files)', merged[0].fileIds.length === 2);
const del = await s.deleteFile('f2');
ok('deleteFile removes exclusive trades, keeps shared ones', del.removedTrades === 1 && (await s.tradeCount()) === 1);
ok('surviving trade lost the deleted file id', (await s.getAllTrades())[0].fileIds.join() === 'f1');
// A176: a RICHER duplicate enriches missing fields (either import order) without touching identity.
await s.purge();
await s.addTrades([t('2025-03-01 10:00:00', 25)]); // balance-history fidelity: no qty/hold/comm
await s.addTrades([{ ...t('2025-03-01 10:00:00', 25), qty: 2, holdMs: 60000, entryTime: '2025-03-01 09:59:00', commission: 1.5 }]);
{
  const e = (await s.getAllTrades())[0];
  ok(
    'richer duplicate enriches qty/holdMs/entryTime/commission',
    e.qty === 2 && e.holdMs === 60000 && e.entryTime === '2025-03-01 09:59:00' && e.commission === 1.5 && e.pnl === 25
  );
}
// …and never OVERWRITES a value the stored record already has.
await s.addTrades([{ ...t('2025-03-01 10:00:00', 25), qty: 9, holdMs: 1, commission: 99 }]);
{
  const e = (await s.getAllTrades())[0];
  ok('enrichment never overwrites existing values', e.qty === 2 && e.holdMs === 60000 && e.commission === 1.5);
}

// local shim is in-memory (no localStorage)
s.local.set('k', { v: 1 });
ok('local.get reads back', s.local.get('k').v === 1);
ok('local.get fallback', s.local.get('missing', 'fb') === 'fb');

// ── A236: export v3 — Store.local layouts folded in + a payload checksum ──
{
  const { sha256Hex, LOCAL_BACKUP_RE } = await import('../src/lib/core/store.ts');
  // The key filter selects the dashboard layout keys and excludes bb:flags / foreign keys.
  ok(
    'A236: LOCAL_BACKUP_RE matches dash layout keys',
    LOCAL_BACKUP_RE.test('bb:dashTabs') &&
      LOCAL_BACKUP_RE.test('bb:dashModules') &&
      LOCAL_BACKUP_RE.test('bb:dashModules:main') &&
      LOCAL_BACKUP_RE.test('bb:dashLayouts') &&
      LOCAL_BACKUP_RE.test('bb:staging:dashModules')
  );
  ok(
    'A236: LOCAL_BACKUP_RE excludes bb:flags and foreign keys',
    !LOCAL_BACKUP_RE.test('bb:flags') && !LOCAL_BACKUP_RE.test('theme') && !LOCAL_BACKUP_RE.test('bb:store')
  );

  const s3 = createDemoStore();
  await s3.addTrades([t('2026-01-02 10:00:00', 100)]);
  s3.local.set('bb:dashTabs', { tabs: [{ id: 'main', name: 'Main' }], active: 'main' });
  s3.local.set('bb:dashModules', ['pnl', 'winrate']);
  s3.local.set('bb:flags', { ACCOUNT_GATE: false }); // must NOT travel into the backup
  const dump = await s3.exportAll();
  ok('A236: exportAll is version 3', dump.version === 3);
  ok(
    'A236: exportAll folds the dash layout keys into local',
    dump.local && dump.local['bb:dashTabs'] && Array.isArray(dump.local['bb:dashModules']) && dump.local['bb:dashModules'][0] === 'pnl'
  );
  ok('A236: exportAll excludes bb:flags from the backup', !('bb:flags' in (dump.local || {})));
  ok('A236: exportAll carries a 64-hex SHA-256 checksum', typeof dump.checksum === 'string' && /^[0-9a-f]{64}$/.test(dump.checksum));
  // The checksum covers the payload MINUS itself (added last), and validates on recompute — the same
  // check Store.importAll runs. A v2 envelope carries no checksum, so import skips verification.
  const { checksum, ...rest } = dump;
  ok('A236: checksum verifies over the payload', (await sha256Hex(JSON.stringify(rest))) === checksum);
  const tampered = { ...rest, trades: [...rest.trades, t('2020-01-01 00:00:00', -999)] };
  ok('A236: a modified payload fails the checksum (corruption detected)', (await sha256Hex(JSON.stringify(tampered))) !== checksum);
  // Demo restore stays a no-op (never persists) even for a v3 envelope.
  const imp3 = await s3.importAll(dump);
  ok('A236: demo importAll ignores a v3 backup (never persists)', imp3.added === 0);
}

// ── F58: delete tombstones + `updated` audit (suppress re-import resurrection) ──
{
  // (a) delete a trade → re-addTrades the same trade → it stays deleted (not resurrected).
  const sf = createDemoStore();
  await sf.addTrades([t('2026-05-01 10:00:00', 40)]);
  const id = sf.tradeId(t('2026-05-01 10:00:00', 40));
  await sf.deleteTrade(id);
  ok(
    'F58: deleteTrade records a trade tombstone',
    (await sf.getTombstones()).some(tb => tb.id === id && tb.type === 'trade')
  );
  const re = await sf.addTrades([t('2026-05-01 10:00:00', 40)]); // re-import the identical trade
  ok('F58: a deleted trade is NOT resurrected by re-import', re.added === 0 && (await sf.tradeCount()) === 0);
}
{
  // (b) a tombstone is recorded on each delete path.
  const sf = createDemoStore();
  await sf.saveJournal('2026-05-02', { text: 'x' });
  await sf.deleteJournal('2026-05-02');
  ok(
    'F58: deleteJournal tombstones the date',
    (await sf.getTombstones()).some(tb => tb.id === '2026-05-02' && tb.type === 'journal')
  );
  await sf.saveTradeMeta('bbbb2222', { note: 'n' });
  await sf.deleteTradeMeta('bbbb2222');
  ok(
    'F58: deleteTradeMeta tombstones the id',
    (await sf.getTombstones()).some(tb => tb.id === 'bbbb2222' && tb.type === 'trademeta')
  );
  // updateTrade tombstones the OLD id and re-adds under the NEW id (an explicit re-add, not an import).
  await sf.addTrades([t('2026-05-03 10:00:00', 12)]);
  const oldId = sf.tradeId(t('2026-05-03 10:00:00', 12));
  const upd = await sf.updateTrade(oldId, t('2026-05-03 10:00:00', 99), {});
  ok(
    'F58: updateTrade tombstones the OLD id',
    (await sf.getTombstones()).some(tb => tb.id === oldId && tb.type === 'trade')
  );
  ok('F58: updateTrade re-adds under the new id', upd.id !== oldId && (await sf.tradeCount()) === 1);
  // deleteFile tombstones each trade it removes, and that trade can't be re-imported afterward.
  const sd = createDemoStore();
  await sd.addTrades([{ ...t('2026-05-04 10:00:00', 5), fileIds: ['fA'] }]);
  const tid = sd.tradeId(t('2026-05-04 10:00:00', 5));
  const del = await sd.deleteFile('fA');
  ok(
    'F58: deleteFile tombstones the removed trade',
    del.removedTrades === 1 && (await sd.getTombstones()).some(tb => tb.id === tid && tb.type === 'trade')
  );
  const reF = await sd.addTrades([{ ...t('2026-05-04 10:00:00', 5), fileIds: ['fB'] }]);
  ok('F58: a trade removed via deleteFile is not resurrected by re-import', reF.added === 0 && (await sd.tradeCount()) === 0);
}
{
  // (c) `updated` is present on every written record type (the record-level LWW clock).
  const sf = createDemoStore();
  await sf.addTrades([t('2026-05-05 10:00:00', 7)]);
  ok('F58: written trade carries an updated clock', typeof (await sf.getAllTrades())[0].updated === 'number');
  await sf.saveJournal('2026-05-05', { text: 'j' });
  ok('F58: journal record carries updated', typeof (await sf.getAllJournal())[0].updated === 'number');
  await sf.saveTradeMeta('cccc3333', { note: 'n' });
  ok('F58: trademeta record carries updated', typeof (await sf.allTradeMeta())[0].updated === 'number');
  await sf.addFile(
    {
      id: 'dddd4444',
      name: 'f.csv',
      platform: 'x',
      platformLabel: 'X',
      size: 1,
      rows: 1,
      tradeCount: 1,
      overlap: 0,
      from: '2026-05-05',
      to: '2026-05-05',
      imported: '2026-05-05T00:00:00Z',
      included: true,
    },
    'raw'
  );
  ok('F58: file record carries updated', typeof (await sf.getFiles())[0].updated === 'number');
  await sf.setMeta('k', { a: 1 });
  ok('F58: meta record carries updated', typeof (await sf.getAllMeta())[0].updated === 'number');
  ok(
    'F58: `updated` does not enter tradeId (identity unchanged)',
    sf.tradeId(t('2026-05-05 10:00:00', 7)) === (await sf.getAllTrades())[0].id
  );
}
{
  // (d) purge clears tombstones — a clean slate, so a later re-import is NOT suppressed.
  const sf = createDemoStore();
  await sf.addTrades([t('2026-05-06 10:00:00', 3)]);
  await sf.deleteTrade(sf.tradeId(t('2026-05-06 10:00:00', 3)));
  ok('F58: tombstone present before purge', (await sf.getTombstones()).length === 1);
  await sf.purge();
  ok('F58: purge clears tombstones', (await sf.getTombstones()).length === 0);
  const re = await sf.addTrades([t('2026-05-06 10:00:00', 3)]);
  ok('F58: purge clears suppression (a fresh re-import adds again)', re.added === 1 && (await sf.tradeCount()) === 1);
}

// ── F59: demo is a SINGLE in-memory workspace; the dimension is inert (never persists) ──
{
  const sw = createDemoStore();
  const one = sw.listWorkspaces();
  ok('F59: demo lists exactly one synthetic workspace', Array.isArray(one) && one.length === 1);
  ok('F59: demo active workspace is that entry', sw.activeWorkspace().id === one[0].id);
  // create/rename/delete/setActive are safe no-ops — the roster stays a single workspace.
  sw.createWorkspace('Second');
  ok('F59: demo createWorkspace is a no-op (still one workspace)', sw.listWorkspaces().length === 1);
  sw.renameWorkspace(one[0].id, 'Renamed');
  ok('F59: demo renameWorkspace does not persist a change', sw.listWorkspaces()[0].name === one[0].name);
  const afterSet = await sw.setActiveWorkspace('nope');
  ok('F59: demo setActiveWorkspace stays on the one workspace', afterSet.id === one[0].id && sw.activeWorkspace().id === one[0].id);
  const afterDel = await sw.deleteWorkspace(one[0].id);
  ok('F59: demo deleteWorkspace is a no-op (workspace survives)', afterDel.id === one[0].id && sw.listWorkspaces().length === 1);
}

// purge clears everything
await s.purge();
ok('purge empties the store', (await s.tradeCount()) === 0 && (await s.allTradeMeta()).length === 0 && (await s.getFiles()).length === 0);

console.log(`\n${pass} passed, 0 failed`);
