/* A258 — REAL-Store sync coverage (R1 pass 9). The hand-mock in test-cloudsync.mjs diverged from the
   actual persistence layer and MASKED the pass-9 P1s (A251/A252) and the A255 LWW flip. This suite runs
   the pure merge core (src/lib/core/cloudsync-core.ts: mergeRecords / pullAndMerge) against the ACTUAL
   src/lib/core/store.ts `Store` on `fake-indexeddb`, with records encrypted by the REAL crypto core —
   so the store trust boundary (importAll / addTrades tombstone suppression / delete-on-empty) is
   exercised for real, not simulated. Covers:
     (i)   clearing a note writes a tombstone → a reconcile of the old note does NOT resurrect it (A252)
     (ii)  trade tombstone suppression is LWW → a NEWER record resurrects, an OLDER/clockless one does
           not (A255), driven through pullAndMerge → mergeRecords → importAll → addTrades
     (iii) updateTrade (delete-old + re-add) → a reconcile of the PRE-EDIT trade does not resurrect it
     (iv)  purge is a clean slate (empties every store incl. tombstones) — the store half of A254; the
           controller half (disable sync + reset cursor on `data:erased`) lives in the $state rune
           module cloudsync.svelte.ts, which can't be imported in node, so it is verified by inspection.
   Run: node scripts/test-cloudsync-store.mjs */
import 'fake-indexeddb/auto'; // registers indexedDB / IDBKeyRange / structuredClone globals
import assert from 'node:assert/strict';

// Minimal synchronous localStorage shim — store.ts uses it for the F59 workspace registry (resolved
// before first paint). Set BEFORE importing store.ts.
globalThis.localStorage = (() => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: k => void m.delete(k),
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
})();

const { Store } = await import('../src/lib/core/store.ts');
const { genWorkspaceDek, dekBytesOf, encryptRecord, blindId } = await import('../src/lib/core/crypto.ts');
const { deriveWsKeys, mergeRecords, pullAndMerge, collectChanges } = await import('../src/lib/core/cloudsync-core.ts');

