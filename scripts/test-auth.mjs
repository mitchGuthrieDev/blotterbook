/* Tests for functions/_lib/auth.js — admin token round-trip + Stripe webhook
   signature verification (S13). Run: node scripts/test-auth.mjs
   Uses only Node built-ins; auth.js relies on WebCrypto (global in Node 18+). */
import { issueToken, verifyToken, verifyStripeSignature } from '../functions/_lib/auth.js';
import { onRequest as adminKeyOnRequest } from '../functions/api/admin-key.js';
import { createHmac } from 'node:crypto';

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

const stripeHeader = (secret, body, t) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const SECRET = 'whsec_test_123';
const BODY = '{"id":"evt_1","type":"checkout.session.completed"}';
const now = Math.floor(Date.now() / 1000);

console.log('Admin token round-trip:');
{
  const { token } = await issueToken('s3cr3t', 3600);
  ok('valid token verifies', await verifyToken('s3cr3t', token));
  ok('wrong secret rejected', !(await verifyToken('other', token)));
  ok('tampered token rejected', !(await verifyToken('s3cr3t', token.slice(0, -2) + 'xy')));
  const { token: expd } = await issueToken('s3cr3t', -1); // already expired
  ok('expired token rejected', !(await verifyToken('s3cr3t', expd)));
  ok('garbage rejected', !(await verifyToken('s3cr3t', 'not-a-token')));
}

console.log('\nStripe webhook signature (S13):');
ok('valid signature passes', await verifyStripeSignature(BODY, stripeHeader(SECRET, BODY, now), SECRET));
ok('tampered body fails', !(await verifyStripeSignature(BODY + ' ', stripeHeader(SECRET, BODY, now), SECRET)));
ok('wrong secret fails', !(await verifyStripeSignature(BODY, stripeHeader('whsec_wrong', BODY, now), SECRET)));
ok('stale timestamp (>5min) fails', !(await verifyStripeSignature(BODY, stripeHeader(SECRET, BODY, now - 600), SECRET)));
ok('missing v1 fails', !(await verifyStripeSignature(BODY, `t=${now}`, SECRET)));
ok('empty header fails', !(await verifyStripeSignature(BODY, '', SECRET)));
ok('missing secret fails', !(await verifyStripeSignature(BODY, stripeHeader(SECRET, BODY, now), '')));
// multiple v1s (Stripe rotates secrets): the matching one anywhere in the list passes
ok(
  'matches one of several v1s',
  await verifyStripeSignature(
    BODY,
    `t=${now},v1=deadbeef,v1=${createHmac('sha256', SECRET).update(`${now}.${BODY}`).digest('hex')}`,
    SECRET
  )
);

console.log('\nadmin-key ?check debug gate (S21):');
{
  const call = (url, env) => adminKeyOnRequest({ request: new Request(url), env });
  // No ADMIN_DEBUG → the diagnostic endpoint must look like it doesn't exist (404), so an
  // anonymous caller can't fingerprint the Access/infra config even if it's left reachable.
  ok('?check is 404 when ADMIN_DEBUG unset', (await call('https://x/api/admin-key?check', {})).status === 404);
  ok('?check is not 404 when ADMIN_DEBUG=1', (await call('https://x/api/admin-key?check', { ADMIN_DEBUG: '1' })).status === 200);
  // A normal (non-?check) request still requires authentication regardless of ADMIN_DEBUG.
  ok('normal request without an Access assertion is 401', (await call('https://x/api/admin-key', {})).status === 401);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
