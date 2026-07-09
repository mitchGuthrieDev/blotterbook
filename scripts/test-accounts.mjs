/* Tests for the accounts layer (F53) — functions/_lib/accounts.ts + the passkey ceremony
   endpoints. Run: node scripts/test-accounts.mjs
   Style mirrors scripts/test-auth.mjs: Node built-ins only, endpoints exercised with mocked
   env — here an in-memory D1 stub that interprets exactly the SQL the helpers issue.
   The WebAuthn attestation/assertion crypto itself is @simplewebauthn/server's (tested
   upstream); these tests cover OUR logic: session token hash/verify, challenge single-use +
   TTL (S25), Origin checks, fail-closed ACCOUNTS_DB behavior, and the /api/me shapes. */
import { createHmac } from 'node:crypto';
import {
  SESSION_COOKIE,
  SESSION_ABSOLUTE_MAX_MS,
  createSession,
  sessionFromRequest,
  destroySession,
  deleteSessionsForUser,
  deleteCredentialForUser,
  credentialsForUser,
  sessionSetCookie,
  sessionClearCookie,
  putChallenge,
  consumeChallenge,
  checkOrigin,
  sha256b64u,
  createUser,
  insertCredential,
  credentialById,
  purgeUnverifiedUsers,
  maybeFreeExpiredUnverified,
  ownsSyncWorkspaces,
  UNVERIFIED_USER_TTL_MS,
  createRecoveryToken,
  consumeRecoveryToken,
  donationById,
  userByEmail,
  setEmailVerified,
  markWebhookEvent,
  webhookEventSeen,
  WEBHOOK_EVENT_TTL_MS,
  hasCloudEntitlement,
  grantEntitlementOverride,
  revokeEntitlementOverride,
  upsertSubscription,
} from '../functions/_lib/accounts.ts';
import { ARCHIVED } from '../functions/_lib/archive.ts';
import { onRequestGet as meGet, SUBSCRIPTION_GRACE_MS } from '../functions/api/me.ts';
import { onRequestGet as adminUsers } from '../functions/api/admin/users.ts';
import { onRequestPost as adminEntitlement } from '../functions/api/admin/entitlement.ts';
import { onRequestPost as registerOptions } from '../functions/api/account/register-options.ts';
import { onRequestPost as registerVerify } from '../functions/api/account/register-verify.ts';
import { onRequestPost as loginOptions } from '../functions/api/account/login-options.ts';
import { onRequestPost as loginVerify } from '../functions/api/account/login-verify.ts';
import { onRequestPost as logout } from '../functions/api/account/logout.ts';
import { onRequestPost as webhook } from '../functions/api/webhook.ts';
import { onRequestPost as checkout } from '../functions/api/checkout.ts';
import { onRequestPost as emailVerifySend } from '../functions/api/account/email-verify-send.ts';
import {
  onRequestGet as emailVerifyConfirmGet,
  onRequestPost as emailVerifyConfirm,
} from '../functions/api/account/email-verify-confirm.ts';
import { onRequestPost as recoverSend } from '../functions/api/account/recover-send.ts';
import { onRequestPost as recoverVerify } from '../functions/api/account/recover-verify.ts';
import { onRequestPost as reclaimSend } from '../functions/api/account/reclaim-send.ts';
import { onRequestPost as reclaimConfirm } from '../functions/api/account/reclaim-confirm.ts';
import { onRequestPost as passkeyDelete } from '../functions/api/account/passkey-delete.ts';

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
  const tables = {
    users: [],
    credentials: [],
    sessions: [],
    challenges: [],
    donations: [],
    recovery_tokens: [],
    subscriptions: [], // F60 — keyed by user_id (no `id` column)
    entitlement_overrides: [], // A276 — manual cloud-tier overrides, keyed by user_id
    webhook_events: [], // F60 — subscription-event dedupe ledger
    sync_workspaces: [], // F62 — read by ownsSyncWorkspaces + swept by deleteUserAccount (A316)
    sync_workspace_keys: [], // F62 — swept by deleteUserAccount
    sync_wrapped_ik: [], // F62 — swept by deleteUserAccount
  };
  const where = (rows, clause, args, offset = 0) => {
    const conds = clause.split(/ AND /i).map(c => c.trim().match(/^(\w+) = \?$/)[1]);
    return rows.filter(r => conds.every((col, i) => r[col] === args[offset + i]));
  };
  // Convert a SQL LIKE pattern (with `\` escape) to a case-insensitive RegExp — used by the A276
  // /api/admin/users `q=` email filter matcher below.
  const likeToRegex = pattern => {
    let re = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '\\') re += (pattern[++i] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      else if (c === '%') re += '.*';
      else if (c === '_') re += '.';
      else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$', 'i');
  };
  // A write result carrying the affected-row count (as an empty rows array with a `.changes` tag), so
  // run() can surface D1's meta.changes while first()/all() still see an empty result set.
  const changed = n => Object.assign([], { changes: n });
  const exec = (sql, args) => {
    const s = sql.trim().replace(/\s+/g, ' ');
    let m;
    if ((m = s.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i))) {
      const cols = m[2].split(',').map(c => c.trim());
      const row = Object.fromEntries(cols.map((c, i) => [c, args[i] ?? null]));
      const t = tables[m[1]];
      // `ON CONFLICT(<col>) DO NOTHING` — first-writer-wins: skip silently when a row with that key
      // already exists (A304 wrapped-DEK register; A310 race-safe createUser/insertCredential). Report
      // 0 rows changed so the caller can detect the loser (mirrors D1's meta.changes).
      const conflict = s.match(/ON CONFLICT\((\w+)\) DO NOTHING/i);
      if (conflict && t.some(r => r[conflict[1]] === row[conflict[1]])) return changed(0);
      // `ON CONFLICT(<col>) DO UPDATE SET <col = ?, …>` — A276 grantEntitlementOverride upsert. When a
      // row with the conflict key exists, apply the SET assignments; the SET `?`s bind AFTER the VALUES
      // args (so args index continues at cols.length). Otherwise fall through to a plain INSERT.
      const upsert = s.match(/ON CONFLICT\((\w+)\) DO UPDATE SET (.+)$/i);
      if (upsert) {
        const keyCol = upsert[1];
        const existing = t.find(r => r[keyCol] === row[keyCol]);
        if (existing) {
          const setCols = upsert[2].split(',').map(p => p.trim().match(/^(\w+) = \?$/)[1]);
          setCols.forEach((c, i) => (existing[c] = args[cols.length + i] ?? null));
          return changed(1);
        }
      }
      // Only enforce the `id` PK when the table actually has one (subscriptions is keyed by user_id).
      if (row.id !== undefined && t.some(r => r.id === row.id)) throw new Error(`UNIQUE constraint failed: ${m[1]}.id`);
      if (m[1] === 'users' && t.some(r => r.email === row.email)) throw new Error('UNIQUE constraint failed: users.email');
      t.push(row);
      return changed(1);
    }
    if ((m = s.match(/^SELECT \* FROM (\w+) WHERE email_verified = 0 AND created_at < \? LIMIT \?$/i))) {
      // A316 purge candidate scan (purgeUnverifiedUsers) — bounded.
      return tables[m[1]].filter(r => r.email_verified === 0 && r.created_at < args[0]).slice(0, args[1]);
    }
    // A276 paginated admin user list (GET /api/admin/users). Keyset on created_at DESC with an optional
    // email LIKE filter. Bind order: (cursor|null, limit[, '%term%']).
    if (
      (m = s.match(
        /^SELECT \* FROM users WHERE \(\?1 IS NULL OR created_at < \?1\)(?: AND email LIKE \?3 ESCAPE '\\')? ORDER BY created_at DESC LIMIT \?2$/i
      ))
    ) {
      const cursor = args[0];
      const limit = args[1];
      const pattern = args[2];
      let rows = tables.users.slice();
      if (cursor != null) rows = rows.filter(r => r.created_at < cursor);
      if (pattern != null) {
        const re = likeToRegex(pattern);
        rows = rows.filter(r => re.test(r.email));
      }
      rows.sort((a, b) => b.created_at - a.created_at);
      return rows.slice(0, limit);
    }
    if ((m = s.match(/^SELECT \* FROM (\w+) WHERE (.+?)(?: ORDER BY .+)?$/i))) return where(tables[m[1]], m[2], args);
    // Generalized to any single-column key (`WHERE <col> = ?`) — `id` still matches (F60 upserts by user_id).
    if ((m = s.match(/^UPDATE (\w+) SET (.+) WHERE (\w+) = \?$/i))) {
      const cols = m[2].split(',').map(p => p.trim().match(/^(\w+) = \?$/)[1]);
      const keyCol = m[3];
      const row = tables[m[1]].find(r => r[keyCol] === args[cols.length]);
      if (row) cols.forEach((c, i) => (row[c] = args[i]));
      return [];
    }
    if ((m = s.match(/^DELETE FROM (\w+) WHERE id = \? AND user_id = \?$/i))) {
      // A302 scoped credential delete (deleteCredentialForUser) — reports the affected count.
      const before = tables[m[1]].length;
      tables[m[1]] = tables[m[1]].filter(r => !(r.id === args[0] && r.user_id === args[1]));
      return changed(before - tables[m[1]].length);
    }
    if ((m = s.match(/^DELETE FROM (\w+) WHERE (\w+) < \?$/i))) {
      // TTL sweeps: challenges/recovery by expires_at, webhook_events by created_at (A265).
      tables[m[1]] = tables[m[1]].filter(r => !(r[m[2]] < args[0]));
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

// In-memory KV stub for the defense-in-depth rate limiter (functions/_lib/http.ts rateLimited).
// get/put over a Map; expirationTtl is ignored (tests never advance the clock past a window).
function mockKv() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
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

// Sign a Stripe webhook body exactly as verifyStripeSignature expects: HMAC-SHA256 hex over `t.body`.
const WH_SECRET = 'whsec_test';
const signedWebhook = (rawBody, { secret = WH_SECRET, t = Math.floor(Date.now() / 1000) } = {}) => {
  const mac = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return new Request(ORIGIN + '/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${mac}` },
    body: rawBody,
  });
};
const checkoutEvent = (id, { email, ref, amount = 2500, currency = 'usd', customer = 'cus_1', mode } = {}) =>
  JSON.stringify({
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        ...(mode ? { mode } : {}),
        amount_total: amount,
        currency,
        customer,
        customer_details: email ? { email } : null,
        client_reference_id: ref ?? null,
      },
    },
  });
