/* Tests for the changelog-email subscription layer (F44) — functions/_lib/subscribers.ts +
   the subscribe/confirm/unsubscribe/notify-changelog endpoints. Run: node scripts/test-email.mjs
   Style mirrors scripts/test-accounts.mjs: Node built-ins only, endpoints exercised with a mocked
   env — an in-memory D1 stub interpreting exactly the SQL the helpers issue, plus a fetch() stub for
   Resend (single + batch) / the changelog JSON / Turnstile siteverify. Covers OUR logic: double
   opt-in, enumeration-safety, per-address cooldown (S22), one-click unsubscribe hard-delete, the
   confirmed-only + idempotent broadcast, and the S22/S25 fail-closed/fail-open postures. */
import {
  normalizeEmail,
  constantTimeEqual,
  verifyTurnstile,
  subscriberByEmail,
  purgePending,
  createSubscriber,
  confirmSubscriber,
  canResend,
  RESEND_COOLDOWN_MS,
  PENDING_TTL_MS,
} from '../functions/_lib/subscribers.ts';
import { onRequestPost as subscribe } from '../functions/api/subscribe.ts';
import { onRequestGet as confirmGet, onRequestPost as confirmPost } from '../functions/api/confirm.ts';
import { onRequestGet as unsubscribeGet, onRequestPost as unsubscribePost } from '../functions/api/unsubscribe.ts';
import { onRequestPost as notify } from '../functions/api/notify-changelog.ts';

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

