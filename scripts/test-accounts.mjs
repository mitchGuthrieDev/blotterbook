/* Tests for the accounts layer (F53) — functions/_lib/accounts.ts + the passkey ceremony
   endpoints. Run: node scripts/test-accounts.mjs
   Style mirrors scripts/test-auth.mjs: Node built-ins only, endpoints exercised with mocked
   env — here an in-memory D1 stub that interprets exactly the SQL the helpers issue.
   The WebAuthn attestation/assertion crypto itself is @simplewebauthn/server's (tested
   upstream); these tests cover OUR logic: session token hash/verify, challenge single-use +
   TTL (S25), Origin checks, fail-closed ACCOUNTS_DB behavior, and the /api/me shapes. */
import {
  SESSION_COOKIE,
  createSession,
  sessionFromRequest,
  destroySession,
  sessionSetCookie,
  sessionClearCookie,
  putChallenge,
  consumeChallenge,
  checkOrigin,
  sha256b64u,
  createUser,
  insertCredential,
} from '../functions/_lib/accounts.ts';
import { onRequestGet as meGet } from '../functions/api/me.ts';
import { onRequestPost as registerOptions } from '../functions/api/account/register-options.ts';
import { onRequestPost as registerVerify } from '../functions/api/account/register-verify.ts';
import { onRequestPost as loginOptions } from '../functions/api/account/login-options.ts';
import { onRequestPost as loginVerify } from '../functions/api/account/login-verify.ts';
import { onRequestPost as logout } from '../functions/api/account/logout.ts';

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

/* ---- in-memory D1 stub -------------------------------------------------------------------
   Interprets the fixed statement set accounts.ts issues (INSERT/SELECT/UPDATE/DELETE with
   `col = ?` conditions). Throws on anything unrecognized so a new query can't silently no-op. */
function mockDb() {
  const tables = { users: [], credentials: [], sessions: [], challenges: [] };
  const where = (rows, clause, args, offset = 0) => {
    const conds = clause.split(/ AND /i).map(c => c.trim().match(/^(\w+) = \?$/)[1]);
    return rows.filter(r => conds.every((col, i) => r[col] === args[offset + i]));
  };
  const exec = (sql, args) => {
    const s = sql.trim().replace(/\s+/g, ' ');
    let m;
    if ((m = s.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i))) {
      const cols = m[2].split(',').map(c => c.trim());
      const row = Object.fromEntries(cols.map((c, i) => [c, args[i] ?? null]));
      const t = tables[m[1]];
      if (t.some(r => r.id === row.id)) throw new Error(`UNIQUE constraint failed: ${m[1]}.id`);
      if (m[1] === 'users' && t.some(r => r.email === row.email)) throw new Error('UNIQUE constraint failed: users.email');
      t.push(row);
      return [];
    }
    if ((m = s.match(/^SELECT \* FROM (\w+) WHERE (.+?)(?: ORDER BY .+)?$/i))) return where(tables[m[1]], m[2], args);
    if ((m = s.match(/^UPDATE (\w+) SET (.+) WHERE id = \?$/i))) {
      const cols = m[2].split(',').map(p => p.trim().match(/^(\w+) = \?$/)[1]);
      const row = tables[m[1]].find(r => r.id === args[cols.length]);
      if (row) cols.forEach((c, i) => (row[c] = args[i]));
      return [];
    }
    if ((m = s.match(/^DELETE FROM (\w+) WHERE expires_at < \?$/i))) {
      tables[m[1]] = tables[m[1]].filter(r => !(r.expires_at < args[0]));
      return [];
    }
    if ((m = s.match(/^DELETE FROM (\w+) WHERE (\w+) = \?$/i))) {
      tables[m[1]] = tables[m[1]].filter(r => r[m[2]] !== args[0]);
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

const ORIGIN = 'https://bb.test';
const req = (path, { method = 'POST', origin = ORIGIN, cookie = null, body = {} } = {}) =>
  new Request(ORIGIN + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
const cookieFor = token => `${SESSION_COOKIE}=${token}`;
const clientDataFor = challenge => Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge })).toString('base64url');
const DAY = 24 * 3600 * 1000;