// F60 subscription-lifecycle event (customer.subscription.* / invoice.payment_failed).
// `created` (Stripe UNIX SECONDS) drives the A303 out-of-order guard; omitted → not sent.
const subEvent = (id, type, obj, created) =>
  signedWebhook(JSON.stringify({ id, type, ...(created != null ? { created } : {}), data: { object: obj } }));
const secs = ms => Math.floor(ms / 1000); // Stripe current_period_end is UNIX SECONDS

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
  // register-options (new-account path): email validation + duplicate rejection + stored challenge.
  // ARCHIVE FREEZE (docs/archive-freeze.md): this anonymous+email path is frozen; the tests below
  // stay intact for a future revert but are skipped while ARCHIVED, replaced by a 410 assertion.
  if (!ARCHIVED) {
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
  } else {
    const frozen = await registerOptions({ request: req('/api/account/register-options', { body: { email: 'anyone@example.com' } }), env });
    const frozenJson = await frozen.json();
    ok('register-options (new-account path) frozen: 410 archived', frozen.status === 410 && frozenJson.code === 'archived');
    console.log('  (skipped — archive freeze: register-options new-account validation tests)');
  }
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
    userVerified: true,
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

console.log('\nWebhook (F54) — signature gate + provisioning:');
{
  // Signature verification GATES everything — a forged/bad-sig event provisions nothing.
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, STRIPE_WEBHOOK_SECRET: WH_SECRET };
  const noSecret = await webhook({ request: signedWebhook(checkoutEvent('evt_ns')), env: { ACCOUNTS_DB: db } });
  ok('501 when STRIPE_WEBHOOK_SECRET unset', noSecret.status === 501);
  const badSig = new Request(ORIGIN + '/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=9999999999,v1=deadbeef' },
    body: checkoutEvent('evt_forged', { email: 'x@y.co' }),
  });
  const forged = await webhook({ request: badSig, env });
  ok('forged signature rejected (400)', forged.status === 400);
  ok('...and a forged event provisions NOTHING', db.tables.donations.length === 0 && db.tables.users.length === 0);
  // Fail closed: verified event but ACCOUNTS_DB unbound → 503 (never silently dropped).
  const noDb = await webhook({
    request: signedWebhook(checkoutEvent('evt_nodb', { email: 'x@y.co' })),
    env: { STRIPE_WEBHOOK_SECRET: WH_SECRET },
  });
  ok('503 when ACCOUNTS_DB unbound (verified event not dropped)', noDb.status === 503);
  // Non-checkout events are acked (200) but do nothing.
  const other = await webhook({
    request: signedWebhook(JSON.stringify({ id: 'evt_other', type: 'invoice.paid', data: { object: {} } })),
    env,
  });
  ok('unrelated event type acked 200, no donation', other.status === 200 && db.tables.donations.length === 0);
}

console.log('\nWebhook — client_reference_id crediting + replay dedupe:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, STRIPE_WEBHOOK_SECRET: WH_SECRET };
  const user = await createUser(db, 'ref@example.com');
  const r1 = await webhook({ request: signedWebhook(checkoutEvent('evt_ref1', { ref: user.id, amount: 2500 })), env });
  const j1 = await r1.json();
  ok('client_reference_id credits that user (200, credited)', r1.status === 200 && j1.credited === true);
  let u = await userByEmail(db, 'ref@example.com');
  ok('user marked donated with the amount', u.donated_at != null && u.donation_total_cents === 2500);
  ok(
    'donation row keyed by event id, claimed',
    db.tables.donations.length === 1 && db.tables.donations[0].id === 'evt_ref1' && db.tables.donations[0].claimed_at != null
  );
  // Replay the SAME event id → deduped, credited exactly once.
  const r2 = await webhook({ request: signedWebhook(checkoutEvent('evt_ref1', { ref: user.id, amount: 2500 })), env });
  const j2 = await r2.json();
  ok('replayed event id is deduped (no second credit)', r2.status === 200 && j2.deduped === true);
  u = await userByEmail(db, 'ref@example.com');
  ok('total NOT doubled on replay', u.donation_total_cents === 2500 && db.tables.donations.length === 1);
  // A DIFFERENT event id for the same user accumulates.
  await webhook({ request: signedWebhook(checkoutEvent('evt_ref2', { ref: user.id, amount: 1000 })), env });
  u = await userByEmail(db, 'ref@example.com');
  ok('a distinct event accumulates the total', u.donation_total_cents === 3500 && db.tables.donations.length === 2);
}

console.log('\nWebhook — S26(3) donation credit guard (amountCents > 0 AND currency is usd):');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, STRIPE_WEBHOOK_SECRET: WH_SECRET };
  const user = await createUser(db, 'guard@example.com');

  // Zero-amount event: still RECORDED (dedupe row exists) but does not credit.
  const zr = await webhook({ request: signedWebhook(checkoutEvent('evt_zero', { ref: user.id, amount: 0 })), env });
  const zj = await zr.json();
  ok('zero-amount event acked, not credited', zr.status === 200 && zj.credited === false);
  let u = await userByEmail(db, 'guard@example.com');
  ok('zero-amount event recorded but donated_at stays null', u.donated_at == null && (u.donation_total_cents ?? 0) === 0);
  ok('zero-amount event row IS recorded (dedupe intact)', (await donationById(db, 'evt_zero')) != null);

  // Non-USD event: still RECORDED but does not accumulate.
  const nr = await webhook({ request: signedWebhook(checkoutEvent('evt_eur', { ref: user.id, amount: 900, currency: 'EUR' })), env });
  const nj = await nr.json();
  ok('non-USD event acked, not credited', nr.status === 200 && nj.credited === false);
  u = await userByEmail(db, 'guard@example.com');
  ok('non-USD event recorded but does not accumulate the total', u.donated_at == null && (u.donation_total_cents ?? 0) === 0);
  ok('non-USD event row IS recorded (dedupe intact)', (await donationById(db, 'evt_eur')) != null);

  // USD + positive amount: the normal credit path is unchanged (currency check is case-insensitive).
  const ur = await webhook({ request: signedWebhook(checkoutEvent('evt_usd_ok', { ref: user.id, amount: 1200, currency: 'USD' })), env });
  const uj = await ur.json();
  ok('USD (any case) + positive amount credits normally', ur.status === 200 && uj.credited === true);
  u = await userByEmail(db, 'guard@example.com');
  ok('USD path stamps donated_at and accumulates', u.donated_at != null && u.donation_total_cents === 1200);

  // Replay of a non-credited (zero-amount) event stays deduped — and still doesn't retroactively credit.
  const zr2 = await webhook({ request: signedWebhook(checkoutEvent('evt_zero', { ref: user.id, amount: 0 })), env });
  const zj2 = await zr2.json();
  ok('replay of a non-credited event is deduped', zr2.status === 200 && zj2.deduped === true);
  u = await userByEmail(db, 'guard@example.com');
  ok('replay does not retroactively credit', u.donation_total_cents === 1200 && db.tables.donations.length === 3);
}

