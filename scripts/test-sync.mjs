/* Tests for the synced-workspaces transport (F62) — functions/_lib/sync.ts + functions/api/sync/*.
   Run: node scripts/test-sync.mjs
   Style mirrors scripts/test-accounts.mjs: Node built-ins only, endpoints exercised with a mocked
   env (an in-memory D1 stub that interprets the SQL the helpers issue + an in-memory R2 stub). These
   cover OUR logic: push→pull round-trip, seq monotonicity, LWW (stale push can't clobber), tombstone
   propagation, cross-user rejection, fail-closed (no ACCOUNTS_DB / no SYNC_BUCKET), unauthed 401,
   Origin rejection on mutations, and the S25 response shape (ciphertext + blinded ids only). */
import { createSession, createUser, SESSION_COOKIE } from '../functions/_lib/accounts.ts';
import { MAX_RECORD_BYTES } from '../functions/_lib/sync.ts';
import { onRequestGet as wsList, onRequestPost as wsRegister } from '../functions/api/sync/workspaces.ts';
import { onRequestGet as ikGet, onRequestPut as ikPut } from '../functions/api/sync/wrapped-ik.ts';
import { onRequestPost as push } from '../functions/api/sync/push.ts';
import { onRequestGet as pull } from '../functions/api/sync/pull.ts';
import { onRequestPost as del } from '../functions/api/sync/delete.ts';
import { DELETE_PAGE, TOMBSTONE_TTL_MS, compactTombstones, deleteWorkspacePage } from '../functions/_lib/sync.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name);
  }
};

/* ---- in-memory D1 stub -------------------------------------------------------------------------
   Handles the sync statement set: INSERT, SELECT * WHERE <col = ? [AND col = ?]* [AND col > ?]>
   [ORDER BY col [DESC]] [LIMIT n], UPDATE ... SET ... WHERE ..., DELETE ... WHERE .... Throws on
   anything unrecognized so a new query can't silently no-op. */
function mockDb() {
  const tables = {
    users: [],
    sessions: [],
    subscriptions: [], // A253 — callerHasCloud() reads this to gate the mutating routes
    sync_workspaces: [],
    sync_workspace_keys: [],
    sync_wrapped_ik: [],
    sync_records: [],
  };
  const parseConds = clause =>
    clause.split(/ AND /i).map(c => {
      const m = c.trim().match(/^(\w+)\s*(=|>=|<=|>|<)\s*\?$/);
      if (!m) throw new Error('mock D1: bad condition — ' + c);
      return { col: m[1], op: m[2] };
    });
  const cmp = {
    '=': (a, b) => a === b,
    '>': (a, b) => a > b,
    '<': (a, b) => a < b,
    '>=': (a, b) => a >= b,
    '<=': (a, b) => a <= b,
  };
  const matches = (row, conds, args, off) => conds.every((c, i) => cmp[c.op](row[c.col], args[off + i]));
  // The atomic MAX(seq)+1 the write statement computes in-SQL (A261) — evaluated here so the mock
  // mirrors the real single-statement seq assignment.
  const nextSeq = ws => tables.sync_records.filter(r => r.workspace_id === ws).reduce((mx, r) => Math.max(mx, r.seq), 0) + 1;
  const exec = (sql, args) => {
    const s = sql.trim().replace(/\s+/g, ' ');
    let m;
    // A261 atomic-seq INSERT — seq is a MAX(seq)+1 subquery in position 3 (skips a positional bind arg),
    // so it must be matched BEFORE the generic INSERT (which would mis-map the seq column).
    if (
      (m = s.match(
        /^INSERT INTO sync_records \(workspace_id, blinded_id, seq, type, ciphertext_ref, updated, deleted\) VALUES \(\?, \?, \(SELECT COALESCE\(MAX\(seq\), 0\) \+ 1 FROM sync_records WHERE workspace_id = \?\), \?, \?, \?, \?\)$/i
      ))
    ) {
      const [ws, blinded, wsSub, type, ref, updated, deleted] = args;
      tables.sync_records.push({ workspace_id: ws, blinded_id: blinded, seq: nextSeq(wsSub), type, ciphertext_ref: ref, updated, deleted });
      return [];
    }
    // A261 atomic-seq UPDATE — same MAX(seq)+1 subquery for seq; matched before the generic UPDATE.
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
      tables[m[1]].push(Object.fromEntries(cols.map((c, i) => [c, args[i] ?? null])));
      return [];
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
        run: async () => exec(sql, args),
        all: async () => ({ results: exec(sql, args) }),
      });
      return api([]);
    },
  };
}