console.log('Session token hash/verify round-trip:');
{
  const db = mockDb();
  const { token, expiresAt } = await createSession(db, 'u1');
  ok('token is id.secret shaped', token.split('.').length === 2 && token.split('.').every(p => p.length >= 16));
  ok('expiry ~30 days out', expiresAt > Date.now() + 29 * DAY);
  const row = db.tables.sessions[0];
  ok('raw secret never stored', !token.includes(row.secret_hash) && row.secret_hash !== token.split('.')[1]);
  ok('stored hash = SHA-256(secret)', row.secret_hash === (await sha256b64u(token.split('.')[1])));
  const lookup = t => sessionFromRequest(req('/api/me', { method: 'GET', cookie: cookieFor(t) }), db);
  ok('valid token resolves the session', (await lookup(token))?.user_id === 'u1');
  ok('wrong secret rejected', (await lookup(token.split('.')[0] + '.' + 'x'.repeat(43))) === null);
  ok('unknown session id rejected', (await lookup('bogus-id.' + token.split('.')[1])) === null);
  ok('garbage token rejected', (await lookup('not-a-token')) === null);
  ok('no cookie rejected', (await sessionFromRequest(req('/api/me', { method: 'GET' }), db)) === null);
  const before = db.tables.sessions[0].expires_at;
  await new Promise(r => setTimeout(r, 3));
  await lookup(token);
  ok('sliding expiry extends on use', db.tables.sessions[0].expires_at > before);
  // expired sessions are rejected AND reaped
  const { token: old } = await createSession(db, 'u2', Date.now() - 31 * DAY);
  ok('expired session rejected', (await lookup(old)) === null);
  ok('expired session row deleted', !db.tables.sessions.some(s => s.user_id === 'u2'));
  await destroySession(req('/x', { cookie: cookieFor(token) }), db);
  ok('destroySession revokes it', (await lookup(token)) === null);
  ok(
    'set-cookie is __Host- + HttpOnly + Secure + Lax',
    /^__Host-.*HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/.test(sessionSetCookie('t.s'))
  );
  ok('clear-cookie zeroes Max-Age', sessionClearCookie().includes('Max-Age=0'));
}

console.log('\nChallenge single-use + TTL (S25):');
{
  const db = mockDb();
  await putChallenge(db, { type: 'register', challenge: 'chal-1', email: 'a@b.co' });
  const first = await consumeChallenge(db, 'chal-1', 'register');
  ok('pending challenge consumes once (email carried)', first?.email === 'a@b.co');
  ok('second consume returns null (single-use)', (await consumeChallenge(db, 'chal-1', 'register')) === null);
  await putChallenge(db, { type: 'login', challenge: 'chal-2' });
  ok('wrong ceremony type rejected', (await consumeChallenge(db, 'chal-2', 'register')) === null);
  ok(
    '...and the wrong-type attempt did not consume it',
    db.tables.challenges.some(c => c.challenge === 'chal-2')
  );
  await putChallenge(db, { type: 'login', challenge: 'chal-old' }, Date.now() - 10 * 60 * 1000);
  ok('expired challenge rejected', (await consumeChallenge(db, 'chal-old', 'login')) === null);
  await putChallenge(db, { type: 'login', challenge: 'chal-old2' }, Date.now() - 10 * 60 * 1000);
  await putChallenge(db, { type: 'login', challenge: 'chal-3' }); // put sweeps expired rows
  ok('expired rows swept on next put', !db.tables.challenges.some(c => c.challenge === 'chal-old2'));
}