console.log('\nWebhook — verified-email credit vs. unclaimed → claim-on-verify:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, STRIPE_WEBHOOK_SECRET: WH_SECRET };
  // (a) email matches a VERIFIED user (no client_reference_id) → credited directly.
  const verified = await createUser(db, 'ok@example.com');
  await setEmailVerified(db, verified.id);
  await webhook({ request: signedWebhook(checkoutEvent('evt_ve', { email: 'OK@Example.com', amount: 500 })), env });
  const vu = await userByEmail(db, 'ok@example.com');
  ok('verified matching email is credited', vu.donated_at != null && vu.donation_total_cents === 500);

  // (b) email matches an UNVERIFIED user → NOT credited; donation sits unclaimed.
  const pending = await createUser(db, 'wait@example.com'); // email_verified = 0
  const rc = await webhook({ request: signedWebhook(checkoutEvent('evt_un', { email: 'wait@example.com', amount: 1500 })), env });
  ok('unverified email is NOT auto-credited (never trust checkout email)', (await rc.json()).credited === false);
  let pu = await userByEmail(db, 'wait@example.com');
  ok('...user stays non-donor', pu.donated_at == null && (pu.donation_total_cents ?? 0) === 0);
  const row = await donationById(db, 'evt_un');
  ok('...donation stored UNCLAIMED, keyed by email', row.user_id == null && row.email === 'wait@example.com' && row.claimed_at == null);

  // (c) the user verifies their email → the unclaimed donation is claimed.
  const token = await createRecoveryToken(db, { userId: pending.id, email: pending.email, purpose: 'verify' });
  const conf = await emailVerifyConfirm({ request: req('/api/account/email-verify-confirm', { body: { token } }), env });
  ok('email-verify-confirm 200', conf.status === 200);
  pu = await userByEmail(db, 'wait@example.com');
  ok('email now verified', pu.email_verified === 1);
  ok('unclaimed donation is claimed on verify', pu.donated_at != null && pu.donation_total_cents === 1500);
  const claimed = await donationById(db, 'evt_un');
  ok('donation row now bound to the user', claimed.user_id === pending.id && claimed.claimed_at != null);
}

console.log('\nSubscription lifecycle (F60) — cloud entitlement grants + period-end/grace lapse:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, STRIPE_WEBHOOK_SECRET: WH_SECRET };
  const user = await createUser(db, 'sub@example.com');
  const { token } = await createSession(db, user.id);
  const me = async () => (await meGet({ request: req('/api/me', { method: 'GET', cookie: cookieFor(token) }), env })).json();

  // ── created (active), linked via subscription metadata.client_reference_id ──
  const created = await webhook({
    request: subEvent('evt_sub_created', 'customer.subscription.created', {
      id: 'sub_1',
      customer: 'cus_sub',
      status: 'active',
      current_period_end: secs(Date.now() + 30 * DAY),
      metadata: { client_reference_id: user.id },
    }),
    env,
  });
  ok('subscription.created acked 200', created.status === 200);
  ok(
    'subscription row upserted + linked to the user (status active)',
    db.tables.subscriptions.length === 1 && db.tables.subscriptions[0].user_id === user.id && db.tables.subscriptions[0].status === 'active'
  );
  ok('current_period_end stored in MS (not seconds)', db.tables.subscriptions[0].current_period_end > Date.now());
  ok('user linked to the Stripe customer id', (await userByEmail(db, 'sub@example.com')).stripe_customer_id === 'cus_sub');

  const active = await me();
  ok('active subscription → /api/me grants cloud', active.tier === 'cloud' && active.cloudSync === true);
  ok('...and stays identity+entitlement only (S25 — no trade data)', active.user?.email === 'sub@example.com' && !('trades' in active));

  // ── event-id dedupe on the NEW subscription events ──
  const dup = await webhook({
    request: subEvent('evt_sub_created', 'customer.subscription.created', {
      id: 'sub_1',
      customer: 'cus_sub',
      status: 'active',
      current_period_end: secs(Date.now() + 30 * DAY),
      metadata: { client_reference_id: user.id },
    }),
    env,
  });
  ok('replayed subscription event id is deduped', (await dup.json()).deduped === true && db.tables.subscriptions.length === 1);

  // ── cancel keeps cloud until current_period_end, then drops to local (resolves by sub id) ──
  await webhook({
    request: subEvent('evt_sub_deleted', 'customer.subscription.deleted', {
      id: 'sub_1',
      customer: 'cus_sub',
      status: 'canceled',
      current_period_end: secs(Date.now() + 10 * DAY),
    }),
    env,
  });
  ok('subscription.deleted recorded as canceled', db.tables.subscriptions[0].status === 'canceled');
  ok('cancel keeps cloud while now < current_period_end', (await me()).tier === 'cloud');
  db.tables.subscriptions[0].current_period_end = Date.now() - 1000; // simulate the paid period ending
  const lapsed = await me();
  ok('after the paid period ends, a cancel drops to local', lapsed.tier === 'local' && lapsed.cloudSync === false);

  // ── invoice.payment_failed → past_due; grace keeps cloud, past grace cuts off (resolves by customer) ──
  await webhook({ request: subEvent('evt_sub_pf', 'invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_sub' }), env });
  ok('payment_failed sets past_due', db.tables.subscriptions[0].status === 'past_due');
  const firstFailAt = db.tables.subscriptions[0].past_due_since;
  ok('past_due stamps past_due_since as the grace base (A266)', typeof firstFailAt === 'number');
  ok('past_due within the dunning grace window stays cloud', (await me()).tier === 'cloud');

  // A266 clamp: a Stripe RETRY (another invoice.payment_failed) must NOT reset the grace clock — it
  // preserves past_due_since (only `updated` advances), so the window stays anchored to the FIRST
  // failure instead of stretching across the whole ~3-week retry span.
  await webhook({ request: subEvent('evt_sub_pf2', 'invoice.payment_failed', { subscription: 'sub_1', customer: 'cus_sub' }), env });
  ok(
    'a payment_failed retry preserves past_due_since (only updated advances)',
    db.tables.subscriptions[0].past_due_since === firstFailAt && db.tables.subscriptions[0].updated >= firstFailAt
  );

  db.tables.subscriptions[0].past_due_since = Date.now() - (SUBSCRIPTION_GRACE_MS + 1000); // grace elapsed from the first failure
  const cutoff = await me();
  ok('past_due beyond grace (measured from the first failure) drops to local', cutoff.tier === 'local' && cutoff.cloudSync === false);
}