/* ---- in-memory D1 stub (subscribers + changelog_sends) ------------------------------------------ */
function mockDb() {
  const tables = { subscribers: [], changelog_sends: [] };
  const exec = (sql, args) => {
    const s = sql.trim().replace(/\s+/g, ' ');
    let m;
    if ((m = s.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i))) {
      const cols = m[2].split(',').map(c => c.trim());
      const row = Object.fromEntries(cols.map((c, i) => [c, args[i] ?? null]));
      const t = tables[m[1]];
      if (m[1] === 'subscribers') {
        if (t.some(r => r.id === row.id)) throw new Error('UNIQUE constraint failed: subscribers.id');
        if (t.some(r => r.email === row.email)) throw new Error('UNIQUE constraint failed: subscribers.email');
      }
      if (m[1] === 'changelog_sends' && t.some(r => r.version === row.version))
        throw new Error('UNIQUE constraint failed: changelog_sends.version');
      t.push(row);
      return [];
    }
    if ((m = s.match(/^SELECT \* FROM (\w+) WHERE (\w+) = \?$/i))) return tables[m[1]].filter(r => r[m[2]] === args[0]);
    if ((m = s.match(/^UPDATE (\w+) SET (.+) WHERE id = \?$/i))) {
      const cols = m[2].split(',').map(p => p.trim().match(/^(\w+) = \?$/)[1]);
      const row = tables[m[1]].find(r => r.id === args[cols.length]);
      if (row) cols.forEach((c, i) => (row[c] = args[i]));
      return [];
    }
    if ((m = s.match(/^DELETE FROM (\w+) WHERE status = \? AND created_at < \?$/i))) {
      tables[m[1]] = tables[m[1]].filter(r => !(r.status === args[0] && r.created_at < args[1]));
      return [];
    }
    if ((m = s.match(/^DELETE FROM (\w+) WHERE id = \?$/i))) {
      tables[m[1]] = tables[m[1]].filter(r => r.id !== args[0]);
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

/* ---- fetch stub (Resend single/batch, changelog JSON, Turnstile) -------------------------------- */
const CHANGELOG = {
  releases: [
    {
      version: '9.9.9',
      date: '2026-07-06',
      title: 'A shiny new release',
      summary: 'Lots of good stuff.',
      highlights: ['Faster', 'Prettier'],
    },
    { version: '9.9.8', date: '2026-07-05', title: 'Older', summary: 'Prior.' },
  ],
};
function installFetch({ turnstile = 'ok', changelogOk = true } = {}) {
  const sent = { single: [], batch: [] }; // captured Resend calls
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('turnstile/v0/siteverify')) {
      if (turnstile === 'network') throw new Error('network down');
      return new Response(JSON.stringify({ success: turnstile === 'ok' }), { status: 200 });
    }
    if (u.includes('/data/changelog.json')) {
      return changelogOk ? new Response(JSON.stringify(CHANGELOG), { status: 200 }) : new Response('nope', { status: 500 });
    }
    if (u === 'https://api.resend.com/emails/batch') {
      sent.batch.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (u === 'https://api.resend.com/emails') {
      sent.single.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
    }
    throw new Error('fetch stub: unexpected ' + u);
  };
  return { sent, restore: () => (globalThis.fetch = real) };
}

const ORIGIN = 'https://bb.test';
const req = (path, { method = 'POST', origin = ORIGIN, body = {} } = {}) =>
  new Request(ORIGIN + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
const getReq = path => new Request(ORIGIN + path, { method: 'GET' });
const RESEND_ENV = { RESEND_API_KEY: 're_x' };

console.log('normalizeEmail:');
{
  ok('lowercases + trims', normalizeEmail('  Trader@Example.COM ') === 'trader@example.com');
  ok('rejects junk', normalizeEmail('not-an-email') === null);
  ok('rejects empty / non-string', normalizeEmail('') === null && normalizeEmail(42) === null);
  ok('rejects an over-long address', normalizeEmail('a'.repeat(250) + '@b.co') === null);
}

console.log('\nconstantTimeEqual:');
{
  ok('equal strings compare true', (await constantTimeEqual('s3cret', 's3cret')) === true);
  ok('different strings compare false', (await constantTimeEqual('s3cret', 's3creX')) === false);
  ok('different lengths compare false', (await constantTimeEqual('a', 'aa')) === false);
}

console.log('\nverifyTurnstile (defense-in-depth, S22):');
{
  ok('unconfigured → skip (true)', (await verifyTurnstile({}, undefined)) === true);
  {
    const f = installFetch({ turnstile: 'ok' });
    try {
      ok('configured + valid token → true', (await verifyTurnstile({ TURNSTILE_SECRET: 's' }, 'tok')) === true);
    } finally {
      f.restore();
    }
  }
  {
    const f = installFetch({ turnstile: 'bad' });
    try {
      ok('configured + invalid token → false', (await verifyTurnstile({ TURNSTILE_SECRET: 's' }, 'tok')) === false);
      ok('configured + MISSING token → false', (await verifyTurnstile({ TURNSTILE_SECRET: 's' }, undefined)) === false);
    } finally {
      f.restore();
    }
  }
  {
    const f = installFetch({ turnstile: 'network' });
    try {
      ok('configured + service down → true (fail open)', (await verifyTurnstile({ TURNSTILE_SECRET: 's' }, 'tok')) === true);
    } finally {
      f.restore();
    }
  }
}

console.log('\nsubscribe — fail-closed shapes + validation:');
{
  const db = mockDb();
  ok('db unbound → 503', (await subscribe({ request: req('/api/subscribe', { body: { email: 'a@b.co' } }), env: {} })).status === 503);
  ok(
    'cross-origin → 403',
    (
      await subscribe({
        request: req('/api/subscribe', { origin: 'https://evil.example', body: { email: 'a@b.co' } }),
        env: { ACCOUNTS_DB: db },
      })
    ).status === 403
  );
  ok(
    'bad email → 400',
    (await subscribe({ request: req('/api/subscribe', { body: { email: 'nope' } }), env: { ACCOUNTS_DB: db } })).status === 400
  );
  const noResend = await subscribe({ request: req('/api/subscribe', { body: { email: 'a@b.co' } }), env: { ACCOUNTS_DB: db } });
  ok('RESEND unbound → 503 email unavailable', noResend.status === 503 && (await noResend.json()).error === 'email unavailable');
  // the RESEND-unbound check ran BEFORE any write — no row created
  ok('nothing written when email unconfigured', db.tables.subscribers.length === 0);
}

console.log('\nsubscribe — double opt-in happy path + enumeration-safety:');
{
  const f = installFetch();
  try {
    const db = mockDb();
    const env = { ACCOUNTS_DB: db, ...RESEND_ENV };
    const r1 = await subscribe({ request: req('/api/subscribe', { body: { email: 'New@Trader.com' } }), env });
    const b1 = await r1.text();
    ok('new signup → 200 generic', r1.status === 200 && JSON.parse(b1).ok === true);
    ok('pending row created (lowercased)', db.tables.subscribers.length === 1 && db.tables.subscribers[0].email === 'new@trader.com');
    ok('row starts pending, unconfirmed', db.tables.subscribers[0].status === 'pending' && db.tables.subscribers[0].confirmed_at == null);
    ok(
      'confirm mail sent once with a /api/confirm link',
      f.sent.single.length === 1 && /\/api\/confirm\?token=/.test(f.sent.single[0].html)
    );
    ok('raw secret is NOT stored (only its hash)', !f.sent.single[0].html.includes(db.tables.subscribers[0].confirm_token_hash));

    // Re-subscribe of the SAME pending address within the cooldown → no second mail, same generic body.
    const r2 = await subscribe({ request: req('/api/subscribe', { body: { email: 'new@trader.com' } }), env });
    const b2 = await r2.text();
    ok('pending re-signup within cooldown → still 200, no new mail', r2.status === 200 && f.sent.single.length === 1);
    ok('enumeration-safe: identical generic body for new vs existing', b1 === b2);

    // Confirm it, then re-subscribe a CONFIRMED address → silent no-op (no mail).
    const token = f.sent.single[0].html.match(/token=([^"&]+)/)[1];
    await confirmSubscriber(db, decodeURIComponent(token));
    ok('address now confirmed', db.tables.subscribers[0].status === 'confirmed');
    const r3 = await subscribe({ request: req('/api/subscribe', { body: { email: 'new@trader.com' } }), env });
    ok('confirmed re-signup → 200, NO mail', r3.status === 200 && f.sent.single.length === 1);
  } finally {
    f.restore();
  }
}

console.log('\nsubscribe — per-address cooldown resend (S22):');
{
  const f = installFetch();
  try {
    const db = mockDb();
    const env = { ACCOUNTS_DB: db, ...RESEND_ENV };
    await subscribe({ request: req('/api/subscribe', { body: { email: 'wait@b.co' } }), env });
    ok('first mail sent', f.sent.single.length === 1);
    // simulate the cooldown elapsing
    db.tables.subscribers[0].last_sent_at = Date.now() - RESEND_COOLDOWN_MS - 1000;
    const before = db.tables.subscribers[0].confirm_token_hash;
    await subscribe({ request: req('/api/subscribe', { body: { email: 'wait@b.co' } }), env });
    ok('past the cooldown → confirm mail re-sent', f.sent.single.length === 2);
    ok('...with a freshly-minted confirm token', db.tables.subscribers[0].confirm_token_hash !== before);
    ok(
      'canResend gate reflects last_sent_at',
      canResend({ last_sent_at: Date.now() }) === false && canResend({ last_sent_at: 0 }) === true
    );
  } finally {
    f.restore();
  }
}

console.log('\nconfirm — flip pending → confirmed:');
{
  const f = installFetch();
  try {
    const db = mockDb();
    const env = { ACCOUNTS_DB: db, ...RESEND_ENV };
    await subscribe({ request: req('/api/subscribe', { body: { email: 'c@b.co' } }), env });
    const token = decodeURIComponent(f.sent.single[0].html.match(/token=([^"&]+)/)[1]);

    // wrong secret must be rejected without confirming
    const badId = token.split('.')[0];
    const bad = await confirmPost({ request: req('/api/confirm', { body: { token: badId + '.' + 'z'.repeat(43) } }), env });
    ok('POST confirm with a wrong secret → 400', bad.status === 400 && db.tables.subscribers[0].status === 'pending');

    // GET (email click) confirms + redirects
    const gr = await confirmGet({ request: getReq('/api/confirm?token=' + encodeURIComponent(token)), env });
    ok('GET confirm → 302 subscribed=1', gr.status === 302 && /subscribed=1/.test(gr.headers.get('Location') || ''));
    ok(
      '...row now confirmed with a timestamp',
      db.tables.subscribers[0].status === 'confirmed' && db.tables.subscribers[0].confirmed_at != null
    );

    // idempotent: a second click is still a success (already-confirmed)
    const again = await confirmGet({ request: getReq('/api/confirm?token=' + encodeURIComponent(token)), env });
    ok('GET confirm again → idempotent 302 subscribed=1', again.status === 302 && /subscribed=1/.test(again.headers.get('Location') || ''));

    // a garbage token: GET → error redirect, POST → 400
    const bg = await confirmGet({ request: getReq('/api/confirm?token=bogus.tok'), env });
    ok('GET confirm bad token → 302 subscribe=error', bg.status === 302 && /subscribe=error/.test(bg.headers.get('Location') || ''));
    ok(
      'confirm 503 when ACCOUNTS_DB unbound',
      (await confirmPost({ request: req('/api/confirm', { body: { token } }), env: {} })).status === 503
    );
  } finally {
    f.restore();
  }
}

console.log('\nunsubscribe — one-click hard delete, idempotent:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db };
  const { unsubToken } = await createSubscriber(db, 'gone@b.co');
  ok('seed row exists', db.tables.subscribers.length === 1);
  const gr = await unsubscribeGet({ request: getReq('/api/unsubscribe?token=' + encodeURIComponent(unsubToken)), env });
  ok('GET unsubscribe → 302 unsubscribed=1', gr.status === 302 && /unsubscribed=1/.test(gr.headers.get('Location') || ''));
  ok('row HARD-deleted', db.tables.subscribers.length === 0);
  // idempotent: same (now-dangling) token still succeeds, no error/enumeration
  const again = await unsubscribeGet({ request: getReq('/api/unsubscribe?token=' + encodeURIComponent(unsubToken)), env });
  ok('GET unsubscribe again → still 302 (idempotent)', again.status === 302);
  // one-click POST (List-Unsubscribe-Post) → 200
  const { unsubToken: t2 } = await createSubscriber(db, 'gone2@b.co');
  const post = await unsubscribePost({
    request: new Request(ORIGIN + '/api/unsubscribe?token=' + encodeURIComponent(t2), { method: 'POST' }),
    env,
  });
  ok('POST one-click unsubscribe → 200 + row gone', post.status === 200 && !db.tables.subscribers.some(r => r.email === 'gone2@b.co'));
  // bad token → still 200/302 (no reveal); db unbound → 503
  const badPost = await unsubscribePost({ request: new Request(ORIGIN + '/api/unsubscribe?token=bad.tok', { method: 'POST' }), env });
  ok('POST unsubscribe bad token → 200 (no enumeration)', badPost.status === 200);
  ok(
    'unsubscribe 503 when ACCOUNTS_DB unbound',
    (await unsubscribeGet({ request: getReq('/api/unsubscribe?token=x.y'), env: {} })).status === 503
  );
}

console.log('\nnotify-changelog — auth gate:');
{
  const db = mockDb();
  const noSecret = await notify({ request: req('/api/notify-changelog'), env: { ACCOUNTS_DB: db, ...RESEND_ENV } });
  ok('CHANGELOG_NOTIFY_SECRET unbound → 503 (endpoint disabled)', noSecret.status === 503);
  const env = { ACCOUNTS_DB: db, ...RESEND_ENV, CHANGELOG_NOTIFY_SECRET: 'sekret' };
  const noHdr = await notify({ request: req('/api/notify-changelog'), env });
  ok('no secret header → 401', noHdr.status === 401);
  const badHdr = await notify({
    request: new Request(ORIGIN + '/api/notify-changelog', { method: 'POST', headers: { 'x-changelog-secret': 'wrong' } }),
    env,
  });
  ok('wrong secret → 401', badHdr.status === 401);
}

console.log('\nnotify-changelog — confirmed-only broadcast + idempotency:');
{
  const f = installFetch();
  try {
    const db = mockDb();
    const env = { ACCOUNTS_DB: db, ...RESEND_ENV, CHANGELOG_NOTIFY_SECRET: 'sekret' };
    // two confirmed + one pending
    for (const e of ['a@list.co', 'b@list.co']) {
      const { confirmToken } = await createSubscriber(db, e);
      await confirmSubscriber(db, confirmToken);
    }
    await createSubscriber(db, 'pending@list.co'); // stays pending — must NOT be mailed

    const send = notifyReq(env, 'sekret');
    const r = await send();
    const j = await r.json();
    ok('notify → 200', r.status === 200);
    ok('broadcasts version 9.9.9 to the 2 confirmed only', j.version === '9.9.9' && j.recipients === 2 && j.sent === 2);
    ok('one batch call (≤100/call, under the 50-subrequest cap)', f.sent.batch.length === 1 && f.sent.batch[0].length === 2);
    const toAll = f.sent.batch[0].map(m => m.to[0]).sort();
    ok('pending address was NOT included', toAll.join(',') === 'a@list.co,b@list.co');
    const msg = f.sent.batch[0][0];
    ok('each message carries a per-recipient unsubscribe link', /\/api\/unsubscribe\?token=/.test(msg.html));
    ok(
      '...and List-Unsubscribe(-Post) headers',
      msg.headers['List-Unsubscribe'].includes('/api/unsubscribe?token=') &&
        msg.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click'
    );
    ok('subject carries the version + title', msg.subject === 'Blotterbook 9.9.9 — A shiny new release');
    ok('send recorded in the ledger', db.tables.changelog_sends.length === 1 && db.tables.changelog_sends[0].version === '9.9.9');

    // re-run → deduped, no second batch
    const r2 = await send();
    const j2 = await r2.json();
    ok('re-run is deduped (no second send)', r2.status === 200 && j2.deduped === true && f.sent.batch.length === 1);
  } finally {
    f.restore();
  }
}

console.log('\nnotify-changelog — deploy-freshness gate (?version=):');
{
  const f = installFetch();
  try {
    const db = mockDb();
    const env = { ACCOUNTS_DB: db, ...RESEND_ENV, CHANGELOG_NOTIFY_SECRET: 'sekret' };
    const notifyVersion = version =>
      notify({
        request: new Request(`${ORIGIN}/api/notify-changelog?version=${version}`, {
          method: 'POST',
          headers: { 'x-changelog-secret': 'sekret' },
        }),
        env,
      });

    // live top release is 9.9.9 (mock) — a stale expectation means the deploy isn't live yet.
    const early = await notifyVersion('1.0.0');
    ok('stale ?version → 425 (deploy not live), nothing sent or ledgered', early.status === 425 && db.tables.changelog_sends.length === 0);
    ok('...425 body reports expected vs live', (await early.json()).live === '9.9.9');

    // matching version → proceeds to the normal (idempotent) send.
    const live = await notifyVersion('9.9.9');
    ok('matching ?version → 200 send', live.status === 200 && (await live.json()).version === '9.9.9');
  } finally {
    f.restore();
  }
}

console.log('\nnotify-changelog — 0 recipients still ledgers; fail-closed shapes:');
{
  const f = installFetch();
  try {
    const db = mockDb();
    const env = { ACCOUNTS_DB: db, ...RESEND_ENV, CHANGELOG_NOTIFY_SECRET: 'sekret' };
    const r = await notifyReq(env, 'sekret')();
    ok('no confirmed subscribers → still 200, 0 sent', r.status === 200 && (await r.clone().json()).sent === 0);
    ok(
      '...and the version is ledgered (idempotent, no batch attempted)',
      db.tables.changelog_sends.length === 1 && f.sent.batch.length === 0
    );
    // fail-closed: DB / RESEND unbound
    ok(
      'notify 503 when ACCOUNTS_DB unbound',
      (await notifyReq({ ...RESEND_ENV, CHANGELOG_NOTIFY_SECRET: 'sekret' }, 'sekret')()).status === 503
    );
    const noResend = await notifyReq({ ACCOUNTS_DB: mockDb(), CHANGELOG_NOTIFY_SECRET: 'sekret' }, 'sekret')();
    ok(
      'notify 503 email unavailable when RESEND unbound',
      noResend.status === 503 && (await noResend.json()).error === 'email unavailable'
    );
  } finally {
    f.restore();
  }
}

console.log('\npurgePending — unconfirmed rows older than the TTL are swept:');
{
  const db = mockDb();
  const { confirmToken } = await createSubscriber(db, 'keep@b.co');
  await confirmSubscriber(db, confirmToken); // confirmed — must survive
  await createSubscriber(db, 'fresh@b.co'); // pending, recent — must survive
  await createSubscriber(db, 'stale@b.co');
  db.tables.subscribers.find(r => r.email === 'stale@b.co').created_at = Date.now() - PENDING_TTL_MS - 1000;
  await purgePending(db);
  const emails = db.tables.subscribers.map(r => r.email).sort();
  ok('stale pending removed; confirmed + fresh kept', emails.join(',') === 'fresh@b.co,keep@b.co');
  ok('confirmed row is never purged regardless of age', !!(await subscriberByEmail(db, 'keep@b.co')));
}

// helper: POST /api/notify-changelog with a secret header
function notifyReq(env, secret) {
  return () =>
    notify({
      request: new Request(ORIGIN + '/api/notify-changelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-changelog-secret': secret },
      }),
      env,
    });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