/* ---- in-memory R2 stub -------------------------------------------------------------------------- */
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
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}

const ORIGIN = 'https://bb.test';
const req = (path, { method = 'POST', origin = ORIGIN, cookie = null, body = null } = {}) =>
  new Request(ORIGIN + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body ?? {}),
  });
const cookieFor = token => `${SESSION_COOKIE}=${token}`;
const rec = (blinded_id, ciphertext, updated, extra = {}) => ({ blinded_id, type: 'trade', ciphertext, updated, ...extra });
// A253: the mutating sync routes now require the cloud tier (grantsCloud). Provision an active
// subscription so a test user can push/register/put; callerHasCloud() reads it via subscriptionForUser.
const grantCloud = (db, userId) =>
  db.tables.subscriptions.push({
    user_id: userId,
    stripe_subscription_id: null,
    stripe_customer_id: null,
    status: 'active',
    current_period_end: null,
    updated: Date.now(),
    past_due_since: null,
  });

console.log('Fail-closed (no ACCOUNTS_DB / no SYNC_BUCKET):');
{
  const db = mockDb();
  const bucket = mockBucket();
  const noDbEnvs = [
    ['workspaces GET', () => wsList({ request: req('/api/sync/workspaces', { method: 'GET' }), env: { SYNC_BUCKET: bucket } })],
    ['workspaces POST', () => wsRegister({ request: req('/api/sync/workspaces', { body: {} }), env: { SYNC_BUCKET: bucket } })],
    ['wrapped-ik PUT', () => ikPut({ request: req('/api/sync/wrapped-ik', { method: 'PUT', body: {} }), env: { SYNC_BUCKET: bucket } })],
    ['push', () => push({ request: req('/api/sync/push', { body: {} }), env: { SYNC_BUCKET: bucket } })],
    ['pull', () => pull({ request: req('/api/sync/pull?workspace_id=w', { method: 'GET' }), env: { SYNC_BUCKET: bucket } })],
  ];
  for (const [name, call] of noDbEnvs) {
    const r = await call();
    const j = await r.json();
    ok(`${name} → 503 naming ACCOUNTS_DB without the DB`, r.status === 503 && /ACCOUNTS_DB/.test(j.error));
  }
  const noBucketEnvs = [
    ['workspaces GET', () => wsList({ request: req('/api/sync/workspaces', { method: 'GET' }), env: { ACCOUNTS_DB: db } })],
    ['workspaces POST', () => wsRegister({ request: req('/api/sync/workspaces', { body: {} }), env: { ACCOUNTS_DB: db } })],
    ['wrapped-ik PUT', () => ikPut({ request: req('/api/sync/wrapped-ik', { method: 'PUT', body: {} }), env: { ACCOUNTS_DB: db } })],
    ['push', () => push({ request: req('/api/sync/push', { body: {} }), env: { ACCOUNTS_DB: db } })],
    ['pull', () => pull({ request: req('/api/sync/pull?workspace_id=w', { method: 'GET' }), env: { ACCOUNTS_DB: db } })],
  ];
  for (const [name, call] of noBucketEnvs) {
    const r = await call();
    const j = await r.json();
    ok(`${name} → 503 naming SYNC_BUCKET without the bucket`, r.status === 503 && /SYNC_BUCKET/.test(j.error));
  }
}

console.log('\nUnauthed (no session) → 401:');
{
  const env = { ACCOUNTS_DB: mockDb(), SYNC_BUCKET: mockBucket() };
  const calls = [
    ['workspaces GET', () => wsList({ request: req('/api/sync/workspaces', { method: 'GET' }), env })],
    ['workspaces POST', () => wsRegister({ request: req('/api/sync/workspaces', { body: { workspace_id: 'w', wrapped_dek: 'd' } }), env })],
    ['wrapped-ik GET', () => ikGet({ request: req('/api/sync/wrapped-ik', { method: 'GET' }), env })],
    ['push', () => push({ request: req('/api/sync/push', { body: { workspace_id: 'w', records: [] } }), env })],
    ['pull', () => pull({ request: req('/api/sync/pull?workspace_id=w', { method: 'GET' }), env })],
  ];
  for (const [name, call] of calls) {
    const r = await call();
    ok(`${name} → 401 without a session`, r.status === 401);
  }
}