console.log('\nSubscription linkage robustness (checkout metadata + items[].current_period_end):');
{
  // (a) The customer.subscription.* events don't carry client_reference_id, so /api/checkout must
  //     stamp it into subscription_data.metadata for a subscription — else the webhook can't resolve
  //     the account order-independently (and $0/trial signups never link via the donation path).
  // ARCHIVE FREEZE (docs/archive-freeze.md): /api/checkout is frozen unconditionally (donations +
  // hosted-Checkout subscriptions both start NEW money flows) — kept intact for a future revert.
  const db = mockDb();
  const user = await createUser(db, 'link@example.com');
  const { token } = await createSession(db, user.id);
  if (!ARCHIVED) {
    const captured = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      captured.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.test/s' }), { status: 200 });
    };
    try {
      const env = {
        ACCOUNTS_DB: db,
        STRIPE_SECRET_KEY: 'sk_test',
        STRIPE_PRICE_SUBSCRIPTION: 'price_sub',
        STRIPE_PRICE_ONE_TIME: 'price_ot',
      };
      const res = await checkout({ request: req('/api/checkout', { cookie: cookieFor(token), body: { plan: 'subscription' } }), env });
      ok('subscription checkout returns a url (200)', res.status === 200 && (await res.json()).url?.startsWith('https://'));
      const subBody = decodeURIComponent(captured.at(-1)?.body ?? '');
      ok(
        'checkout stamps subscription_data[metadata][client_reference_id] = user id',
        subBody.includes('subscription_data[metadata][client_reference_id]=' + user.id)
      );
      ok('subscription checkout uses mode=subscription', subBody.includes('mode=subscription'));
      // a one_time checkout must NOT stamp subscription metadata
      captured.length = 0;
      await checkout({ request: req('/api/checkout', { cookie: cookieFor(token), body: { plan: 'one_time' } }), env });
      ok(
        'one_time checkout does NOT set subscription metadata',
        !decodeURIComponent(captured.at(-1)?.body ?? '').includes('subscription_data[metadata]')
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  } else {
    const env = {
      ACCOUNTS_DB: db,
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_PRICE_SUBSCRIPTION: 'price_sub',
      STRIPE_PRICE_ONE_TIME: 'price_ot',
    };
    const frozen = await checkout({ request: req('/api/checkout', { cookie: cookieFor(token), body: { plan: 'subscription' } }), env });
    const frozenJson = await frozen.json();
    ok('checkout frozen: 410 archived', frozen.status === 410 && frozenJson.code === 'archived');
    console.log('  (skipped — archive freeze: checkout metadata-linkage tests)');
  }

  // (b) Stripe API versions ~2025+ moved current_period_end onto the subscription ITEMS. The webhook
  //     must fall back to items.data[0].current_period_end when the top-level field is absent.
  const db2 = mockDb();
  const u2 = await createUser(db2, 'period@example.com');
  const env2 = { ACCOUNTS_DB: db2, STRIPE_WEBHOOK_SECRET: WH_SECRET };
  const periodEnd = Date.now() + 20 * DAY;
  await webhook({
    request: subEvent('evt_items_pe', 'customer.subscription.created', {
      id: 'sub_pe',
      customer: 'cus_pe',
      status: 'active',
      // NO top-level current_period_end — only on the item (the newer API shape)
      items: { data: [{ current_period_end: secs(periodEnd) }] },
      metadata: { client_reference_id: u2.id },
    }),
    env: env2,
  });
  ok(
    'current_period_end read from items[].current_period_end when top-level is absent',
    db2.tables.subscriptions.length === 1 &&
      db2.tables.subscriptions[0].current_period_end > Date.now() &&
      Math.abs(db2.tables.subscriptions[0].current_period_end - periodEnd) < 2000
  );
}

console.log('\nSubscription-lifecycle hardening (A303) — grace over-grant, out-of-order, sub-as-donation:');
{
  // (a) grantsCloud: a past_due account PAST the grace must NOT keep cloud via the current_period_end
  //     fallback, even though Stripe advances current_period_end into the new UNPAID period.
  const db = mockDb();
  const env = { ACCOUNTS_DB: db, STRIPE_WEBHOOK_SECRET: WH_SECRET };
  const user = await createUser(db, 'grace@example.com');
  const { token } = await createSession(db, user.id);
  const me = async () => (await meGet({ request: req('/api/me', { method: 'GET', cookie: cookieFor(token) }), env })).json();
  await webhook({
    request: subEvent('evt_g_created', 'customer.subscription.created', {
      id: 'sub_g',
      customer: 'cus_g',
      status: 'active',
      current_period_end: secs(Date.now() + 30 * DAY),
      metadata: { client_reference_id: user.id },
    }),
    env,
  });
  await webhook({ request: subEvent('evt_g_pf', 'invoice.payment_failed', { subscription: 'sub_g', customer: 'cus_g' }), env });
  // Stripe advanced current_period_end into the NEXT (unpaid) period on the failed renewal.
  db.tables.subscriptions[0].current_period_end = Date.now() + 25 * DAY;
  db.tables.subscriptions[0].past_due_since = Date.now() - (SUBSCRIPTION_GRACE_MS + 1000); // grace elapsed
  const past = await me();
  ok(
    'past_due past grace with a FUTURE current_period_end drops to local (grace no longer dead)',
    past.tier === 'local' && past.cloudSync === false
  );
  // canceled with a still-future period keeps cloud (the ONE legitimate fallback path).
  db.tables.subscriptions[0].status = 'canceled';
  db.tables.subscriptions[0].current_period_end = Date.now() + 5 * DAY;
  ok('a clean cancel still rides out the already-paid period (cloud)', (await me()).tier === 'cloud');

  // (b) out-of-order guard: a delayed subscription.updated(active) with an OLDER event.created arriving
  //     AFTER subscription.deleted must NOT resurrect the canceled sub.
  const db2 = mockDb();
  const env2 = { ACCOUNTS_DB: db2, STRIPE_WEBHOOK_SECRET: WH_SECRET };
  const u2 = await createUser(db2, 'order@example.com');
  const t0 = 1_700_000_000; // base event.created (seconds)
  await webhook({
    request: subEvent(
      'evt_o_created',
      'customer.subscription.created',
      {
        id: 'sub_o',
        customer: 'cus_o',
        status: 'active',
        current_period_end: secs(Date.now() + 30 * DAY),
        metadata: { client_reference_id: u2.id },
      },
      t0
    ),
    env: env2,
  });
  await webhook({
    request: subEvent('evt_o_deleted', 'customer.subscription.deleted', { id: 'sub_o', customer: 'cus_o', status: 'canceled' }, t0 + 100),
    env: env2,
  });
  ok('subscription.deleted applied (canceled)', db2.tables.subscriptions[0].status === 'canceled');
  // A STALE updated(active) that Stripe generated BEFORE the delete but delivered after it.
  const stale = await webhook({
    request: subEvent('evt_o_stale', 'customer.subscription.updated', { id: 'sub_o', customer: 'cus_o', status: 'active' }, t0 + 50),
    env: env2,
  });
  ok('an out-of-order (older) updated is dropped as stale', (await stale.json()).stale === true);
  ok('...and the subscription stays canceled (no resurrection)', db2.tables.subscriptions[0].status === 'canceled');
  // A genuinely NEWER event still applies.
  await webhook({
    request: subEvent(
      'evt_o_new',
      'customer.subscription.updated',
      { id: 'sub_o', customer: 'cus_o', status: 'active', current_period_end: secs(Date.now() + 30 * DAY) },
      t0 + 200
    ),
    env: env2,
  });
  ok('a newer updated still applies (status active)', db2.tables.subscriptions[0].status === 'active');

  // (c) a subscription-mode checkout.session.completed must NOT be credited as a donation.
  const db3 = mockDb();
  const env3 = { ACCOUNTS_DB: db3, STRIPE_WEBHOOK_SECRET: WH_SECRET };
  const u3 = await createUser(db3, 'buyer@example.com');
  await setEmailVerified(db3, u3.id);
  const r = await webhook({
    request: signedWebhook(checkoutEvent('evt_submode', { email: 'buyer@example.com', amount: 500, mode: 'subscription' })),
    env: env3,
  });
  ok('subscription-mode checkout is ignored (not a donation)', (await r.json()).ignored === 'subscription_checkout');
  ok('...no donation row written', db3.tables.donations.length === 0);
  const buyer = await userByEmail(db3, 'buyer@example.com');
  ok('...and the buyer is NOT stamped as a donor', buyer.donated_at == null && (buyer.donation_total_cents ?? 0) === 0);
  // a PAYMENT-mode checkout still credits normally (regression guard).
  await webhook({
    request: signedWebhook(checkoutEvent('evt_paymode', { email: 'buyer@example.com', amount: 1500, mode: 'payment' })),
    env: env3,
  });
  const donor = await userByEmail(db3, 'buyer@example.com');
  ok('a payment-mode checkout still credits a donation', donor.donated_at != null && donor.donation_total_cents === 1500);
}

console.log('\nRecovery/verify token lifecycle (single-use, TTL, hash-only — S25):');
{
  const db = mockDb();
  const u = await createUser(db, 'tok@example.com');
  const token = await createRecoveryToken(db, { userId: u.id, email: u.email, purpose: 'verify' });
  const secret = token.split('.')[1];
  const stored = db.tables.recovery_tokens[0];
  ok('token is id.secret shaped', token.split('.').length === 2);
  ok('raw secret never stored (hash only)', stored.token_hash !== secret && stored.token_hash === (await sha256b64u(secret)));
  // wrong secret must NOT burn the token
  const wrong = await consumeRecoveryToken(db, token.split('.')[0] + '.' + 'z'.repeat(43), 'verify');
  ok('wrong secret rejected without burning', wrong === null && db.tables.recovery_tokens[0].used_at == null);
  // wrong purpose rejected
  ok('wrong purpose rejected', (await consumeRecoveryToken(db, token, 'recover')) === null);
  // correct consume works once, then single-use
  const first = await consumeRecoveryToken(db, token, 'verify');
  ok('valid token consumes once', first?.user_id === u.id);
  ok('token now marked used', db.tables.recovery_tokens[0].used_at != null);
  ok('second consume returns null (single-use)', (await consumeRecoveryToken(db, token, 'verify')) === null);
  // expired token rejected (and burned)
  const expTok = await createRecoveryToken(db, { userId: u.id, email: u.email, purpose: 'recover' }, Date.now() - 20 * 60 * 1000);
  ok('expired token rejected', (await consumeRecoveryToken(db, expTok, 'recover')) === null);
}

console.log('\nEmail send endpoints (fetch stubbed) — fail-closed + enumeration-safe:');
{
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const db = mockDb();
    // ---- email-verify-send ----
    // 503 fail-closed shapes
    const noDb = await emailVerifySend({ request: req('/api/account/email-verify-send'), env: {} });
    ok('email-verify-send 503 when ACCOUNTS_DB unbound', noDb.status === 503 && /ACCOUNTS_DB/.test((await noDb.json()).error));
    const user = await createUser(db, 'send@example.com');
    const { token: sess } = await createSession(db, user.id);
    const noKey = await emailVerifySend({
      request: req('/api/account/email-verify-send', { cookie: cookieFor(sess) }),
      env: { ACCOUNTS_DB: db },
    });
    ok(
      "email-verify-send 503 { error:'email unavailable' } when RESEND_API_KEY unbound",
      noKey.status === 503 && (await noKey.json()).error === 'email unavailable'
    );
    const noAuth = await emailVerifySend({
      request: req('/api/account/email-verify-send'),
      env: { ACCOUNTS_DB: db, RESEND_API_KEY: 're_x' },
    });
    ok('email-verify-send 401 without a session', noAuth.status === 401);
    const okSend = await emailVerifySend({
      request: req('/api/account/email-verify-send', { cookie: cookieFor(sess) }),
      env: { ACCOUNTS_DB: db, RESEND_API_KEY: 're_x' },
    });
    ok(
      'email-verify-send 200 + one email dispatched with a verify link',
      okSend.status === 200 && sent.length === 1 && /email-verify-confirm\?token=/.test(sent[0].body.html)
    );
    ok(
      'email-verify-send cross-origin rejected 403',
      (
        await emailVerifySend({
          request: req('/api/account/email-verify-send', { origin: 'https://evil.example', cookie: cookieFor(sess) }),
          env: { ACCOUNTS_DB: db, RESEND_API_KEY: 're_x' },
        })
      ).status === 403
    );

    // ---- recover-send: enumeration-safe, identical body for hit/miss/unverified ----
    sent.length = 0;
    const rdb = mockDb();
    const renv = { ACCOUNTS_DB: rdb, RESEND_API_KEY: 're_x' };
    const known = await createUser(rdb, 'known@example.com');
    await setEmailVerified(rdb, known.id);
    await createUser(rdb, 'unverified@example.com'); // exists but not verified
    const hit = await recoverSend({ request: req('/api/account/recover-send', { body: { email: 'known@example.com' } }), env: renv });
    const miss = await recoverSend({ request: req('/api/account/recover-send', { body: { email: 'nobody@example.com' } }), env: renv });
    const unver = await recoverSend({
      request: req('/api/account/recover-send', { body: { email: 'unverified@example.com' } }),
      env: renv,
    });
    const bodies = await Promise.all([hit, miss, unver].map(r => r.text()));
    ok(
      'recover-send returns an identical generic 200 for hit / miss / unverified',
      hit.status === 200 && bodies[0] === bodies[1] && bodies[1] === bodies[2]
    );
    ok(
      'recover-send emails ONLY the verified account (1 mail sent, to it, with a recover link)',
      sent.length === 1 && /\?recover=/.test(sent[0].body.html)
    );
    const rNoKey = await recoverSend({
      request: req('/api/account/recover-send', { body: { email: 'known@example.com' } }),
      env: { ACCOUNTS_DB: rdb },
    });
    ok(
      "recover-send 503 { error:'email unavailable' } when RESEND unbound",
      rNoKey.status === 503 && (await rNoKey.json()).error === 'email unavailable'
    );
    const rNoDb = await recoverSend({ request: req('/api/account/recover-send', { body: { email: 'known@example.com' } }), env: {} });
    ok('recover-send 503 when ACCOUNTS_DB unbound', rNoDb.status === 503 && /ACCOUNTS_DB/.test((await rNoDb.json()).error));
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('\nRecovery re-enrollment (recover-verify) — issues a session-bound register challenge:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db };
  const user = await createUser(db, 'rec@example.com');
  await setEmailVerified(db, user.id);
  // seed an unclaimed donation so recovery also exercises the claim path
  await webhook({
    request: signedWebhook(checkoutEvent('evt_recdon', { email: 'other@nope.co' })),
    env: { ACCOUNTS_DB: db, STRIPE_WEBHOOK_SECRET: WH_SECRET },
  }); // unrelated, stays unclaimed
  const token = await createRecoveryToken(db, { userId: user.id, email: user.email, purpose: 'recover' });
  const rv = await recoverVerify({ request: req('/api/account/recover-verify', { body: { token } }), env });
  const rvJson = await rv.json();
  ok('recover-verify 200 with fresh registration options', rv.status === 200 && typeof rvJson.options?.challenge === 'string');
  // The register challenge is BOUND to the recovered user → register-verify enrolls the passkey and
  // starts a session (the WebAuthn attestation crypto itself is @simplewebauthn/server's, tested upstream).
  const bound = db.tables.challenges.find(c => c.challenge === rvJson.options.challenge);
  ok('...bound to the recovered user (register-verify will start their session)', bound?.type === 'register' && bound?.user_id === user.id);
  ok('recovery marks the email verified', (await userByEmail(db, 'rec@example.com')).email_verified === 1);
  // token is single-use — a second recover-verify fails
  const again = await recoverVerify({ request: req('/api/account/recover-verify', { body: { token } }), env });
  ok('recover-verify rejects a reused token (400)', again.status === 400);
  // fail-closed + origin
  ok(
    'recover-verify 503 when ACCOUNTS_DB unbound',
    (await recoverVerify({ request: req('/api/account/recover-verify', { body: { token: 'x.y' } }), env: {} })).status === 503
  );
  ok(
    'recover-verify cross-origin rejected 403',
    (await recoverVerify({ request: req('/api/account/recover-verify', { origin: 'https://evil.example', body: { token: 'x.y' } }), env }))
      .status === 403
  );
}

console.log('\nRate limiting on the email-send + recovery endpoints (A301) — 429 past 5/5min:');
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  try {
    // email-verify-send: check runs after the DB check → an authed, unverified user with RESEND bound
    // gets a real 200 up to the limit, then 429. STATUS_KV shared → all 'anon' calls hit one bucket.
    {
      const db = mockDb();
      const user = await createUser(db, 'rl-verify@example.com');
      const { token: sess } = await createSession(db, user.id);
      const env = { ACCOUNTS_DB: db, RESEND_API_KEY: 're_x', STATUS_KV: mockKv() };
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const r = await emailVerifySend({ request: req('/api/account/email-verify-send', { cookie: cookieFor(sess) }), env });
        statuses.push(r.status);
      }
      ok('email-verify-send: first 5 pass (200), the 6th is 429', statuses.slice(0, 5).every(s => s === 200) && statuses[5] === 429);
    }
    // recover-send: enumeration-safe 200 for the first 5, then 429 (limiter runs before the send).
    {
      const db = mockDb();
      const env = { ACCOUNTS_DB: db, RESEND_API_KEY: 're_x', STATUS_KV: mockKv() };
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const r = await recoverSend({ request: req('/api/account/recover-send', { body: { email: 'ghost@example.com' } }), env });
        statuses.push(r.status);
      }
      ok('recover-send: first 5 pass (200), the 6th is 429', statuses.slice(0, 5).every(s => s === 200) && statuses[5] === 429);
    }
    // recover-verify: previously had NO limiter (A301). Bad tokens 400 up to the limit, then 429.
    {
      const db = mockDb();
      const env = { ACCOUNTS_DB: db, STATUS_KV: mockKv() };
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const r = await recoverVerify({ request: req('/api/account/recover-verify', { body: { token: 'x.y' } }), env });
        statuses.push(r.status);
      }
      ok(
        'recover-verify: throttled — first 5 reach 400, the 6th is 429',
        statuses.slice(0, 5).every(s => s === 400) && statuses[5] === 429
      );
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('\nemail-verify-confirm — GET redirect + POST + fail modes:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db };
  const user = await createUser(db, 'conf@example.com');
  const token = await createRecoveryToken(db, { userId: user.id, email: user.email, purpose: 'verify' });
  const getReq = new Request(ORIGIN + '/api/account/email-verify-confirm?token=' + encodeURIComponent(token), { method: 'GET' });
  const gr = await emailVerifyConfirmGet({ request: getReq, env });
  ok('GET confirm redirects (302) back to the app with a flag', gr.status === 302 && /verified=1/.test(gr.headers.get('Location') || ''));
  ok('...and set email_verified', (await userByEmail(db, 'conf@example.com')).email_verified === 1);
  // an invalid/used token: GET → redirect to expired, POST → 400
  const badGet = await emailVerifyConfirmGet({
    request: new Request(ORIGIN + '/api/account/email-verify-confirm?token=bogus.tok', { method: 'GET' }),
    env,
  });
  ok(
    'GET confirm with a bad token redirects to expired',
    badGet.status === 302 && /verify=expired/.test(badGet.headers.get('Location') || '')
  );
  const badPost = await emailVerifyConfirm({ request: req('/api/account/email-verify-confirm', { body: { token: 'bogus.tok' } }), env });
  ok('POST confirm with a bad token → 400', badPost.status === 400);
  ok(
    'email-verify-confirm 503 when ACCOUNTS_DB unbound',
    (await emailVerifyConfirm({ request: req('/api/account/email-verify-confirm', { body: { token } }), env: {} })).status === 503
  );
}

console.log('\nwebhook_events dedupe ledger — sweep-on-write bounds growth (A265):');
{
  const db = mockDb();
  const now = 2_000_000_000_000;
  // A fresh event is recorded and deduped; an event older than the TTL is swept on the next insert.
  await markWebhookEvent(db, 'evt_old', 'customer.subscription.updated', now - WEBHOOK_EVENT_TTL_MS - 1);
  ok('recorded event is seen (dedupe hit)', await webhookEventSeen(db, 'evt_old'));
  await markWebhookEvent(db, 'evt_new', 'customer.subscription.updated', now);
  ok('the new event is retained', await webhookEventSeen(db, 'evt_new'));
  ok('the stale event was swept on the next write (bounded ledger)', !(await webhookEventSeen(db, 'evt_old')));
  ok(
    'an in-window event is NOT swept',
    db.tables.webhook_events.every(r => r.id !== 'evt_old') && db.tables.webhook_events.some(r => r.id === 'evt_new')
  );
}

console.log('\nAuth hardening (A310) — race-safe createUser/insertCredential + user_verified persistence:');
{
  const db = mockDb();
  // createUser is race-safe: first wins (returns the row), a duplicate email returns null (clean 409).
  const first = await createUser(db, 'race@example.com');
  ok('createUser returns the created row on first insert', first != null && first.email === 'race@example.com');
  const second = await createUser(db, 'race@example.com');
  ok('createUser returns null when the email is already taken (race → clean 409)', second === null);
  ok('...and no duplicate user row is written', db.tables.users.filter(u => u.email === 'race@example.com').length === 1);

  // insertCredential is race-safe + persists user_verified.
  const ins1 = await insertCredential(db, {
    id: 'cred-uv',
    userId: first.id,
    publicKey: 'pk',
    counter: 0,
    transports: ['internal'],
    aaguid: null,
    backedUp: true,
    userVerified: true,
  });
  ok('insertCredential returns true when it inserts the credential', ins1 === true);
  ok('...and persists user_verified = 1', (await credentialById(db, 'cred-uv')).user_verified === 1);
  const ins2 = await insertCredential(db, {
    id: 'cred-uv',
    userId: first.id,
    publicKey: 'pk2',
    counter: 0,
    transports: [],
    aaguid: null,
    backedUp: false,
    userVerified: false,
  });
  ok('insertCredential returns false on a duplicate credential id (race → clean 409)', ins2 === false);
  ok('...and does not overwrite the existing credential', (await credentialById(db, 'cred-uv')).public_key === 'pk');
  const insUnverified = await insertCredential(db, {
    id: 'cred-nouv',
    userId: first.id,
    publicKey: 'pk',
    counter: 0,
    transports: [],
    aaguid: null,
    backedUp: false,
    userVerified: false,
  });
  ok(
    'a non-UV enrollment persists user_verified = 0',
    insUnverified === true && (await credentialById(db, 'cred-nouv')).user_verified === 0
  );

  // purgeUnverifiedUsers (A310): frees a squatted email held by a never-verified account past the TTL,
  // while sparing verified accounts and fresh unverified ones.
  const pdb = mockDb();
  const now = Date.now();
  await createUser(pdb, 'victim@example.com', now - UNVERIFIED_USER_TTL_MS - 1000); // old, unverified — the squatter
  await createUser(pdb, 'new@example.com', now - 1000); // recent, unverified — spared
  const legit = await createUser(pdb, 'legit@example.com', now - UNVERIFIED_USER_TTL_MS - 1000); // old but verified — spared
  await setEmailVerified(pdb, legit.id);
  // A316: an aged unverified account that OWNS SYNC WORKSPACES must be skipped — its R2 ciphertext
  // needs the paged account-delete cleanup (A305), which a purge can't perform.
  const wsOwner = await createUser(pdb, 'wsowner@example.com', now - UNVERIFIED_USER_TTL_MS - 1000);
  pdb.tables.sync_workspaces.push({ id: 'ws-1', owner_user_id: wsOwner.id, created_at: now });
  ok('ownsSyncWorkspaces sees the seeded workspace', (await ownsSyncWorkspaces(pdb, wsOwner.id)) === true);
  const removed = await purgeUnverifiedUsers(pdb, now);
  ok('purge removes exactly the aged never-verified squatter', removed === 1);
  ok('...the squatted email is freed', (await userByEmail(pdb, 'victim@example.com')) == null);
  ok('...a fresh unverified account is spared', (await userByEmail(pdb, 'new@example.com')) != null);
  ok('...a verified account is spared regardless of age', (await userByEmail(pdb, 'legit@example.com')) != null);
  ok(
    '...an aged unverified WORKSPACE OWNER is spared (A305 pager owns that cleanup)',
    (await userByEmail(pdb, 'wsowner@example.com')) != null
  );
  // maybeFreeExpiredUnverified applies the same guards one account at a time (the lazy path).
  ok('maybeFree refuses a workspace owner', (await maybeFreeExpiredUnverified(pdb, wsOwner, now)) === false);
  const fresh = await userByEmail(pdb, 'new@example.com');
  ok('maybeFree refuses a pre-TTL account', (await maybeFreeExpiredUnverified(pdb, fresh, now)) === false);
  const legit2 = await userByEmail(pdb, 'legit@example.com');
  ok('maybeFree refuses a verified account', (await maybeFreeExpiredUnverified(pdb, legit2, now)) === false);
}

console.log('\nA316: sign-up squat purge (lazy, at the register collision) + reclaim flow:');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db };
  const now = Date.now();
  const optionsFor = email => registerOptions({ request: req('/api/account/register-options', { body: { email } }), env });

  // Verified holder — plain account-state setup, not an endpoint call, so unaffected by the freeze.
  const legit = await createUser(db, 'held@example.com', now - UNVERIFIED_USER_TTL_MS - 1000);
  await setEmailVerified(db, legit.id);
  // Young unverified holder — created directly (not through the frozen register-options endpoint)
  // because the reclaim-confirm section below needs this account regardless of ARCHIVED.
  await createUser(db, 'young@example.com', now - 1000);

  // ARCHIVE FREEZE (docs/archive-freeze.md): register-options' new-account branch (so its squat-purge
  // + reclaim-affordance logic too) and reclaim-send are both frozen. The tests below are kept intact
  // for a future revert but skipped — replaced with 410 assertions — while ARCHIVED.
  if (!ARCHIVED) {
    // Verified holder → plain 409 (no reclaim affordance).
    const dupVerified = await optionsFor('held@example.com');
    const dupVerifiedJson = await dupVerified.json();
    ok('verified holder → 409 without reclaimable', dupVerified.status === 409 && !('reclaimable' in dupVerifiedJson));

    // Young unverified holder → 409 + reclaimable: true (the client offers the magic-link flow).
    const dupYoung = await optionsFor('young@example.com');
    const dupYoungJson = await dupYoung.json();
    ok('pre-TTL unverified holder → 409 with reclaimable: true', dupYoung.status === 409 && dupYoungJson.reclaimable === true);

    // TTL-expired unverified squatter → freed on the spot; registration proceeds (200 + options).
    const squatter = await createUser(db, 'squatted@example.com', now - UNVERIFIED_USER_TTL_MS - 1000);
    db.tables.sessions.push({
      id: 'sq-s',
      user_id: squatter.id,
      secret_hash: 'h',
      created_at: now,
      expires_at: now + DAY,
      last_seen_at: null,
    });
    const freedRes = await optionsFor('squatted@example.com');
    const freedJson = await freedRes.json();
    ok(
      'TTL-expired squatter → collision register succeeds (200 + options)',
      freedRes.status === 200 && typeof freedJson.options?.challenge === 'string'
    );
    ok('...the squatter account is gone', (await userByEmail(db, 'squatted@example.com')) == null);
    ok('...its child rows are swept (sessions)', !db.tables.sessions.some(s => s.user_id === squatter.id));

    // ---- reclaim-send: enumeration-safe; emails ONLY a never-verified holder ----
    const realFetch = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return new Response('{"id":"em_1"}', { status: 200 });
    };
    try {
      const renv = { ACCOUNTS_DB: db, RESEND_API_KEY: 're_x' };
      const sendFor = email => reclaimSend({ request: req('/api/account/reclaim-send', { body: { email } }), env: renv });
      const hit = await sendFor('young@example.com'); // unverified holder — the ONE that sends
      const missVerified = await sendFor('held@example.com'); // verified holder — silent
      const missFree = await sendFor('nobody@example.com'); // no account — silent
      const bodies = await Promise.all([hit, missVerified, missFree].map(r => r.text()));
      ok(
        'reclaim-send returns an identical generic 200 for unverified / verified / free',
        hit.status === 200 && bodies[0] === bodies[1] && bodies[1] === bodies[2]
      );
      ok(
        'reclaim-send emails ONLY the never-verified holder (1 mail, with a reclaim link)',
        sent.length === 1 && /\?reclaim=/.test(sent[0].body.html)
      );
      const noKey = await reclaimSend({
        request: req('/api/account/reclaim-send', { body: { email: 'young@example.com' } }),
        env: { ACCOUNTS_DB: db },
      });
      ok(
        "reclaim-send 503 { error:'email unavailable' } when RESEND unbound",
        noKey.status === 503 && (await noKey.json()).error === 'email unavailable'
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    ok(
      'reclaim-send cross-origin rejected 403',
      (await reclaimSend({ request: req('/api/account/reclaim-send', { origin: 'https://evil.example', body: { email: 'a@b.co' } }), env }))
        .status === 403
    );
  } else {
    const frozenOpts = await optionsFor('held@example.com');
    const frozenOptsJson = await frozenOpts.json();
    ok('register-options (new-account path) frozen: 410 archived', frozenOpts.status === 410 && frozenOptsJson.code === 'archived');
    const frozenReclaim = await reclaimSend({
      request: req('/api/account/reclaim-send', { body: { email: 'young@example.com' } }),
      env,
    });
    const frozenReclaimJson = await frozenReclaim.json();
    ok('reclaim-send frozen: 410 archived', frozenReclaim.status === 410 && frozenReclaimJson.code === 'archived');
    console.log('  (skipped — archive freeze: squat-purge / reclaim-send enumeration-safety tests)');
  }

  // ---- reclaim-confirm: frees the squatter, pre-creates a VERIFIED account, binds the ceremony ----
  // (reclaim-confirm itself is untouched by the freeze; tokens are minted directly below rather than
  // via reclaim-send, so this section runs unconditionally regardless of ARCHIVED.)
  const young = await userByEmail(db, 'young@example.com');
  // seed an unclaimed donation under the reclaimed email — proof-of-inbox sweeps it in
  db.tables.donations.push({
    id: 'evt_reclaim_don',
    user_id: null,
    email: 'young@example.com',
    amount_cents: 500,
    currency: 'usd',
    stripe_customer_id: null,
    created_at: now,
    claimed_at: null,
  });
  const token = await createRecoveryToken(db, { userId: young.id, email: young.email, purpose: 'reclaim' });
  const rc = await reclaimConfirm({ request: req('/api/account/reclaim-confirm', { body: { token } }), env });
  const rcJson = await rc.json();
  ok('reclaim-confirm 200 with fresh registration options', rc.status === 200 && typeof rcJson.options?.challenge === 'string');
  const fresh = await userByEmail(db, 'young@example.com');
  ok('...the squatter is replaced by a FRESH account', fresh != null && fresh.id !== young.id);
  ok('...the fresh account starts email-verified (the click IS the proof)', fresh.email_verified === 1);
  ok('...the unclaimed donation swept onto the fresh account', (await donationById(db, 'evt_reclaim_don')).user_id === fresh.id);
  const bound = db.tables.challenges.find(c => c.challenge === rcJson.options.challenge);
  ok('...the register challenge is bound to the fresh user', bound?.type === 'register' && bound?.user_id === fresh.id);
  const again = await reclaimConfirm({ request: req('/api/account/reclaim-confirm', { body: { token } }), env });
  ok('reclaim-confirm rejects a reused token (400)', again.status === 400);

  // A holder who verified between send and confirm is protected.
  const race = await createUser(db, 'raced@example.com', now - 1000);
  const raceToken = await createRecoveryToken(db, { userId: race.id, email: race.email, purpose: 'reclaim' });
  await setEmailVerified(db, race.id);
  const raced = await reclaimConfirm({ request: req('/api/account/reclaim-confirm', { body: { token: raceToken } }), env });
  ok(
    'reclaim-confirm 400 when the holder verified meanwhile',
    raced.status === 400 && (await userByEmail(db, 'raced@example.com')).id === race.id
  );

  // A workspace-owning holder is refused (R2 cleanup needs the A305 pager).
  const wsHolder = await createUser(db, 'wsheld@example.com', now - 1000);
  db.tables.sync_workspaces.push({ id: 'ws-2', owner_user_id: wsHolder.id, created_at: now });
  const wsToken = await createRecoveryToken(db, { userId: wsHolder.id, email: wsHolder.email, purpose: 'reclaim' });
  const wsRes = await reclaimConfirm({ request: req('/api/account/reclaim-confirm', { body: { token: wsToken } }), env });
  ok(
    'reclaim-confirm 409 for a workspace-owning holder (account preserved)',
    wsRes.status === 409 && (await userByEmail(db, 'wsheld@example.com')).id === wsHolder.id
  );

  // A recover-purpose token can't drive reclaim (purpose isolation), and cross-origin is rejected.
  const wrongPurpose = await createRecoveryToken(db, { userId: wsHolder.id, email: wsHolder.email, purpose: 'recover' });
  ok(
    'reclaim-confirm rejects a recover-purpose token (400)',
    (await reclaimConfirm({ request: req('/api/account/reclaim-confirm', { body: { token: wrongPurpose } }), env })).status === 400
  );
  ok(
    'reclaim-confirm 503 when ACCOUNTS_DB unbound',
    (await reclaimConfirm({ request: req('/api/account/reclaim-confirm', { body: { token: 'x.y' } }), env: {} })).status === 503
  );
  ok(
    'reclaim-confirm cross-origin rejected 403',
    (
      await reclaimConfirm({
        request: req('/api/account/reclaim-confirm', { origin: 'https://evil.example', body: { token: 'x.y' } }),
        env,
      })
    ).status === 403
  );
  // (reclaim-send cross-origin behavior is asserted above, inside the ARCHIVED branch — the freeze
  // check fires before the origin check, so it's covered there rather than duplicated here.)
}