let pass = 0;
const ok = (name, cond) => {
  assert.ok(cond, name);
  console.log('  ok  ' + name);
  pass++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const trade = (time, symbol, side, pnl) => ({
  time,
  date: time.slice(0, 10),
  symbol,
  root: symbol.replace(/[FGHJKMNQUVXZ]\d+$/, ''),
  side,
  pnl,
});

console.log('A258 — sync merge core against the REAL Store (fake-indexeddb + real crypto)');

await Store.init();
const dek = await genWorkspaceDek();
const keys = await deriveWsKeys(await dekBytesOf(dek));

// Build a server-shaped PulledRecord (encrypted ciphertext + blinded id) for a plaintext object — the
// same wire shape a real /api/sync/pull row carries.
let seq = 1;
async function pulled(type, key, plainObj, updated, deleted = false) {
  const blinded_id = await blindId(keys.blindKey, `${type}:${key}`);
  const rec = await encryptRecord(keys.recordKey, JSON.stringify(plainObj));
  return { blinded_id, seq: seq++, type, updated, deleted, ciphertext: JSON.stringify(rec) };
}
// A one-page transport so a case can drive the full pullAndMerge path against the real Store.
const onePage = records => ({
  async pull() {
    return { records, nextSince: (records.at(-1)?.seq ?? 0) + 1, more: false };
  },
});

/* (i) clearing a note writes a tombstone → a reconcile of the OLD note does NOT resurrect it (A252) ── */
{
  await Store.saveJournal('2025-01-05', { text: 'my note', tags: ['x'] });
  const noteRow = (await Store.getAllJournal()).find(j => j.date === '2025-01-05');
  const oldNote = await pulled('journal', '2025-01-05', noteRow, noteRow.updated);
  await sleep(5);
  await Store.saveJournal('2025-01-05', { text: '' }); // clear-to-empty — A252 writes a tombstone
  ok('A252: clearing a note removes it locally', !(await Store.journalDates()).has('2025-01-05'));
  ok(
    'A252: clearing a note records a journal tombstone',
    (await Store.getTombstones()).some(tb => tb.id === '2025-01-05' && tb.type === 'journal')
  );
  await mergeRecords(Store, keys, [oldNote]); // reconcile the pre-clear note record
  ok('A252: a cleared note is NOT resurrected by reconciling the old record', !(await Store.journalDates()).has('2025-01-05'));
}

/* (ii) trade tombstone suppression is LWW — newer resurrects, older/clockless does not (A255) ──────── */
{
  await Store.addTrades([trade('2025-02-01 10:00:00', 'MESZ2025', 'long', 100)]);
  const tid = Store.tradeId(trade('2025-02-01 10:00:00', 'MESZ2025', 'long', 100));
  await sleep(5);
  await Store.deleteTrade(tid);
  const tomb = (await Store.getTombstones()).find(t => t.id === tid && t.type === 'trade');
  ok('A255: deleteTrade recorded a tombstone', !!tomb && (await Store.getAllTrades()).every(t => t.id !== tid));

  // OLDER-than-the-tombstone record via the full pull path → stays suppressed.
  const older = { ...trade('2025-02-01 10:00:00', 'MESZ2025', 'long', 100), id: tid, updated: tomb.updated - 1000 };
  await pullAndMerge(Store, keys, onePage([await pulled('trade', tid, older, older.updated)]), 'default', 0);
  ok('A255: an OLDER record does NOT resurrect the deleted trade', !(await Store.getAllTrades()).some(t => t.id === tid));

  // NEWER-than-the-tombstone record (a peer enrichment after the delete) → resurrects.
  const newer = { ...trade('2025-02-01 10:00:00', 'MESZ2025', 'long', 100), id: tid, updated: tomb.updated + 1000 };
  await pullAndMerge(Store, keys, onePage([await pulled('trade', tid, newer, newer.updated)]), 'default', 0);
  ok(
    'A255: a NEWER record RESURRECTS the deleted trade (LWW)',
    (await Store.getAllTrades()).some(t => t.id === tid)
  );
}

/* (iii) A269: updateTrade on a trade WITH trademeta produces BOTH a trade AND a trademeta tombstone
   (the composite key stops deleteTradeMeta from clobbering deleteTrade's), so the OLD trade's delete
   propagates — a reconcile of the pre-edit trade does not resurrect it, and collectChanges emits the
   trade delete another device would apply. ───────────────────────────────────────────────────────── */
{
  await Store.purge();
  await Store.addTrades([trade('2025-03-01 10:00:00', 'MESZ2025', 'long', 20)]);
  const oldId = Store.tradeId(trade('2025-03-01 10:00:00', 'MESZ2025', 'long', 20));
  await Store.saveTradeMeta(oldId, { note: 'pre-edit note' }); // the trade carries per-trade meta
  const { id: newId } = await Store.updateTrade(oldId, trade('2025-03-01 10:00:00', 'MESZ2025', 'long', 99), {});
  const tombs = await Store.getTombstones();
  ok(
    'A269: a trade tombstone AND a trademeta tombstone for the old id COEXIST (no collision)',
    newId !== oldId &&
      (await Store.tradeCount()) === 1 &&
      tombs.some(t => t.id === oldId && t.type === 'trade') &&
      tombs.some(t => t.id === oldId && t.type === 'trademeta')
  );
  // Propagation: collectChanges emits the OLD trade's delete (deleted:true) that another device applies
  // to drop the pre-edit trade — the bug was this delete NEVER being emitted (clobbered tombstone).
  const changes = await collectChanges(Store, 0);
  ok(
    'A269: the old trade delete IS emitted by collectChanges (propagates to other devices)',
    changes.some(c => c.type === 'trade' && c.key === oldId && c.deleted)
  );
  // And locally the pre-edit trade record can't resurrect on reconcile.
  const preEdit = { ...trade('2025-03-01 10:00:00', 'MESZ2025', 'long', 20), id: oldId, updated: 1 };
  await mergeRecords(Store, keys, [await pulled('trade', oldId, preEdit, 1)]);
  ok(
    'A269: a reconcile of the pre-edit trade does NOT resurrect it',
    !(await Store.getAllTrades()).some(t => t.id === oldId) && (await Store.tradeCount()) === 1
  );
}

/* (iv) purge is a clean slate — store half of A254 (controller disable verified by inspection) ─────── */
{
  await Store.addTrades([trade('2025-04-01 10:00:00', 'MESZ2025', 'long', 7)]);
  await Store.deleteTrade(Store.tradeId(trade('2025-04-01 10:00:00', 'MESZ2025', 'long', 7)));
  ok('purge precondition: data + a tombstone exist', (await Store.getTombstones()).length > 0);
  await Store.purge();
  ok(
    'A254: purge empties every store including tombstones',
    (await Store.tradeCount()) === 0 && (await Store.getAllJournal()).length === 0 && (await Store.getTombstones()).length === 0
  );
}

console.log(`\n${pass} assertions passed.`);