console.log('\nOrigin rejection on mutations (403):');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: mockBucket() };
  const user = await createUser(db, 'o@example.com');
  const { token } = await createSession(db, user.id);
  const evil = 'https://evil.example';
  ok(
    'workspaces POST cross-origin → 403',
    (
      await wsRegister({
        request: req('/api/sync/workspaces', { origin: evil, cookie: cookieFor(token), body: { workspace_id: 'w', wrapped_dek: 'd' } }),
        env,
      })
    ).status === 403
  );
  ok(
    'wrapped-ik PUT cross-origin → 403',
    (
      await ikPut({
        request: req('/api/sync/wrapped-ik', { method: 'PUT', origin: evil, cookie: cookieFor(token), body: {} }),
        env,
      })
    ).status === 403
  );
  ok(
    'push cross-origin → 403',
    (
      await push({
        request: req('/api/sync/push', { origin: evil, cookie: cookieFor(token), body: { workspace_id: 'w', records: [] } }),
        env,
      })
    ).status === 403
  );
}

console.log('\nWorkspace register + list (idempotent, owned-by-caller):');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: mockBucket() };
  const u1 = await createUser(db, 'u1@example.com');
  const u2 = await createUser(db, 'u2@example.com');
  const { token: t1 } = await createSession(db, u1.id);
  const { token: t2 } = await createSession(db, u2.id);
  grantCloud(db, u1.id);
  grantCloud(db, u2.id);

  const reg = await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(t1), body: { workspace_id: 'w1', wrapped_dek: 'DEK-1' } }),
    env,
  });
  const regJson = await reg.json();
  ok(
    'register 200 with workspace_id + created_at',
    reg.status === 200 && regJson.workspace_id === 'w1' && typeof regJson.created_at === 'number'
  );
  ok('S25: register response carries no name/trade field', !('name' in regJson) && !('wrapped_dek' in regJson));

  const list1 = await (await wsList({ request: req('/api/sync/workspaces', { method: 'GET', cookie: cookieFor(t1) }), env })).json();
  ok('list returns the workspace with its wrapped DEK', list1.workspaces.length === 1 && list1.workspaces[0].wrapped_dek === 'DEK-1');

  // Idempotent re-register by the owner updates the DEK, no duplicate row.
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(t1), body: { workspace_id: 'w1', wrapped_dek: 'DEK-2' } }),
    env,
  });
  ok('re-register is idempotent (one workspace row)', db.tables.sync_workspaces.filter(w => w.workspace_id === 'w1').length === 1);
  const list2 = await (await wsList({ request: req('/api/sync/workspaces', { method: 'GET', cookie: cookieFor(t1) }), env })).json();
  ok('re-register updated the wrapped DEK', list2.workspaces[0].wrapped_dek === 'DEK-2');

  // A different user cannot claim the same workspace_id.
  const steal = await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(t2), body: { workspace_id: 'w1', wrapped_dek: 'EVIL' } }),
    env,
  });
  ok('cross-user register of an existing workspace_id → 409', steal.status === 409);
  ok("...and did not change the owner's DEK", db.tables.sync_workspace_keys.find(k => k.workspace_id === 'w1').wrapped_dek === 'DEK-2');

  const list2b = await (await wsList({ request: req('/api/sync/workspaces', { method: 'GET', cookie: cookieFor(t2) }), env })).json();
  ok("u2's workspace list does not include u1's workspace", list2b.workspaces.length === 0);

  // Optional encrypted workspace-name record is stored as a record (ciphertext only).
  await wsRegister({
    request: req('/api/sync/workspaces', {
      cookie: cookieFor(t1),
      body: { workspace_id: 'w1', wrapped_dek: 'DEK-2', name: rec('name-blind', 'ENC-NAME', 5, { type: 'workspace-name' }) },
    }),
    env,
  });
  ok(
    'workspace name stored as a record (never plaintext in D1)',
    db.tables.sync_records.some(r => r.blinded_id === 'name-blind')
  );
  ok('...and the D1 row holds only a ciphertext_ref, not the name', !JSON.stringify(db.tables.sync_records).includes('ENC-NAME'));
}