console.log('\nSession revocation + absolute cap + passkey delete (A302):');
{
  const db = mockDb();
  const user = await createUser(db, 'revoke@example.com');
  const seedCred = (uid, id) =>
    insertCredential(db, {
      id,
      userId: uid,
      publicKey: 'pk',
      counter: 0,
      transports: [],
      aaguid: null,
      backedUp: true,
      userVerified: true,
    });
  const lookup = t => sessionFromRequest(req('/api/me', { method: 'GET', cookie: cookieFor(t) }), db);

  // (1) absolute session cap — a session older than the cap from created_at is invalid even when its
  //     sliding TTL is fresh (as if it had been slid forward on use the whole time).
  const { token } = await createSession(db, user.id);
  ok('a fresh session resolves', (await lookup(token))?.user_id === user.id);
  const row = db.tables.sessions.find(s => s.user_id === user.id);
  row.created_at = Date.now() - SESSION_ABSOLUTE_MAX_MS - 1000;
  row.expires_at = Date.now() + 5 * DAY;
  ok('a session past the 90-day absolute cap is rejected', (await lookup(token)) === null);
  ok('...and the capped session row is reaped', !db.tables.sessions.some(s => s.user_id === user.id));

  // (2) deleteSessionsForUser revokes every session (the recovery-revocation primitive).
  await createSession(db, user.id);
  await createSession(db, user.id);
  ok('two live sessions exist', db.tables.sessions.filter(s => s.user_id === user.id).length === 2);
  await deleteSessionsForUser(db, user.id);
  ok('deleteSessionsForUser revokes them all', db.tables.sessions.filter(s => s.user_id === user.id).length === 0);

  // (3) passkey-delete — session-authed, Origin-checked, fail-closed, scoped + last-credential guard.
  const { token: sess } = await createSession(db, user.id);
  await seedCred(user.id, 'cred-A');
  ok(
    'passkey-delete 503 without ACCOUNTS_DB',
    (await passkeyDelete({ request: req('/api/account/passkey-delete', { cookie: cookieFor(sess), body: { id: 'cred-A' } }), env: {} }))
      .status === 503
  );
  ok(
    'passkey-delete 401 without a session',
    (await passkeyDelete({ request: req('/api/account/passkey-delete', { body: { id: 'cred-A' } }), env: { ACCOUNTS_DB: db } })).status ===
      401
  );
  ok(
    'passkey-delete cross-origin → 403',
    (
      await passkeyDelete({
        request: req('/api/account/passkey-delete', { origin: 'https://evil.example', cookie: cookieFor(sess), body: { id: 'cred-A' } }),
        env: { ACCOUNTS_DB: db },
      })
    ).status === 403
  );
  const lastGuard = await passkeyDelete({
    request: req('/api/account/passkey-delete', { cookie: cookieFor(sess), body: { id: 'cred-A' } }),
    env: { ACCOUNTS_DB: db },
  });
  ok(
    'refuses to delete the LAST passkey (400, still present)',
    lastGuard.status === 400 && (await credentialsForUser(db, user.id)).length === 1
  );
  await seedCred(user.id, 'cred-B');
  const okDel = await passkeyDelete({
    request: req('/api/account/passkey-delete', { cookie: cookieFor(sess), body: { id: 'cred-A' } }),
    env: { ACCOUNTS_DB: db },
  });
  ok('deletes a non-last passkey (200)', okDel.status === 200 && !db.tables.credentials.some(c => c.id === 'cred-A'));
  ok(
    '...leaving the remaining passkey',
    db.tables.credentials.some(c => c.id === 'cred-B')
  );
  const other = await createUser(db, 'other302@example.com');
  await seedCred(other.id, 'cred-OTHER');
  const notMine = await passkeyDelete({
    request: req('/api/account/passkey-delete', { cookie: cookieFor(sess), body: { id: 'cred-OTHER' } }),
    env: { ACCOUNTS_DB: db },
  });
  ok(
    "cannot delete another account's passkey (404, not removed)",
    notMine.status === 404 && db.tables.credentials.some(c => c.id === 'cred-OTHER')
  );
  // deleteCredentialForUser is itself owner-scoped (0 rows for a mismatched user).
  ok('deleteCredentialForUser is owner-scoped (0 for a foreign user)', (await deleteCredentialForUser(db, user.id, 'cred-OTHER')) === 0);

  // (4) a recovery-originated register challenge is flagged so register-verify revokes prior sessions.
  await putChallenge(db, { type: 'register', challenge: 'rec-chal', userId: user.id, email: user.email, recovery: true });
  ok('recovery register challenge persists recovery = 1', db.tables.challenges.find(c => c.challenge === 'rec-chal').recovery === 1);
  await putChallenge(db, { type: 'register', challenge: 'add-chal', userId: user.id, email: user.email });
  ok(
    'a normal add-passkey challenge is not flagged',
    (db.tables.challenges.find(c => c.challenge === 'add-chal').recovery ?? null) === null
  );
}