console.log('\nOrigin check on mutating routes:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db };
  ok('same-origin passes', checkOrigin(req('/api/account/logout')));
  ok('missing Origin fails closed', !checkOrigin(req('/api/account/logout', { origin: null })));
  ok('cross-origin fails', !checkOrigin(req('/api/account/logout', { origin: 'https://evil.example' })));
  for (const [name, fn, body] of [
    ['register-options', registerOptions, { email: 'x@y.co' }],
    ['register-verify', registerVerify, {}],
    ['login-options', loginOptions, {}],
    ['login-verify', loginVerify, {}],
    ['logout', logout, {}],
  ]) {
    const r = await fn({ request: req(`/api/account/${name}`, { origin: 'https://evil.example', body }), env });
    ok(`${name} rejects cross-origin with 403`, r.status === 403);
  }
}

console.log('\nFail-closed when ACCOUNTS_DB is unbound:');
{
  const env = {}; // no binding
  for (const [name, fn] of [
    ['register-options', registerOptions],
    ['register-verify', registerVerify],
    ['login-options', loginOptions],
    ['login-verify', loginVerify],
    ['logout', logout],
  ]) {
    const r = await fn({ request: req(`/api/account/${name}`), env });
    const j = await r.json();
    ok(`${name} → 503 naming ACCOUNTS_DB`, r.status === 503 && /ACCOUNTS_DB/.test(j.error));
  }
  const me = await meGet({ request: req('/api/me', { method: 'GET' }), env });
  const j = await me.json();
  ok('/api/me stays anonymous-shaped (200), not 503', me.status === 200 && j.tier === 'local' && j.cloudSync === false && !('user' in j));
}

console.log('\nCeremony option endpoints (mocked D1):');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db };
  // login-options: usernameless — no allowCredentials, challenge stored single-use
  const lo = await loginOptions({ request: req('/api/account/login-options'), env });
  const loJson = await lo.json();
  ok('login-options 200 with a challenge', lo.status === 200 && typeof loJson.options?.challenge === 'string');
  ok('login-options omits allowCredentials (usernameless)', !(loJson.options.allowCredentials ?? []).length);
  ok(
    'login challenge stored with TTL',
    db.tables.challenges.some(c => c.challenge === loJson.options.challenge && c.type === 'login' && c.expires_at > Date.now())
  );
  // register-options: email validation + duplicate rejection + stored register challenge
  const bad = await registerOptions({ request: req('/api/account/register-options', { body: { email: 'not-an-email' } }), env });
  ok('register-options rejects a bad email (400)', bad.status === 400);
  const ro = await registerOptions({ request: req('/api/account/register-options', { body: { email: 'Trader@Example.com ' } }), env });
  const roJson = await ro.json();
  ok(
    'register-options 200 with creation options',
    ro.status === 200 && typeof roJson.options?.challenge === 'string' && roJson.options.user?.name === 'trader@example.com'
  );
  ok('register-options requires a discoverable credential', roJson.options.authenticatorSelection?.residentKey === 'required');
  const chRow = db.tables.challenges.find(c => c.challenge === roJson.options.challenge);
  ok('register challenge holds the email server-side', chRow?.type === 'register' && chRow?.email === 'trader@example.com');
  await createUser(db, 'taken@example.com');
  const dup = await registerOptions({ request: req('/api/account/register-options', { body: { email: 'taken@example.com' } }), env });
  ok('register-options rejects an existing email (409)', dup.status === 409);
}