console.log('\nPush → pull round-trip + seq monotonicity + tombstones:');
{
  const db = mockDb();
  const bucket = mockBucket();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: bucket };
  const u1 = await createUser(db, 'p1@example.com');
  const { token } = await createSession(db, u1.id);
  grantCloud(db, u1.id);
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(token), body: { workspace_id: 'w1', wrapped_dek: 'D' } }),
    env,
  });

  const p1 = await push({
    request: req('/api/sync/push', {
      cookie: cookieFor(token),
      body: { workspace_id: 'w1', records: [rec('b1', 'c1', 100), rec('b2', 'c2', 100)] },
    }),
    env,
  });
  const p1j = await p1.json();
  ok('push 200 assigns a cursor', p1.status === 200 && p1j.cursor === 2 && p1j.count === 2);

  const pull1 = await (
    await pull({ request: req('/api/sync/pull?workspace_id=w1&since=0', { method: 'GET', cookie: cookieFor(token) }), env })
  ).json();
  ok(
    'pull since 0 returns both records with ciphertext',
    pull1.records.length === 2 && pull1.records[0].ciphertext === 'c1' && pull1.records[1].ciphertext === 'c2'
  );
  ok(
    'pull records carry monotonic seq 1,2 + cursor',
    pull1.records[0].seq === 1 && pull1.records[1].seq === 2 && pull1.nextSince === 2 && pull1.more === false
  );
  ok(
    'S25: a pulled record exposes only blinded_id/seq/type/updated/deleted/ciphertext',
    JSON.stringify(Object.keys(pull1.records[0]).sort()) ===
      JSON.stringify(['blinded_id', 'ciphertext', 'deleted', 'seq', 'type', 'updated'])
  );

  // A new push advances seq monotonically; incremental pull picks it up from the cursor.
  const p2 = await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w1', records: [rec('b3', 'c3', 100)] } }),
    env,
  });
  ok('second push advances the cursor (seq 3)', (await p2.json()).cursor === 3);
  const inc = await (
    await pull({ request: req('/api/sync/pull?workspace_id=w1&since=2', { method: 'GET', cookie: cookieFor(token) }), env })
  ).json();
  ok(
    'incremental pull since 2 returns only the new record (seq 3)',
    inc.records.length === 1 && inc.records[0].blinded_id === 'b3' && inc.records[0].seq === 3
  );

  // Tombstone: deleted:true flows through pull. Use a real wall-clock `updated` (as a live client does)
  // so the A265 compaction-on-push — which sweeps tombstones older than TOMBSTONE_TTL_MS — leaves this
  // fresh tombstone in place for other devices to reconcile.
  await push({
    request: req('/api/sync/push', {
      cookie: cookieFor(token),
      body: { workspace_id: 'w1', records: [rec('b1', 'c1-del', Date.now(), { deleted: true })] },
    }),
    env,
  });
  const afterDel = await (
    await pull({ request: req('/api/sync/pull?workspace_id=w1&since=3', { method: 'GET', cookie: cookieFor(token) }), env })
  ).json();
  const tomb = afterDel.records.find(r => r.blinded_id === 'b1');
  ok('tombstone propagates through pull (deleted:true)', tomb && tomb.deleted === true && tomb.seq === 4);
}

console.log('\nLWW — a stale push cannot clobber a newer row:');
{
  const db = mockDb();
  const bucket = mockBucket();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: bucket };
  const u1 = await createUser(db, 'lww@example.com');
  const { token } = await createSession(db, u1.id);
  grantCloud(db, u1.id);
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(token), body: { workspace_id: 'w1', wrapped_dek: 'D' } }),
    env,
  });
  await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w1', records: [rec('b1', 'fresh', 100)] } }),
    env,
  });

  // Stale push (older updated) is dropped: cursor unchanged, ciphertext preserved.
  const stale = await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w1', records: [rec('b1', 'STALE', 50)] } }),
    env,
  });
  ok('stale push does not advance the cursor', (await stale.json()).cursor === 1);
  ok('stale push did not overwrite the R2 ciphertext', bucket.store.get('records/w1/b1') === 'fresh');
  ok('stale push did not change the stored updated', db.tables.sync_records.find(r => r.blinded_id === 'b1').updated === 100);

  // Equal-clock re-push is a no-op too.
  const eq = await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w1', records: [rec('b1', 'EQ', 100)] } }),
    env,
  });
  ok(
    'equal-updated re-push is a no-op (cursor unchanged)',
    (await eq.json()).cursor === 1 && bucket.store.get('records/w1/b1') === 'fresh'
  );

  // A strictly newer push wins and bumps seq.
  const newer = await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w1', records: [rec('b1', 'newer', 200)] } }),
    env,
  });
  ok(
    'newer push wins (seq bumped, ciphertext replaced)',
    (await newer.json()).cursor === 2 && bucket.store.get('records/w1/b1') === 'newer'
  );
}