console.log('\nEntitlement overrides (A276) — hasCloudEntitlement choke point:');
{
  const db = mockDb();
  const now = Date.now();
  const u = await createUser(db, 'ent@example.com');
  ok('no override + no subscription → not cloud', (await hasCloudEntitlement(db, u.id, now)) === false);

  await grantEntitlementOverride(db, { userId: u.id, expiresAt: null, reason: 'comp', grantedBy: 'admin@bb' }, now);
  ok('live permanent override (no sub) → cloud', (await hasCloudEntitlement(db, u.id, now)) === true);
  ok(
    '...override row stored with granted_by + a clean audit state',
    db.tables.entitlement_overrides.length === 1 &&
      db.tables.entitlement_overrides[0].granted_by === 'admin@bb' &&
      db.tables.entitlement_overrides[0].revoked_at == null
  );

  await grantEntitlementOverride(db, { userId: u.id, expiresAt: now - 1000, grantedBy: 'admin@bb' }, now);
  ok('override past its expiry → not cloud', (await hasCloudEntitlement(db, u.id, now)) === false);
  ok('...the upsert refreshed the SAME row (one override per user)', db.tables.entitlement_overrides.length === 1);

  await grantEntitlementOverride(db, { userId: u.id, expiresAt: now + 30 * DAY, grantedBy: 'admin@bb' }, now);
  ok('re-grant with a future expiry → cloud again', (await hasCloudEntitlement(db, u.id, now)) === true);

  await revokeEntitlementOverride(db, u.id, 'admin2@bb', now);
  ok('revoke → not cloud', (await hasCloudEntitlement(db, u.id, now)) === false);
  ok(
    '...the revoked row is KEPT as the audit trail (revoked_by/revoked_at stamped)',
    db.tables.entitlement_overrides.length === 1 &&
      db.tables.entitlement_overrides[0].revoked_by === 'admin2@bb' &&
      db.tables.entitlement_overrides[0].revoked_at != null
  );

  await grantEntitlementOverride(db, { userId: u.id, expiresAt: null, grantedBy: 'admin@bb' }, now);
  ok(
    're-grant reactivates (clears revoked_at) → cloud',
    (await hasCloudEntitlement(db, u.id, now)) === true && db.tables.entitlement_overrides[0].revoked_at == null
  );

  // Override AND an active subscription → cloud via either path.
  const u2 = await createUser(db, 'both@example.com');
  await upsertSubscription(
    db,
    { userId: u2.id, stripeSubscriptionId: 'sub_x', stripeCustomerId: 'cus_x', status: 'active', currentPeriodEnd: now + 30 * DAY },
    now
  );
  ok('active subscription alone → cloud (no override)', (await hasCloudEntitlement(db, u2.id, now)) === true);
  await grantEntitlementOverride(db, { userId: u2.id, expiresAt: null, grantedBy: 'admin@bb' }, now);
  ok('override AND active subscription → cloud', (await hasCloudEntitlement(db, u2.id, now)) === true);
}