console.log('\nVerify endpoints — challenge consumption ordering:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db };
  // register-verify: bad/missing bodies
  ok(
    'register-verify without a response → 400',
    (await registerVerify({ request: req('/api/account/register-verify'), env })).status === 400
  );
  const unknown = await registerVerify({
    request: req('/api/account/register-verify', {
      body: { response: { id: 'x', response: { clientDataJSON: clientDataFor('never-issued') } } },
    }),
    env,
  });
  ok('register-verify with an unissued challenge → 400', unknown.status === 400);
  // a real pending challenge is consumed even when attestation verification then fails...
  await putChallenge(db, { type: 'register', challenge: 'reg-chal', email: 'new@user.co' });
  const fakeAttestation = {
    id: 'cred-x',
    rawId: 'cred-x',
    type: 'public-key',
    response: { clientDataJSON: clientDataFor('reg-chal'), attestationObject: 'AAAA' },
  };
  const attempt1 = await registerVerify({ request: req('/api/account/register-verify', { body: { response: fakeAttestation } }), env });
  ok(
    'forged attestation rejected (400), user NOT created',
    attempt1.status === 400 && db.tables.users.length === 0 && db.tables.sessions.length === 0
  );
  const attempt2 = await registerVerify({ request: req('/api/account/register-verify', { body: { response: fakeAttestation } }), env });
  const a2 = await attempt2.json();
  ok('...and the challenge was consumed single-use', attempt2.status === 400 && /already used|expired/i.test(a2.error));
  // login-verify: unknown credential id → 401 (after consuming its challenge)
  await putChallenge(db, { type: 'login', challenge: 'log-chal' });
  const lv = await loginVerify({
    request: req('/api/account/login-verify', {
      body: { response: { id: 'no-such-cred', response: { clientDataJSON: clientDataFor('log-chal') } } },
    }),
    env,
  });
  ok('login-verify with an unknown passkey → 401', lv.status === 401);
  ok('login challenge consumed single-use too', !db.tables.challenges.some(c => c.challenge === 'log-chal'));
}

console.log('\n/api/me shapes + logout:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db };
  const anon = await meGet({ request: req('/api/me', { method: 'GET' }), env });
  const anonJson = await anon.json();
  ok(
    'anonymous /api/me keeps the legacy contract exactly',
    anon.status === 200 && JSON.stringify(anonJson) === JSON.stringify({ tier: 'local', cloudSync: false })
  );
  // seed a user + passkey + session, then read /api/me authed
  const user = await createUser(db, 'me@example.com');
  await insertCredential(db, {
    id: 'cred-1',
    userId: user.id,
    publicKey: 'pk',
    counter: 3,
    transports: ['internal'],
    aaguid: 'aa',
    backedUp: true,
  });
  const { token } = await createSession(db, user.id);
  const me = await meGet({ request: req('/api/me', { method: 'GET', cookie: cookieFor(token) }), env });
  const meJson = await me.json();
  ok('authed /api/me keeps tier/cloudSync', meJson.tier === 'local' && meJson.cloudSync === false);
  ok(
    'authed /api/me adds the user shape',
    meJson.user?.email === 'me@example.com' &&
      meJson.user.donated === false &&
      meJson.user.donationTotalCents === 0 &&
      typeof meJson.user.createdAt === 'number'
  );
  ok(
    'authed /api/me lists passkeys (public shape only)',
    meJson.passkeys?.length === 1 &&
      meJson.passkeys[0].id === 'cred-1' &&
      meJson.passkeys[0].backedUp === true &&
      !('public_key' in meJson.passkeys[0])
  );
  ok('authed /api/me re-issues the sliding cookie', (me.headers.get('Set-Cookie') || '').startsWith(`${SESSION_COOKIE}=${token}`));
  // expired session → anonymous shape again
  const { token: stale } = await createSession(db, user.id, Date.now() - 31 * DAY);
  const staleMe = await meGet({ request: req('/api/me', { method: 'GET', cookie: cookieFor(stale) }), env });
  ok('expired session → anonymous shape', !('user' in (await staleMe.json())));
  // logout revokes the session row and clears the cookie
  const out = await logout({ request: req('/api/account/logout', { cookie: cookieFor(token) }), env });
  ok('logout 200 + cookie cleared', out.status === 200 && (out.headers.get('Set-Cookie') || '').includes('Max-Age=0'));
  ok('logout deleted the session row', !db.tables.sessions.some(s => s.id === token.split('.')[0]));
  const after = await meGet({ request: req('/api/me', { method: 'GET', cookie: cookieFor(token) }), env });
  ok('/api/me anonymous after logout', !('user' in (await after.json())));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