console.log('\nCross-user authorization (user B cannot touch user A workspace):');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: mockBucket() };
  const a = await createUser(db, 'a@example.com');
  const b = await createUser(db, 'b@example.com');
  const { token: ta } = await createSession(db, a.id);
  const { token: tb } = await createSession(db, b.id);
  grantCloud(db, a.id);
  grantCloud(db, b.id); // b is cloud-provisioned too, so its cross-user push is stopped by OWNERSHIP (404), not the tier gate
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(ta), body: { workspace_id: 'wa', wrapped_dek: 'D' } }),
    env,
  });
  await push({
    request: req('/api/sync/push', { cookie: cookieFor(ta), body: { workspace_id: 'wa', records: [rec('b1', 'secret', 100)] } }),
    env,
  });

  const bPush = await push({
    request: req('/api/sync/push', { cookie: cookieFor(tb), body: { workspace_id: 'wa', records: [rec('x', 'y', 100)] } }),
    env,
  });
  ok('user B push into A workspace → 404 (no leak)', bPush.status === 404);
  const bPull = await pull({ request: req('/api/sync/pull?workspace_id=wa&since=0', { method: 'GET', cookie: cookieFor(tb) }), env });
  ok('user B pull of A workspace → 404 (no leak)', bPull.status === 404);
  ok("...and A's record was never written by B", db.tables.sync_records.filter(r => r.workspace_id === 'wa').length === 1);
  const aPull = await (
    await pull({ request: req('/api/sync/pull?workspace_id=wa&since=0', { method: 'GET', cookie: cookieFor(ta) }), env })
  ).json();
  ok('owner A can still pull its own record', aPull.records.length === 1 && aPull.records[0].ciphertext === 'secret');
}

console.log('\nwrapped-IK store/fetch (per-method, per-user isolation):');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: mockBucket() };
  const u1 = await createUser(db, 'ik1@example.com');
  const u2 = await createUser(db, 'ik2@example.com');
  const { token: t1 } = await createSession(db, u1.id);
  const { token: t2 } = await createSession(db, u2.id);
  grantCloud(db, u1.id);
  grantCloud(db, u2.id);

  await ikPut({
    request: req('/api/sync/wrapped-ik', {
      method: 'PUT',
      cookie: cookieFor(t1),
      body: { method: 'passkey', key_id: 'k1', wrapped_ik: 'BLOB-1' },
    }),
    env,
  });
  await ikPut({
    request: req('/api/sync/wrapped-ik', {
      method: 'PUT',
      cookie: cookieFor(t1),
      body: { method: 'recovery', key_id: 'r1', wrapped_ik: 'BLOB-R' },
    }),
    env,
  });
  const g1 = await (await ikGet({ request: req('/api/sync/wrapped-ik', { method: 'GET', cookie: cookieFor(t1) }), env })).json();
  ok('GET returns both of the user wrapped-IK blobs', g1.wrappedIks.length === 2 && g1.wrappedIks.some(b => b.wrapped_ik === 'BLOB-1'));
  ok(
    'S25: wrapped-IK response exposes only method/key_id/wrapped_ik/updated',
    JSON.stringify(Object.keys(g1.wrappedIks[0]).sort()) === JSON.stringify(['key_id', 'method', 'updated', 'wrapped_ik'])
  );

  // Rotate the same (method, key_id) — upsert, not duplicate.
  await ikPut({
    request: req('/api/sync/wrapped-ik', {
      method: 'PUT',
      cookie: cookieFor(t1),
      body: { method: 'passkey', key_id: 'k1', wrapped_ik: 'BLOB-1b' },
    }),
    env,
  });
  const g1b = await (await ikGet({ request: req('/api/sync/wrapped-ik', { method: 'GET', cookie: cookieFor(t1) }), env })).json();
  ok(
    'rotate is an upsert (still 2 blobs, updated value)',
    g1b.wrappedIks.length === 2 && g1b.wrappedIks.some(b => b.wrapped_ik === 'BLOB-1b')
  );

  // Per-user isolation.
  const g2 = await (await ikGet({ request: req('/api/sync/wrapped-ik', { method: 'GET', cookie: cookieFor(t2) }), env })).json();
  ok('another user sees none of the wrapped-IK blobs', g2.wrappedIks.length === 0);
}