console.log('\nA276 — /api/me flips tier via an override (no subscription touched):');
{
  const db = mockDb();
  const env = { ACCOUNTS_DB: db };
  const user = await createUser(db, 'meover@example.com');
  const { token } = await createSession(db, user.id);
  const me = async () => (await meGet({ request: req('/api/me', { method: 'GET', cookie: cookieFor(token) }), env })).json();
  ok('starts local (no sub, no override)', (await me()).tier === 'local');
  await grantEntitlementOverride(db, { userId: user.id, expiresAt: null, reason: 'reviewer comp', grantedBy: 'admin@bb' });
  const flipped = await me();
  ok('a live override flips /api/me to cloud', flipped.tier === 'cloud' && flipped.cloudSync === true);
  ok('...with NO subscription row created (the override is independent)', db.tables.subscriptions.length === 0);
  await revokeEntitlementOverride(db, user.id, 'admin@bb');
  ok('revoking drops /api/me back to local', (await me()).tier === 'local');
}

console.log('\nAdmin API (A276) — /api/admin/users + /api/admin/entitlement:');
{
  const ADMIN_KEY = 'test-admin-key';
  const adminGet = (path, { key = ADMIN_KEY } = {}) =>
    new Request(ORIGIN + path, { method: 'GET', headers: key ? { 'x-admin-key': key } : {} });
  const adminPost = (body, { key = ADMIN_KEY, email = null } = {}) =>
    new Request(ORIGIN + '/api/admin/entitlement', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'x-admin-key': key } : {}),
        ...(email ? { 'Cf-Access-Authenticated-User-Email': email } : {}),
      },
      body: JSON.stringify(body),
    });

  // ---- auth + fail-closed ----
  {
    const db = mockDb();
    const env = { ACCOUNTS_DB: db, ADMIN_KEY };
    const noTok = await adminUsers({ request: adminGet('/api/admin/users', { key: null }), env });
    ok('GET /api/admin/users → 401 without a token', noTok.status === 401);
    const noTokPost = await adminEntitlement({ request: adminPost({ userId: 'x', action: 'grant' }, { key: null }), env });
    ok('POST /api/admin/entitlement → 401 without a token', noTokPost.status === 401);
    const noDb = await adminUsers({ request: adminGet('/api/admin/users'), env: { ADMIN_KEY } });
    ok('GET /api/admin/users → 503 without ACCOUNTS_DB', noDb.status === 503 && /ACCOUNTS_DB/.test((await noDb.json()).error));
    const noDbPost = await adminEntitlement({ request: adminPost({ userId: 'x', action: 'grant' }), env: { ADMIN_KEY } });
    ok('POST /api/admin/entitlement → 503 without ACCOUNTS_DB', noDbPost.status === 503);
  }

  // ---- cursor pagination: page 2 excludes page 1, nextCursor shape, q= filter ----
  {
    const db = mockDb();
    const env = { ACCOUNTS_DB: db, ADMIN_KEY };
    const base = 1_000_000_000_000;
    for (let i = 0; i < 5; i++) await createUser(db, `u${i}@example.com`, base + i * 1000); // distinct created_at
    const p1 = await adminUsers({ request: adminGet('/api/admin/users?limit=2'), env });
    const p1j = await p1.json();
    ok(
      'page 1 returns `limit` users, newest first',
      p1.status === 200 && p1j.users.length === 2 && p1j.users[0].createdAt > p1j.users[1].createdAt
    );
    ok('page 1 hands back a numeric nextCursor', typeof p1j.nextCursor === 'number');
    const p2 = await adminUsers({ request: adminGet('/api/admin/users?limit=2&cursor=' + p1j.nextCursor), env });
    const p2j = await p2.json();
    const p1ids = new Set(p1j.users.map(u => u.id));
    ok('page 2 excludes every page-1 user', p2j.users.length === 2 && p2j.users.every(u => !p1ids.has(u.id)));
    const last = await adminUsers({ request: adminGet('/api/admin/users?limit=2&cursor=' + p2j.nextCursor), env });
    const lastj = await last.json();
    ok('the final (short) page returns nextCursor null', lastj.users.length === 1 && lastj.nextCursor === null);
    const q = await adminUsers({ request: adminGet('/api/admin/users?q=u3'), env });
    const qj = await q.json();
    ok('q= filters by email substring', qj.users.length === 1 && qj.users[0].email === 'u3@example.com');
  }

  // ---- grant→me cloud→revoke→me local round trip + audit stamp + S25 scan ----
  {
    const db = mockDb();
    const env = { ACCOUNTS_DB: db, ADMIN_KEY };
    const user = await createUser(db, 'round@example.com');
    user.stripe_customer_id = 'cus_secret'; // a would-be-leaked field the admin view must never surface
    const { token } = await createSession(db, user.id);
    const me = async () => (await meGet({ request: req('/api/me', { method: 'GET', cookie: cookieFor(token) }), env })).json();
    ok('round-trip: starts local', (await me()).tier === 'local');

    const grant = await adminEntitlement({
      request: adminPost({ userId: user.id, action: 'grant', expiresAt: null, reason: 'vip' }, { email: 'boss@bb' }),
      env,
    });
    const gj = await grant.json();
    ok(
      'grant returns the updated view (effectiveTier cloud, override stamped)',
      grant.status === 200 && gj.effectiveTier === 'cloud' && gj.override.grantedBy === 'boss@bb' && gj.override.reason === 'vip'
    );
    ok('grant → /api/me now reports cloud', (await me()).tier === 'cloud');

    const unknown = await adminEntitlement({ request: adminPost({ userId: 'nope', action: 'grant' }), env });
    ok('grant on an unknown user → 404', unknown.status === 404);

    const revoke = await adminEntitlement({ request: adminPost({ userId: user.id, action: 'revoke' }, { email: 'boss@bb' }), env });
    const rj = await revoke.json();
    ok(
      'revoke returns the updated view (effectiveTier local, revokedAt stamped)',
      rj.effectiveTier === 'local' && rj.override.revokedAt != null
    );
    ok('revoke → /api/me back to local', (await me()).tier === 'local');

    const noEmailGrant = await adminEntitlement({ request: adminPost({ userId: user.id, action: 'grant' }), env });
    ok('grant without an Access email records granted_by = (token)', (await noEmailGrant.json()).override.grantedBy === '(token)');

    const bad = await adminEntitlement({ request: adminPost({ userId: user.id, action: 'frobnicate' }), env });
    ok('an invalid action → 400', bad.status === 400);

    const list = await adminUsers({ request: adminGet('/api/admin/users'), env });
    const blob = JSON.stringify(await list.json());
    ok('the users response leaks no sensitive substrings (S25)', !/sync_|workspace|ciphertext|stripe_/i.test(blob));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
