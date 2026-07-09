/* Tests for the A278 in-app subscription endpoint (functions/api/subscription/create.ts).
   Run: node scripts/test-subscription.mjs
   Style mirrors scripts/test-accounts.mjs: Node built-ins only, the endpoint exercised with a
   mocked env — a minimal in-memory D1 stub + a monkeypatched globalThis.fetch capturing the
   Stripe REST calls. The Payment Element/browser side is Stripe's (tested upstream); these cover
   OUR logic: fail-closed gates, auth, already-subscribed short-circuit, customer reuse-before-
   create + persistence, the incomplete-subscription resume path, metadata linkage, idempotency
   headers, and client-secret extraction across both Stripe API shapes. */
import { onRequestPost as subCreate } from '../functions/api/subscription/create.ts';
import { onRequestPost as subCancel } from '../functions/api/subscription/cancel.ts';
import { SESSION_COOKIE, createSession, createUser } from '../functions/_lib/accounts.ts';
import { ARCHIVED } from '../functions/_lib/archive.ts';

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

/* Minimal in-memory D1 stub — the generic statement shapes the endpoint + session/user helpers
   issue (INSERT/SELECT */
function mockDb() {
  const tables = { users: [], sessions: [], subscriptions: [], entitlement_overrides: [] };
  const where = (rows, clause, args) => {
    const conds = clause.split(/ AND /i).map(c => c.trim().match(/^(\w+) = \?$/)[1]);
    return rows.filter(r => conds.every((col, i) => r[col] === args[i]));
  };
  const changed = n => Object.assign([], { changes: n }); // run() surfaces D1's meta.changes
  const exec = (sql, args) => {
    const s = sql.trim().replace(/\s+/g, ' ');
    let m;
    if ((m = s.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i))) {
      const cols = m[2].split(',').map(c => c.trim());
      const row = Object.fromEntries(cols.map((c, i) => [c, args[i] ?? null]));
      const conflict = s.match(/ON CONFLICT\((\w+)\) DO NOTHING/i);
      if (conflict && tables[m[1]].some(r => r[conflict[1]] === row[conflict[1]])) return changed(0);
      tables[m[1]].push(row);
      return changed(1);
    }
    if ((m = s.match(/^SELECT \* FROM (\w+) WHERE (.+?)(?: ORDER BY .+)?$/i))) return where(tables[m[1]], m[2], args);
    if ((m = s.match(/^UPDATE (\w+) SET (.+) WHERE (\w+) = \?$/i))) {
      const cols = m[2].split(',').map(p => p.trim().match(/^(\w+) = \?$/)[1]);
      const row = tables[m[1]].find(r => r[m[3]] === args[cols.length]);
      if (row) cols.forEach((c, i) => (row[c] = args[i]));
      return changed(row ? 1 : 0);
    }
    if ((m = s.match(/^DELETE FROM (\w+) WHERE (\w+) = \?$/i))) {
      tables[m[1]] = tables[m[1]].filter(r => r[m[2]] !== args[0]);
      return changed(0);
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

const ORIGIN = 'https://bb.test';
const req = ({ origin = ORIGIN, cookie = null } = {}) =>
  new Request(ORIGIN + '/api/subscription/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: '{}',
  });
const cookieFor = token => `${SESSION_COOKIE}=${token}`;
const ENV = db => ({
  ACCOUNTS_DB: db,
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_PRICE_SUBSCRIPTION: 'price_x',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
});

/** Patch fetch to answer the Stripe REST calls; records every call { url, method, body, idem }. */
function stubStripe(handlers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const call = {
      url: u,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? new URLSearchParams(init.body) : null,
      idem: init.headers?.['Idempotency-Key'] ?? null,
    };
    calls.push(call);
    for (const [re, fn] of handlers) {
      const m = u.match(re);
      if (m) {
        const out = fn(call, m);
        return new Response(JSON.stringify(out.body ?? out), { status: out.status ?? 200 });
      }
    }
    return new Response('{}', { status: 404 });
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

// ARCHIVE FREEZE (docs/archive-freeze.md): /api/subscription/create starts a NEW subscription, so
// it's frozen unconditionally. The whole fresh-signup suite below is kept intact for a future
// revert but skipped while ARCHIVED, replaced with a single 410 assertion; subscription/cancel.ts
// (below, unaffected by the freeze) keeps running unconditionally either way.
if (!ARCHIVED) {
  console.log('Fail-closed gates:');
  {
    ok('503 when ACCOUNTS_DB unbound', (await subCreate({ request: req(), env: { STRIPE_SECRET_KEY: 'x' } })).status === 503);
    const db = mockDb();
    {
      const res = await subCreate({
        request: req(),
        env: { ACCOUNTS_DB: db, STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_SUBSCRIPTION: 'price_x' },
      });
      const j = await res.json();
      // A326: `error` carries the human sentence (the shared client api() surfaces it verbatim, and
      // SubscribeForm's fallback keys off /not configured/i); the machine code lives in `code`.
      ok(
        '501 when the Stripe env trio is incomplete (no publishable key)',
        res.status === 501 && /not configured/i.test(j.error) && j.code === 'not_configured'
      );
    }
    ok('cross-origin rejected 403', (await subCreate({ request: req({ origin: 'https://evil.example' }), env: ENV(db) })).status === 403);
    ok('401 without a session', (await subCreate({ request: req(), env: ENV(db) })).status === 401);
  }

  console.log('\nAlready-subscribed short-circuit:');
  {
    const db = mockDb();
    const user = await createUser(db, 'sub@example.com');
    const { token } = await createSession(db, user.id);
    db.tables.subscriptions.push({
      user_id: user.id,
      stripe_subscription_id: 'sub_live',
      stripe_customer_id: 'cus_live',
      status: 'active',
      current_period_end: Date.now() + 86400e3,
      updated: Date.now(),
      past_due_since: null,
      last_event_created: null,
    });
    const stub = stubStripe([]);
    try {
      const res = await subCreate({ request: req({ cookie: cookieFor(token) }), env: ENV(db) });
      const j = await res.json();
      ok(
        'active subscriber → { alreadySubscribed: true }, no Stripe call',
        res.status === 200 && j.alreadySubscribed === true && stub.calls.length === 0
      );
    } finally {
      stub.restore();
    }
  }

  console.log('\nCreate path (fresh user):');
  {
    const db = mockDb();
    const user = await createUser(db, 'new@example.com');
    const { token } = await createSession(db, user.id);
    const stub = stubStripe([
      [/\/v1\/customers$/, () => ({ id: 'cus_new' })],
      [/\/v1\/subscriptions$/, () => ({ id: 'sub_new', latest_invoice: { payment_intent: { client_secret: 'pi_secret_1' } } })],
    ]);
    try {
      const res = await subCreate({ request: req({ cookie: cookieFor(token) }), env: ENV(db) });
      const j = await res.json();
      ok(
        '200 with clientSecret + publishableKey',
        res.status === 200 && j.clientSecret === 'pi_secret_1' && j.publishableKey === 'pk_test_x'
      );
      const custCall = stub.calls.find(c => /\/customers$/.test(c.url));
      ok('customer created with the account linkage metadata', custCall?.body?.get('metadata[client_reference_id]') === user.id);
      ok('customer create is idempotent per user', custCall?.idem === `cust-create:${user.id}`);
      ok('customer id persisted on the user row', db.tables.users[0].stripe_customer_id === 'cus_new');
      const subCall = stub.calls.find(c => /\/subscriptions$/.test(c.url));
      ok(
        'subscription: server-resolved price + default_incomplete + linkage metadata',
        subCall?.body?.get('items[0][price]') === 'price_x' &&
          subCall?.body?.get('payment_behavior') === 'default_incomplete' &&
          subCall?.body?.get('metadata[client_reference_id]') === user.id
      );
      ok('subscription create is idempotent per user', subCall?.idem === `sub-create:${user.id}`);
      ok(
        'payment method saved onto the subscription',
        subCall?.body?.get('payment_settings[save_default_payment_method]') === 'on_subscription'
      );
    } finally {
      stub.restore();
    }
  }

  console.log('\nCustomer reuse + API-shape tolerance:');
  {
    const db = mockDb();
    const user = await createUser(db, 'reuse@example.com');
    db.tables.users[0].stripe_customer_id = 'cus_existing';
    const { token } = await createSession(db, user.id);
    const stub = stubStripe([
      // 2025+ API shape: confirmation_secret instead of payment_intent
      [/\/v1\/subscriptions$/, () => ({ id: 'sub_2', latest_invoice: { confirmation_secret: { client_secret: 'pi_secret_2' } } })],
    ]);
    try {
      const res = await subCreate({ request: req({ cookie: cookieFor(token) }), env: ENV(db) });
      const j = await res.json();
      ok('existing customer reused (no /customers call)', !stub.calls.some(c => /\/customers$/.test(c.url)));
      ok(
        'subscription created against the stored customer',
        stub.calls.find(c => /\/subscriptions$/.test(c.url))?.body?.get('customer') === 'cus_existing'
      );
      ok('confirmation_secret shape (2025+ API) still yields the client secret', res.status === 200 && j.clientSecret === 'pi_secret_2');
    } finally {
      stub.restore();
    }
  }

  console.log('\nIncomplete-subscription resume:');
  {
    const db = mockDb();
    const user = await createUser(db, 'resume@example.com');
    db.tables.users[0].stripe_customer_id = 'cus_r';
    const { token } = await createSession(db, user.id);
    db.tables.subscriptions.push({
      user_id: user.id,
      stripe_subscription_id: 'sub_incomplete',
      stripe_customer_id: 'cus_r',
      status: 'incomplete',
      current_period_end: null,
      updated: Date.now(),
      past_due_since: null,
      last_event_created: null,
    });
    const stub = stubStripe([
      [
        /\/v1\/subscriptions\/sub_incomplete\?/,
        () => ({ id: 'sub_incomplete', latest_invoice: { payment_intent: { client_secret: 'pi_resume' } } }),
      ],
    ]);
    try {
      const res = await subCreate({ request: req({ cookie: cookieFor(token) }), env: ENV(db) });
      const j = await res.json();
      ok(
        'incomplete subscription resumed (GET, no new POST /subscriptions)',
        res.status === 200 && j.clientSecret === 'pi_resume' && !stub.calls.some(c => c.method === 'POST' && /\/subscriptions$/.test(c.url))
      );
    } finally {
      stub.restore();
    }
  }

  console.log('\nStripe failure → clean 502:');
  {
    const db = mockDb();
    const user = await createUser(db, 'fail@example.com');
    const { token } = await createSession(db, user.id);
    const stub = stubStripe([[/\/v1\/customers$/, () => ({ status: 500, body: { error: { message: 'nope' } } })]]);
    try {
      const res = await subCreate({ request: req({ cookie: cookieFor(token) }), env: ENV(db) });
      const j = await res.json();
      ok(
        'customer-create failure → 502 with a human-readable error + subscription_failed code',
        res.status === 502 && j.error === 'Could not start the subscription.' && j.code === 'subscription_failed'
      );
    } finally {
      stub.restore();
    }
  }
} else {
  console.log('subscription/create (frozen — Archive Freeze):');
  const db = mockDb();
  const user = await createUser(db, 'archived@example.com');
  const { token } = await createSession(db, user.id);
  const res = await subCreate({ request: req({ cookie: cookieFor(token) }), env: ENV(db) });
  const j = await res.json();
  ok('subscription/create frozen: 410 archived', res.status === 410 && j.code === 'archived');
  console.log('  (skipped — archive freeze: subscription/create fresh-signup suites)');
}

/* ---- A333: self-serve cancel / resume (functions/api/subscription/cancel.ts) ---------------- */

const cancelReq = ({ origin = ORIGIN, cookie = null, body = '{}' } = {}) =>
  new Request(ORIGIN + '/api/subscription/cancel', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
  });
const subRow = (userId, over = {}) => ({
  user_id: userId,
  stripe_subscription_id: 'sub_live',
  stripe_customer_id: 'cus_live',
  status: 'active',
  current_period_end: Date.now() + 20 * 86400e3,
  updated: Date.now(),
  past_due_since: null,
  last_event_created: null,
  cancel_at_period_end: 0,
  ...over,
});

console.log('\nCancel — gates:');
{
  const db = mockDb();
  ok('cancel: 503 when ACCOUNTS_DB unbound', (await subCancel({ request: cancelReq(), env: { STRIPE_SECRET_KEY: 'x' } })).status === 503);
  ok('cancel: 501 without STRIPE_SECRET_KEY', (await subCancel({ request: cancelReq(), env: { ACCOUNTS_DB: db } })).status === 501);
  ok(
    'cancel: cross-origin rejected 403',
    (await subCancel({ request: cancelReq({ origin: 'https://evil.example' }), env: ENV(db) })).status === 403
  );
  ok('cancel: 401 without a session', (await subCancel({ request: cancelReq(), env: ENV(db) })).status === 401);
  const user = await createUser(db, 'nosub@example.com');
  const { token } = await createSession(db, user.id);
  const res = await subCancel({ request: cancelReq({ cookie: cookieFor(token) }), env: ENV(db) });
  const j = await res.json();
  ok('cancel: 404 no_subscription when the user has no cancelable row', res.status === 404 && j.code === 'no_subscription');
}

console.log('\nCancel — schedules cancel_at_period_end via Stripe (never touches tier/status):');
{
  const db = mockDb();
  const user = await createUser(db, 'cancel@example.com');
  const { token } = await createSession(db, user.id);
  const periodEndSec = Math.floor((Date.now() + 20 * 86400e3) / 1000);
  db.tables.subscriptions.push(subRow(user.id));
  const stub = stubStripe([
    [
      /\/v1\/subscriptions\/sub_live$/,
      call => ({
        id: 'sub_live',
        cancel_at_period_end: call.body?.get('cancel_at_period_end') === 'true',
        current_period_end: periodEndSec,
      }),
    ],
  ]);
  try {
    const res = await subCancel({ request: cancelReq({ cookie: cookieFor(token) }), env: ENV(db) });
    const j = await res.json();
    const call = stub.calls[0];
    ok(
      'cancel: Stripe called with cancel_at_period_end=true on the stored subscription id',
      call && /sub_live$/.test(call.url) && call.body?.get('cancel_at_period_end') === 'true'
    );
    ok(
      'cancel: 200 { cancelAtPeriodEnd: true, currentPeriodEnd } (seconds converted to ms)',
      res.status === 200 && j.cancelAtPeriodEnd === true && j.currentPeriodEnd === periodEndSec * 1000
    );
    const row = db.tables.subscriptions.find(r => r.user_id === user.id);
    ok(
      'cancel: row flag flipped; status/tier untouched (webhook stays the lifecycle writer)',
      row.cancel_at_period_end === 1 && row.status === 'active'
    );
    // resume clears the flag while still in-period
    const res2 = await subCancel({ request: cancelReq({ cookie: cookieFor(token), body: '{"resume":true}' }), env: ENV(db) });
    const j2 = await res2.json();
    const call2 = stub.calls[1];
    ok(
      'resume: Stripe called with cancel_at_period_end=false and the flag clears',
      res2.status === 200 &&
        j2.cancelAtPeriodEnd === false &&
        call2.body?.get('cancel_at_period_end') === 'false' &&
        db.tables.subscriptions.find(r => r.user_id === user.id).cancel_at_period_end === 0
    );
  } finally {
    stub.restore();
  }
}

console.log('\nCancel — failure paths:');
{
  const db = mockDb();
  const user = await createUser(db, 'cancelfail@example.com');
  const { token } = await createSession(db, user.id);
  db.tables.subscriptions.push(subRow(user.id));
  const stub = stubStripe([[/\/v1\/subscriptions\/sub_live$/, () => ({ status: 500, body: { error: { message: 'nope' } } })]]);
  try {
    const res = await subCancel({ request: cancelReq({ cookie: cookieFor(token) }), env: ENV(db) });
    const j = await res.json();
    ok(
      'cancel: Stripe failure → 502 human error + cancel_failed code, row flag unchanged',
      res.status === 502 &&
        j.code === 'cancel_failed' &&
        typeof j.error === 'string' &&
        !/_/.test(j.error) &&
        db.tables.subscriptions.find(r => r.user_id === user.id).cancel_at_period_end === 0
    );
  } finally {
    stub.restore();
  }
  // an already-canceled subscription (rides out the period) has nothing to toggle
  const db2 = mockDb();
  const user2 = await createUser(db2, 'ridden@example.com');
  const { token: token2 } = await createSession(db2, user2.id);
  db2.tables.subscriptions.push(subRow(user2.id, { status: 'canceled' }));
  ok(
    'cancel: 404 for a fully-canceled subscription (nothing to toggle)',
    (await subCancel({ request: cancelReq({ cookie: cookieFor(token2) }), env: ENV(db2) })).status === 404
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