console.log('\nBatch cap (A15 subrequest budget):');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: mockBucket() };
  const u1 = await createUser(db, 'cap@example.com');
  const { token } = await createSession(db, u1.id);
  grantCloud(db, u1.id);
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(token), body: { workspace_id: 'w1', wrapped_dek: 'D' } }),
    env,
  });
  // MAX_PUSH_RECORDS is 12 (lowered from 15 to keep the A15 subrequest budget after the A253
  // entitlement + quota subrequests were added to push).
  const many = Array.from({ length: 13 }, (_, i) => rec('b' + i, 'c' + i, 100));
  const big = await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w1', records: many } }),
    env,
  });
  ok('over-cap batch rejected 413 (client must chunk)', big.status === 413);
  ok('...and nothing was written', db.tables.sync_records.length === 0);
  const okBatch = await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w1', records: many.slice(0, 12) } }),
    env,
  });
  ok('at-cap batch (12) accepted', okBatch.status === 200 && (await okBatch.json()).count === 12);
}

console.log('\nCloud-tier entitlement gate (A253) — writes gated, reads open for a lapsed account:');
{
  const db = mockDb();
  const bucket = mockBucket();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: bucket };
  const u = await createUser(db, 'ent@example.com');
  const { token } = await createSession(db, u.id);

  // Free tier (no subscription row) → every mutating route is refused with 402 before any write.
  const freePush = await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w', records: [rec('b', 'c', 1)] } }),
    env,
  });
  ok('free-tier push → 402 (paywall enforced server-side)', freePush.status === 402);
  const freeReg = await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(token), body: { workspace_id: 'w', wrapped_dek: 'D' } }),
    env,
  });
  ok('free-tier workspaces POST → 402', freeReg.status === 402);
  const freeIk = await ikPut({
    request: req('/api/sync/wrapped-ik', {
      method: 'PUT',
      cookie: cookieFor(token),
      body: { method: 'prf', key_id: 'k', wrapped_ik: 'B' },
    }),
    env,
  });
  ok('free-tier wrapped-ik PUT → 402', freeIk.status === 402);
  ok('...and the free-tier session wrote nothing', db.tables.sync_workspaces.length === 0 && db.tables.sync_records.length === 0);

  // Provision cloud, register + push, then LAPSE (drop the subscription): writes are refused but the
  // account can still READ (pull) to reconcile its cloud copy back down locally — the R/W asymmetry.
  grantCloud(db, u.id);
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(token), body: { workspace_id: 'w', wrapped_dek: 'D' } }),
    env,
  });
  await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w', records: [rec('b', 'c', 1)] } }),
    env,
  });
  db.tables.subscriptions = []; // lapse: entitlement now fails
  const lapsedPush = await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w', records: [rec('b2', 'c2', 2)] } }),
    env,
  });
  ok('lapsed account push → 402 (no new writes)', lapsedPush.status === 402);
  const lapsedPull = await pull({
    request: req('/api/sync/pull?workspace_id=w&since=0', { method: 'GET', cookie: cookieFor(token) }),
    env,
  });
  const lapsedPullJson = await lapsedPull.json();
  ok('lapsed account can still pull to reconcile (read stays open)', lapsedPull.status === 200 && lapsedPullJson.records.length === 1);
}

