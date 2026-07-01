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

// local shim is in-memory (no localStorage)
s.local.set('k', { v: 1 });
ok('local.get reads back', s.local.get('k').v === 1);
ok('local.get fallback', s.local.get('missing', 'fb') === 'fb');

// purge clears everything
await s.purge();
ok('purge empties the store', (await s.tradeCount()) === 0 && (await s.allTradeMeta()).length === 0);

console.log(`\n${pass} passed, 0 failed`);
