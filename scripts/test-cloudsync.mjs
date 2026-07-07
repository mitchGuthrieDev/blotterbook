/* Integration test for F63 — CloudStore write-behind + client-side merge (docs/synced-workspaces.md
   step 6). The e2e harness can't run Pages Functions, so convergence is proven IN-PROCESS:

     · the REAL crypto core (src/lib/core/crypto.ts) mints the account IK + workspace DEK and derives
       each device's record key + blinding key;
     · the REAL F62 server functions (functions/api/sync/*) run over an in-memory D1 + R2 mock (the
       SAME dumb-blob-store contract the browser hits) — so the transport is faithful, not stubbed;
     · the REAL client engine (src/app/lib/cloudsync-core.ts) pushes/pulls/merges;
     · TWO independent in-memory Stores (clients A + B) share one account IK + workspace DEK.

   Asserts: (a) a record written on A appears identically on B after push→pull (trade union +
   journal/meta LWW); (b) an offline edit on B reconciles both ways; (c) a delete on A propagates to
   B via tombstone and STAYS deleted (no resurrection on re-import); (d) the concurrent-seq case is
   survived by the FULL since=0 reconcile that an incremental pull would miss; (e) ONLY ciphertext +
   blinded ids cross the boundary — the mock server never sees a plaintext symbol / P&L / note / raw
   tradeId. Run: node scripts/test-cloudsync.mjs */
import assert from 'node:assert/strict';
import { createSession, createUser, SESSION_COOKIE } from '../functions/_lib/accounts.ts';
import { onRequestGet as wsList, onRequestPost as wsRegister } from '../functions/api/sync/workspaces.ts';
import { onRequestPost as pushFn } from '../functions/api/sync/push.ts';
import { onRequestGet as pullFn } from '../functions/api/sync/pull.ts';
import { recordKey } from '../functions/_lib/sync.ts';
import { tradeId } from '../src/lib/core/store.ts';
import { genIdentityKey, genWorkspaceDek, dekBytesOf, wrapDek, unwrapDekBytes, encryptRecord, blindId } from '../src/lib/core/crypto.ts';
import { deriveWsKeys, pushChanges, pullAndMerge, syncPlan } from '../src/app/lib/cloudsync-core.ts';