console.log('\nStorage quota (A253) — per-record ciphertext byte cap:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: mockBucket() };
  const u = await createUser(db, 'quota@example.com');
  const { token } = await createSession(db, u.id);
  grantCloud(db, u.id);
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(token), body: { workspace_id: 'w', wrapped_dek: 'D' } }),
    env,
  });
  const oversize = await push({
    request: req('/api/sync/push', {
      cookie: cookieFor(token),
      body: { workspace_id: 'w', records: [rec('big', 'x'.repeat(MAX_RECORD_BYTES + 1), 1)] },
    }),
    env,
  });
  ok('over-byte-cap record rejected 413', oversize.status === 413);
  ok('...and nothing was written', db.tables.sync_records.length === 0);
}

console.log('\nAtomic seq assignment (A261) — two records in one push get distinct monotonic seqs:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: mockBucket() };
  const u = await createUser(db, 'seq@example.com');
  const { token } = await createSession(db, u.id);
  grantCloud(db, u.id);
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(token), body: { workspace_id: 'w', wrapped_dek: 'D' } }),
    env,
  });
  await push({
    request: req('/api/sync/push', {
      cookie: cookieFor(token),
      body: { workspace_id: 'w', records: [rec('b1', 'c1', 1), rec('b2', 'c2', 1)] },
    }),
    env,
  });
  const seqs = db.tables.sync_records
    .filter(r => r.workspace_id === 'w')
    .map(r => r.seq)
    .sort((a, b) => a - b);
  ok('the two written records hold distinct, contiguous seqs (1,2) assigned in-SQL', seqs.length === 2 && seqs[0] === 1 && seqs[1] === 2);
}

console.log('\nWorkspace erase (A254) — server delete clears records + blobs, owner-only, not paywalled:');
{
  const db = mockDb();
  const bucket = mockBucket();
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: bucket };
  const a = await createUser(db, 'era@example.com');
  const b = await createUser(db, 'erb@example.com');
  const { token: ta } = await createSession(db, a.id);
  const { token: tb } = await createSession(db, b.id);
  grantCloud(db, a.id);
  grantCloud(db, b.id);
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(ta), body: { workspace_id: 'wa', wrapped_dek: 'D' } }),
    env,
  });
  await push({
    request: req('/api/sync/push', {
      cookie: cookieFor(ta),
      body: { workspace_id: 'wa', records: [rec('b1', 'c1', 100), rec('b2', 'c2', 100)] },
    }),
    env,
  });

  ok(
    'delete without a session → 401',
    (await del({ request: req('/api/sync/delete', { body: { workspace_id: 'wa' } }), env })).status === 401
  );
  const cross = await del({ request: req('/api/sync/delete', { cookie: cookieFor(tb), body: { workspace_id: 'wa' } }), env });
  ok('delete of another user workspace → 404 (no existence leak)', cross.status === 404);
  ok('...and A records untouched', db.tables.sync_records.filter(r => r.workspace_id === 'wa').length === 2);
  const badorg = await del({
    request: req('/api/sync/delete', { origin: 'https://evil.example', cookie: cookieFor(ta), body: { workspace_id: 'wa' } }),
    env,
  });
  ok('delete cross-origin → 403', badorg.status === 403);
  const noBucket = await del({
    request: req('/api/sync/delete', { cookie: cookieFor(ta), body: { workspace_id: 'wa' } }),
    env: { ACCOUNTS_DB: db },
  });
  ok('delete fails closed without SYNC_BUCKET → 503', noBucket.status === 503);

  const gone = await del({ request: req('/api/sync/delete', { cookie: cookieFor(ta), body: { workspace_id: 'wa' } }), env });
  const goneJson = await gone.json();
  ok('owner delete → 200 with { deleted, done:true }', gone.status === 200 && goneJson.deleted === 2 && goneJson.done === true);
  ok('change-index rows cleared', db.tables.sync_records.filter(r => r.workspace_id === 'wa').length === 0);
  ok('R2 ciphertext blobs cleared', !bucket.store.has('records/wa/b1') && !bucket.store.has('records/wa/b2'));
  ok('wrapped-DEK + registry shell rows removed', db.tables.sync_workspaces.length === 0 && db.tables.sync_workspace_keys.length === 0);

  // A lapsed/free owner must STILL be able to erase — deletion is never paywalled (unlike push/register).
  const lu = await createUser(db, 'lapse-del@example.com');
  const { token: lt } = await createSession(db, lu.id);
  grantCloud(db, lu.id);
  await wsRegister({
    request: req('/api/sync/workspaces', { cookie: cookieFor(lt), body: { workspace_id: 'wl', wrapped_dek: 'D' } }),
    env,
  });
  await push({
    request: req('/api/sync/push', { cookie: cookieFor(lt), body: { workspace_id: 'wl', records: [rec('b1', 'c1', 1)] } }),
    env,
  });
  db.tables.subscriptions = db.tables.subscriptions.filter(s => s.user_id !== lu.id); // lapse
  const lapsedDel = await del({ request: req('/api/sync/delete', { cookie: cookieFor(lt), body: { workspace_id: 'wl' } }), env });
  ok(
    'lapsed/free owner can still erase (delete not gated on cloud tier) → 200',
    lapsedDel.status === 200 && (await lapsedDel.json()).done === true
  );
}