let pass = 0;
const ok = (name, cond) => {
  assert.ok(cond, name);
  console.log('  ok  ' + name);
  pass++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── in-memory D1 stub (copied from test-sync.mjs — same statement set the sync helpers issue) ──── */
function mockDb() {
  const tables = {
    users: [],
    sessions: [],
    subscriptions: [], // A253 — callerHasCloud() reads this to gate the mutating sync routes
    sync_workspaces: [],
    sync_workspace_keys: [],
    sync_wrapped_ik: [],
    sync_records: [],
  };
  const parseConds = clause =>
    clause.split(/ AND /i).map(c => {
      const m = c.trim().match(/^(\w+)\s*(=|>)\s*\?$/);
      if (!m) throw new Error('mock D1: bad condition — ' + c);
      return { col: m[1], op: m[2] };
    });
  const matches = (row, conds, args, off) =>
    conds.every((c, i) => (c.op === '=' ? row[c.col] === args[off + i] : row[c.col] > args[off + i]));
  const nextSeq = ws => tables.sync_records.filter(r => r.workspace_id === ws).reduce((mx, r) => Math.max(mx, r.seq), 0) + 1;
  const exec = (sql, args) => {
    const s = sql.trim().replace(/\s+/g, ' ');
    let m;
    // A261 atomic-seq INSERT/UPDATE — seq is a MAX(seq)+1 subquery; matched before the generic forms.
    if (
      (m = s.match(
        /^INSERT INTO sync_records \(workspace_id, blinded_id, seq, type, ciphertext_ref, updated, deleted\) VALUES \(\?, \?, \(SELECT COALESCE\(MAX\(seq\), 0\) \+ 1 FROM sync_records WHERE workspace_id = \?\), \?, \?, \?, \?\)$/i
      ))
    ) {
      const [ws, blinded, wsSub, type, ref, updated, deleted] = args;
      tables.sync_records.push({ workspace_id: ws, blinded_id: blinded, seq: nextSeq(wsSub), type, ciphertext_ref: ref, updated, deleted });
      return [];
    }
    if (
      (m = s.match(
        /^UPDATE sync_records SET seq = \(SELECT COALESCE\(MAX\(seq\), 0\) \+ 1 FROM sync_records WHERE workspace_id = \?\), type = \?, ciphertext_ref = \?, updated = \?, deleted = \? WHERE workspace_id = \? AND blinded_id = \?$/i
      ))
    ) {
      const [wsSub, type, ref, updated, deleted, ws, blinded] = args;
      const row = tables.sync_records.find(r => r.workspace_id === ws && r.blinded_id === blinded);
      if (row) Object.assign(row, { seq: nextSeq(wsSub), type, ciphertext_ref: ref, updated, deleted });
      return [];
    }
    // A253 quota COUNT.
    if ((m = s.match(/^SELECT COUNT\(\*\) AS n FROM (\w+) WHERE (\w+) = \?$/i))) {
      return [{ n: tables[m[1]].filter(r => r[m[2]] === args[0]).length }];
    }
    if ((m = s.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i))) {
      const cols = m[2].split(',').map(c => c.trim());
      const row = Object.fromEntries(cols.map((c, i) => [c, args[i] ?? null]));
      // `ON CONFLICT(<col>) DO NOTHING` — skip when the key exists; report affected rows via .changes
      // so run() can surface D1's meta.changes (A310 race-safe createUser/insertCredential).
      const conflict = s.match(/ON CONFLICT\((\w+)\) DO NOTHING/i);
      if (conflict && tables[m[1]].some(r => r[conflict[1]] === row[conflict[1]])) return Object.assign([], { changes: 0 });
      tables[m[1]].push(row);
      return Object.assign([], { changes: 1 });
    }
    if ((m = s.match(/^SELECT \* FROM (\w+) WHERE (.+?)(?: ORDER BY (\w+)( DESC)?)?(?: LIMIT (\d+))?$/i))) {
      const conds = parseConds(m[2]);
      let rows = tables[m[1]].filter(r => matches(r, conds, args, 0));
      if (m[3]) {
        const col = m[3],
          desc = !!m[4];
        rows = [...rows].sort((a, b) => (desc ? b[col] - a[col] : a[col] - b[col]));
      }
      if (m[5]) rows = rows.slice(0, parseInt(m[5], 10));
      return rows;
    }
    if ((m = s.match(/^UPDATE (\w+) SET (.+) WHERE (.+)$/i))) {
      const sets = m[2].split(',').map(p => p.trim().match(/^(\w+) = \?$/)[1]);
      const conds = parseConds(m[3]);
      tables[m[1]].filter(r => matches(r, conds, args, sets.length)).forEach(r => sets.forEach((c, i) => (r[c] = args[i])));
      return [];
    }
    if ((m = s.match(/^DELETE FROM (\w+) WHERE (.+)$/i))) {
      const conds = parseConds(m[2]);
      tables[m[1]] = tables[m[1]].filter(r => !matches(r, conds, args, 0));
      return [];
    }
    throw new Error('mock D1: unhandled SQL — ' + s);
  };
  return {
    tables,
    prepare(sql) {
      const api = args => ({
        bind: (...a) => api(a),
        first: async () => exec(sql, args)[0] ?? null,
        run: async () => {
          const r = exec(sql, args);
          return { meta: { changes: (r && r.changes) || 0 } };
        },
        all: async () => ({ results: exec(sql, args) }),
      });
      return api([]);
    },
  };
}
function mockBucket() {
  const store = new Map();
  return {
    store,
    async put(key, value) {
      store.set(key, String(value));
    },
    async get(key) {
      return store.has(key) ? { text: async () => store.get(key) } : null;
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/* ── faithful in-memory Store (the "shimmed Store" — DemoStore.importAll is a no-op, so this one has
   a WORKING importAll that PRESERVES `updated` for journal/trademeta/meta the way the real Store does,
   and unions trades with F58 tombstone suppression). Only the methods the sync engine touches. ──── */
function memStore() {
  const trades = new Map(); // id -> trade
  const journal = new Map(); // date -> {date,text,tags,shots,updated}
  const trademeta = new Map(); // id -> {id,tags,note,shots,updated}
  const meta = new Map(); // key -> {value,updated}
  const tombs = new Map(); // id -> {id,type,updated}
  const local = new Map();
  const ENRICH = ['qty', 'entryTime', 'exitTime', 'holdMs', 'commission', 'entryPrice', 'exitPrice'];
  return {
    async getAllTrades() {
      return [...trades.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    },
    async addTrades(list) {
      let added = 0,
        duplicate = 0;
      for (const t of list) {
        const id = tradeId(t);
        const prev = trades.get(id);
        if (prev) {
          duplicate++;
          let next = null;
          if (t.fileIds?.length) {
            const merged = [...new Set([...(prev.fileIds || []), ...t.fileIds])];
            if (merged.length !== (prev.fileIds || []).length) next = { ...prev, fileIds: merged };
          }
          for (const k of ENRICH)
            if (prev[k] == null && t[k] != null) {
              next = next ?? { ...prev };
              next[k] = t[k];
            }
          if (next) {
            next.updated = Date.now();
            trades.set(id, next);
          }
          continue;
        }
        const tb = tombs.get(`trade:${id}`); // F58/A255/A269: LWW suppression, composite-keyed lookup
        if (tb && tb.updated >= (t.updated ?? 0)) continue; // clock suppresses; a newer record resurrects
        trades.set(id, { ...t, id, updated: Date.now() });
        added++;
      }
      return { added, duplicate, total: trades.size };
    },
    async deleteTrade(id) {
      trades.delete(id);
      tombs.set(`trade:${id}`, { id, type: 'trade', updated: Date.now() }); // A269 composite key
    },
    async getAllJournal() {
      return [...journal.values()];
    },
    async deleteJournal(date) {
      journal.delete(date);
      tombs.set(`journal:${date}`, { id: date, type: 'journal', updated: Date.now() }); // A269 composite key
    },
    async saveJournal(date, rec) {
      const r = typeof rec === 'string' ? { text: rec } : rec || {};
      const text = (r.text || '').trim();
      const tags = r.tags || [];
      const shots = r.shots || [];
      // A252 parity: an empty clear DELETES + records a tombstone (the real Store does this now).
      if (text || tags.length || shots.length) journal.set(date, { date, text, tags, shots, updated: Date.now() });
      else {
        journal.delete(date);
        tombs.set(`journal:${date}`, { id: date, type: 'journal', updated: Date.now() }); // A269 composite key
      }
    },
    async allTradeMeta() {
      return [...trademeta.values()];
    },
    async saveTradeMeta(id, m) {
      const tags = m.tags || [];
      const note = (m.note || '').trim();
      const shots = m.shots || [];
      // A252 parity: an empty clear DELETES + records a tombstone.
      if (tags.length || note || shots.length) trademeta.set(id, { id, tags, note, shots, updated: Date.now() });
      else {
        trademeta.delete(id);
        tombs.set(`trademeta:${id}`, { id, type: 'trademeta', updated: Date.now() }); // A269 composite key
      }
    },
    async deleteTradeMeta(id) {
      trademeta.delete(id);
      tombs.set(`trademeta:${id}`, { id, type: 'trademeta', updated: Date.now() }); // A269 composite key
    },
    async getAllMeta() {
      return [...meta.entries()].map(([key, { value, updated }]) => ({ key, value, updated }));
    },
    async setMeta(key, value) {
      meta.set(key, { value, updated: Date.now() });
    },
    async getMeta(key) {
      return meta.get(key)?.value;
    },
    async getTombstones() {
      return [...tombs.values()];
    },
    // The trust boundary: PRESERVES the incoming `updated` (LWW), unions trades via addTrades.
    async importAll(data) {
      if (Array.isArray(data.trades) && data.trades.length) await this.addTrades(data.trades);
      for (const j of data.journal || [])
        journal.set(j.date, {
          date: j.date,
          text: j.text || '',
          tags: j.tags || [],
          shots: j.shots || [],
          updated: j.updated || Date.now(),
        });
      for (const m of data.trademeta || [])
        trademeta.set(m.id, { id: m.id, tags: m.tags || [], note: m.note || '', shots: m.shots || [], updated: m.updated || Date.now() });
      for (const mm of data.meta || []) meta.set(mm.key, { value: mm.value, updated: mm.updated || 0 });
      return { added: 0, dup: 0 };
    },
    local: {
      get: (k, fb) => (local.has(k) ? local.get(k) : fb),
      set: (k, v) => (local.set(k, v), true),
      remove: k => local.delete(k),
    },
  };
}

/* ── transport backed by the REAL server functions over the mock env (the faithful contract) ────── */
const ORIGIN = 'https://bb.test';
function makeTransport(env, token) {
  const cookie = `${SESSION_COOKIE}=${token}`;
  const call = (fn, path, method, body) =>
    fn({
      request: new Request(ORIGIN + path, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      }),
      env,
    });
  return {
    async listWorkspaces() {
      const j = await (await call(wsList, '/api/sync/workspaces', 'GET')).json();
      return j.workspaces ?? [];
    },
    async registerWorkspace(id, dek) {
      const r = await call(wsRegister, '/api/sync/workspaces', 'POST', { workspace_id: id, wrapped_dek: dek });
      if (!r.ok) throw new Error('register ' + r.status);
    },
    async push(id, records) {
      const r = await call(pushFn, '/api/sync/push', 'POST', { workspace_id: id, records });
      if (!r.ok) throw new Error('push ' + r.status);
    },
    async pull(id, since) {
      const r = await call(pullFn, `/api/sync/pull?workspace_id=${id}&since=${since}`, 'GET');
      if (!r.ok) throw new Error('pull ' + r.status);
      return r.json();
    },
  };
}

const WS = 'default';
const trade = (time, symbol, side, pnl) => ({
  time,
  date: time.slice(0, 10),
  symbol,
  root: symbol.replace(/[FGHJKMNQUVXZ]\d+$/, ''),
  side,
  pnl,
});

// Sync mirrors the controller: FULL does a since=0 pull reconcile (closes the seq race) + a push
// from the stored watermark (-1 until the first push ⇒ upload everything). INCREMENTAL pulls from
// the stored cursor + pushes from the stored watermark.
async function syncFull(store, keys, transport, st) {
  st.cursor = (await pullAndMerge(store, keys, transport, WS, 0)).cursor;
  st.pushed = await pushChanges(store, keys, transport, WS, st.pushed);
}
async function syncInc(store, keys, transport, st) {
  st.cursor = (await pullAndMerge(store, keys, transport, WS, st.cursor)).cursor;
  st.pushed = await pushChanges(store, keys, transport, WS, st.pushed);
}

console.log('F63 — CloudStore convergence (real crypto + real F62 server over a mock D1/R2)');

// One account, two devices sharing the account IK + the workspace DEK.
const db = mockDb();
const bucket = mockBucket();
const env = { ACCOUNTS_DB: db, SYNC_BUCKET: bucket };
const user = await createUser(db, 'sync@example.com');
const { token } = await createSession(db, user.id);
// A253: the mutating sync routes now require the cloud tier — provision an active subscription so this
// convergence test (which exercises the real F62 server) is allowed to register/push.
db.tables.subscriptions.push({
  user_id: user.id,
  stripe_subscription_id: null,
  stripe_customer_id: null,
  status: 'active',
  current_period_end: null,
  updated: Date.now(),
  past_due_since: null,
});
const transport = makeTransport(env, token);

const ik = await genIdentityKey();
// Device A mints + registers the DEK; device B adopts it from the server (unwrap under the same IK).
const dek = await genWorkspaceDek();
const dekBytes = await dekBytesOf(dek);
await transport.registerWorkspace(WS, JSON.stringify(await wrapDek(dek, ik)));
const keysA = await deriveWsKeys(dekBytes);
const listed = await transport.listWorkspaces();
const bBytes = await unwrapDekBytes(JSON.parse(listed[0].wrapped_dek), ik);
const keysB = await deriveWsKeys(bBytes);

const A = memStore();
const B = memStore();
const stA = { cursor: 0, pushed: -1 };
const stB = { cursor: 0, pushed: -1 };

/* (a) a record written on A appears identically on B (trade union + journal LWW) ────────────────── */
{
  await A.addTrades([trade('2025-03-03 09:31:00', 'MESZ2025', 'long', 125.5), trade('2025-03-03 10:00:00', 'MESZ2025', 'short', -40)]);
  await A.saveJournal('2025-03-03', { text: 'clean session', tags: ['a'] });
  await A.setMeta('setup', { broker: 'ampfutures', feed: '', state: 'FL', platform: '35' });
  await syncFull(A, keysA, transport, stA); // A pushes up
  await syncFull(B, keysB, transport, stB); // B pulls down + merges

  const bt = await B.getAllTrades();
  ok('B receives both trades A pushed', bt.length === 2 && bt.some(t => t.pnl === 125.5) && bt.some(t => t.pnl === -40));
  ok('B receives A journal note (LWW upsert)', (await B.getAllJournal())[0]?.text === 'clean session');
  ok('B receives A setup meta (LWW upsert)', (await B.getMeta('setup'))?.broker === 'ampfutures');

  // Both sides import an OVERLAPPING trade — content-hash union means no double-count, identical set.
  await B.addTrades([trade('2025-03-03 09:31:00', 'MESZ2025', 'long', 125.5)]);
  await syncInc(B, keysB, transport, stB);
  await syncInc(A, keysA, transport, stA);
  ok('overlapping import stays deduped (A still 2 trades)', (await A.getAllTrades()).length === 2);
}

/* (b) an offline edit on B reconciles both ways ─────────────────────────────────────────────────── */
{
  await sleep(5);
  // B edits the journal while "offline" (no sync), with a strictly newer clock → LWW winner.
  await B.saveJournal('2025-03-03', { text: 'revised while offline', tags: ['a', 'b'] });
  // A meanwhile adds a NEW trade offline.
  await A.addTrades([trade('2025-03-04 11:00:00', 'MNQZ2025', 'long', 210)]);
  // Reconnect: sync both a couple of rounds until quiescent.
  for (let i = 0; i < 3; i++) {
    await syncInc(A, keysA, transport, stA);
    await syncInc(B, keysB, transport, stB);
  }
  ok("A picks up B's newer offline journal edit (LWW)", (await A.getAllJournal())[0]?.text === 'revised while offline');
  ok(
    "B picks up A's offline-added trade",
    (await B.getAllTrades()).some(t => t.pnl === 210)
  );
  ok('datasets converged (both have 3 trades)', (await A.getAllTrades()).length === 3 && (await B.getAllTrades()).length === 3);
}

/* (c) a delete on A propagates to B via tombstone and stays deleted (no resurrection) ───────────── */
{
  const target = (await A.getAllTrades()).find(t => t.pnl === -40);
  await A.deleteTrade(target.id);
  for (let i = 0; i < 3; i++) {
    await syncInc(A, keysA, transport, stA);
    await syncInc(B, keysB, transport, stB);
  }
  ok('delete propagates to B (trade gone)', !(await B.getAllTrades()).some(t => t.id === target.id));
  // Re-import the deleted trade on B — the tombstone must suppress its resurrection.
  await B.addTrades([trade('2025-03-03 10:00:00', 'MESZ2025', 'short', -40)]);
  ok('tombstone blocks re-import resurrection on B', !(await B.getAllTrades()).some(t => t.id === target.id));
  await syncInc(B, keysB, transport, stB);
  await syncInc(A, keysA, transport, stA);
  ok('...and it stays deleted on A too', !(await A.getAllTrades()).some(t => t.id === target.id));
}

/* (d) the concurrent-seq case is survived by the FULL since=0 reconcile ─────────────────────────── */
{
  // Simulate a concurrent push that lands with a seq AT (not above) a caught-up client's cursor — an
  // incremental `seq > cursor` pull would skip it; a full since=0 reconcile cannot.
  const C = memStore();
  const stC = { cursor: 0, pushed: -1 };
  // Catch C fully up to a FIXPOINT — its first sync merges + echoes its data back (which advances the
  // seq); a second settles it, so its pull-cursor ends equal to the server's true max seq.
  let prev = -1;
  for (let i = 0; i < 6 && stC.cursor !== prev; i++) {
    prev = stC.cursor;
    await syncFull(C, keysB, transport, stC);
  }
  const caughtUp = stC.cursor;

  // Inject an encrypted record directly at seq === caughtUp (the colliding seq), the way the server
  // stores one: ciphertext in R2, an index row in D1. An incremental `seq > caughtUp` pull cannot see
  // it; only a full since=0 reconcile does.
  const hidden = trade('2025-03-05 12:00:00', 'ESHURT2025', 'short', 999.99);
  const blinded = await blindId(keysA.blindKey, `trade:${tradeId(hidden)}`);
  const ct = JSON.stringify(await encryptRecord(keysA.recordKey, JSON.stringify({ ...hidden, id: tradeId(hidden) })));
  await bucket.put(recordKey(WS, blinded), ct);
  db.tables.sync_records.push({
    workspace_id: WS,
    blinded_id: blinded,
    seq: caughtUp,
    type: 'trade',
    ciphertext_ref: recordKey(WS, blinded),
    updated: Date.now(),
    deleted: 0,
  });

  // Incremental pull (since = cursor) MISSES the colliding-seq record.
  const inc = await pullAndMerge(C, keysB, transport, WS, caughtUp);
  ok('incremental pull misses the colliding-seq record', !(await C.getAllTrades()).some(t => t.pnl === 999.99) && inc.merged === 0);
  // FULL since=0 reconcile recovers it.
  await pullAndMerge(C, keysB, transport, WS, 0);
  ok(
    'full since=0 reconcile recovers the colliding-seq record',
    (await C.getAllTrades()).some(t => t.pnl === 999.99)
  );
}

/* (e) ONLY ciphertext + blinded ids cross the boundary — no plaintext trade field on the server ─── */
{
  const serverBlob =
    JSON.stringify([...bucket.store.entries()]) + JSON.stringify(db.tables.sync_records) + JSON.stringify(db.tables.sync_workspace_keys);
  for (const secret of ['MESZ2025', 'MNQZ2025', 'ESHURT2025', 'clean session', 'revised while offline', 'ampfutures', '125.5', '999.99']) {
    ok(`server never sees plaintext "${secret}"`, !serverBlob.includes(secret));
  }
  // The blinded id is the HMAC, never the raw content-hash tradeId.
  const someTrade = (await A.getAllTrades())[0];
  const raw = tradeId(someTrade);
  const blindedForIt = await blindId(keysA.blindKey, `trade:${raw}`);
  ok('blinded id is a 64-hex HMAC, not the raw tradeId', /^[0-9a-f]{64}$/.test(blindedForIt) && blindedForIt !== raw);
  ok('no D1 index row exposes a raw tradeId as its blinded_id', !db.tables.sync_records.some(r => r.blinded_id === raw));
}

// ── A284: the A279 sync-direction contract (what pullFromCloud / pushToCloud / Sync-now each do) ──
// The controller (cloudsync.svelte.ts) is a rune module that can't be imported here, so the direction
// decision it drives lives in the pure syncPlan() helper — lock it down.
{
  const both = syncPlan('both');
  ok('Sync now (both): pulls AND pushes, incremental (no force)', both.pull && both.push && !both.forceFullPush);
  const pull = syncPlan('pull');
  ok('Pull from cloud: pulls only, never advances the pushed-watermark', pull.pull && !pull.push && !pull.forceFullPush);
  const push = syncPlan('push');
  ok('Push to cloud: pushes only, re-uploading everything (forceFullPush), no pull', !push.pull && push.push && push.forceFullPush);
}

console.log(`\n${pass} assertions passed.`);