console.log('\nWorkspace erase paging (A254) — DELETE_PAGE bounds each call so the client loops:');
{
  const db = mockDb();
  const bucket = mockBucket();
  const total = DELETE_PAGE + 1;
  for (let i = 0; i < total; i++) {
    const ref = `records/wp/b${i}`;
    db.tables.sync_records.push({
      workspace_id: 'wp',
      blinded_id: 'b' + i,
      seq: i + 1,
      type: 'trade',
      ciphertext_ref: ref,
      updated: 100,
      deleted: 0,
    });
    bucket.store.set(ref, 'x');
  }
  const p1 = await deleteWorkspacePage(db, bucket, 'wp');
  ok('first page deletes DELETE_PAGE rows, done:false', p1.deleted === DELETE_PAGE && p1.done === false);
  const p2 = await deleteWorkspacePage(db, bucket, 'wp');
  ok('second page deletes the remainder, done:true', p2.deleted === 1 && p2.done === true);
  ok(
    'all rows + blobs cleared after paging',
    db.tables.sync_records.filter(r => r.workspace_id === 'wp').length === 0 && bucket.store.size === 0
  );
}

console.log('\nTombstone compaction (A265) — stale tombstones swept, live + recent rows kept:');
{
  const db = mockDb();
  const bucket = mockBucket();
  const now = 1_700_000_000_000;
  const cutoff = now - TOMBSTONE_TTL_MS;
  const seed = (blinded, updated, deleted) => {
    const ref = `records/w/${blinded}`;
    db.tables.sync_records.push({
      workspace_id: 'w',
      blinded_id: blinded,
      seq: db.tables.sync_records.length + 1,
      type: 'trade',
      ciphertext_ref: ref,
      updated,
      deleted,
    });
    bucket.store.set(ref, 'x');
  };
  seed('stale', cutoff - 1000, 1); // tombstone older than the TTL → swept
  seed('recent', now - 1000, 1); // tombstone within the TTL → kept
  seed('live', now, 0); // not a tombstone → never swept
  const n = await compactTombstones(db, bucket, 'w', now);
  ok('compaction removes exactly the stale tombstone (returns 1)', n === 1);
  ok(
    '...its D1 row + R2 blob are gone',
    !db.tables.sync_records.some(r => r.blinded_id === 'stale') && !bucket.store.has('records/w/stale')
  );
  ok(
    'recent tombstone (within TTL) is kept',
    db.tables.sync_records.some(r => r.blinded_id === 'recent') && bucket.store.has('records/w/recent')
  );
  ok('live record is untouched', db.tables.sync_records.some(r => r.blinded_id === 'live') && bucket.store.has('records/w/live'));

  // Wiring: a real push sweeps stale tombstones as a side effect (now = Date.now() ≫ the seeded stamps).
  const env = { ACCOUNTS_DB: db, SYNC_BUCKET: bucket };
  const u = await createUser(db, 'sweep@example.com');
  const { token } = await createSession(db, u.id);
  grantCloud(db, u.id);
  db.tables.sync_workspaces.push({ workspace_id: 'w', owner_user_id: u.id, created_at: now });
  seed('old-tomb', 1000, 1); // ancient tombstone
  await push({
    request: req('/api/sync/push', { cookie: cookieFor(token), body: { workspace_id: 'w', records: [rec('fresh', 'cf', now + 1)] } }),
    env,
  });
  ok('push piggybacks the tombstone sweep (ancient tombstone gone)', !db.tables.sync_records.some(r => r.blinded_id === 'old-tomb'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
