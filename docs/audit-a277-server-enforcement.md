# A277 — Server-side enforcement audit (no trusted client-side gates)

**Scope:** prove that no authentication, ownership, or entitlement/paywall gate in Blotterbook is
trusted *client*-side — every protected surface in `functions/` must independently re-check
identity / ownership / entitlement / origin on the server. Read-only audit; no product code changed.

**Method:** read every route under `functions/api/**` plus the shared helpers
(`functions/_lib/{accounts,auth,sync,http,types}.ts`), `functions/_middleware.ts`, and the F56
client gate (`src/app/parts/LaunchGate.svelte`). For each protected route the four attack cases
below were reasoned through against the actual code.

---

## Executive summary — verdict: **CLEAN**

Every protected server route re-derives the caller's identity from the hashed session cookie in D1
(`sessionFromRequest`, `functions/_lib/accounts.ts:226`), never from a client-supplied claim. Every
*mutating* route is Origin-checked (`checkOrigin`, `functions/_lib/accounts.ts:158`). Every
cloud-sync *write* re-checks the paid entitlement server-side via `grantsCloud`
(`functions/_lib/accounts.ts:452`, called through `callerHasCloud`, `functions/_lib/sync.ts:56`),
closing the A253 paywall-bypass class. Every workspace/record access is authorized to
`owner_user_id` (`ownedWorkspace`, `functions/_lib/sync.ts:135`), so cross-user access — even to
ciphertext — returns a non-leaking 404. The Stripe webhook verifies the signature over the raw body
*before* any provisioning (`functions/api/webhook.ts:97`). Admin routes verify a Cloudflare Access
JWT (or fail closed) and an HMAC admin token. No CORS-permissive headers are emitted anywhere in
`functions/` (verified: no `Access-Control-*`), so the same-origin policy independently blocks
cross-site *reading* of any response.

The client-side gates that exist (the F56 `LaunchGate`, the `isStaging`/`isDemo` render guards, the
`Entitlements` tier probe) are **UX-only** — removing or spoofing them cannot escalate access,
read another user's data, bypass the paywall, or reach admin, because the server re-checks
everything independently.

**No security gaps found.** One non-security documentation-drift nit is filed as P3 (a stale
`MAX_PUSH_RECORDS` comment in `push.ts`).

---

## Per-route enforcement table

Legend: **Identity** = server-side session/JWT/signature resolution · **Ownership** = per-user
authorization of the resource · **Entitlement** = cloud-tier paywall re-check · **Origin** = CSRF
Origin check on mutations · n/a = not applicable to this route's threat model.

| Route (method) | Identity | Ownership | Entitlement | Origin | Verdict |
|---|---|---|---|---|---|
| `POST /api/sync/push` | session (push.ts:59) | `ownedWorkspace`→404 (push.ts:82) | `callerHasCloud`→402 (push.ts:65) | `checkOrigin`→403 (push.ts:53) | **PASS** |
| `GET /api/sync/pull` | session (pull.ts:28) | `ownedWorkspace`→404 (pull.ts:38) | none — read, by design (sync.ts:50-55) | n/a (read) | **PASS** |
| `POST /api/sync/workspaces` | session (workspaces.ts:53) | owner check→409 (workspaces.ts:68) | `callerHasCloud`→402 (workspaces.ts:58) | `checkOrigin`→403 (workspaces.ts:47) | **PASS** |
| `GET /api/sync/workspaces` | session (workspaces.ts:119) | `WHERE owner_user_id=?` (workspaces.ts:123) | none — read, by design | n/a (read) | **PASS** |
| `PUT /api/sync/wrapped-ik` | session (wrapped-ik.ts:34) | keyed `user_id=?` (wrapped-ik.ts:49) | `callerHasCloud`→402 (wrapped-ik.ts:39) | `checkOrigin`→403 (wrapped-ik.ts:28) | **PASS** |
| `GET /api/sync/wrapped-ik` | session (wrapped-ik.ts:74) | keyed `user_id=?` (wrapped-ik.ts:78) | none — read, by design | n/a (read) | **PASS** |
| `GET /api/me` | session→D1 (me.ts:44) | own user only (me.ts:46) | `grantsCloud` derives tier (me.ts:49) | n/a (read) | **PASS** |
| `POST /api/account/register-options` | anon or session (register-options.ts:43) | email held server-side on challenge (:74) | n/a | `checkOrigin` (:38) | **PASS** |
| `POST /api/account/register-verify` | WebAuthn attestation verify (register-verify.ts:55) | single-use challenge (:49) | n/a | `checkOrigin` (:38) | **PASS** |
| `POST /api/account/login-options` | n/a (issues challenge) | single-use challenge (login-options.ts:25) | n/a | `checkOrigin` (:18) | **PASS** |
| `POST /api/account/login-verify` | WebAuthn assertion verify vs stored pubkey (login-verify.ts:57) | credential→user (:76) | n/a | `checkOrigin` (:35) | **PASS** |
| `POST /api/account/logout` | destroys cookie's session row (logout.ts:19) | own session only (accounts.ts:246) | n/a | `checkOrigin` (:14) | **PASS** |
| `POST /api/account/email-verify-send` | session→401 (email-verify-send.ts:27) | own email (:32) | n/a | `checkOrigin` (:20) | **PASS** |
| `GET\|POST /api/account/email-verify-confirm` | single-use capability token (email-verify-confirm.ts:51) | token bound to `user_id` (:52) | n/a | n/a — token *is* the auth (:11) | **PASS** |
| `POST /api/account/recover-send` | unauthed; enumeration-safe 200 (recover-send.ts:42) | emails verified account only (:35) | n/a | `checkOrigin` (:21) | **PASS** |
| `POST /api/account/recover-verify` | single-use recover token (recover-verify.ts:42) | token bound to `user_id` (:43) | n/a | `checkOrigin` (:37) | **PASS** |
| `POST /api/checkout` | optional session for linkage (checkout.ts:31) | price from env only (:24) | n/a (grants nothing) | `checkOrigin`→403 (:19) | **PASS** |
| `POST /api/webhook` | Stripe signature over raw body (webhook.ts:97) | trusted linkage only (:139,:182) | provisions tier post-verify | n/a — signature is the auth | **PASS** |
| `GET /api/admin-key` | Access JWT verify or fail-closed (admin-key.ts:48-58) | n/a | n/a | n/a | **PASS** |
| `POST /api/status` | `isAdminAuthorized` (status.ts:49) | n/a | n/a | admin token (constant-time) | **PASS** |
| `POST /api/config` | `isAdminAuthorized` (config.ts:58) | flag keys allow-listed (:71) | n/a | admin token (constant-time) | **PASS** |
| `GET /api/status`, `GET /api/config` | public by design | n/a | n/a | n/a | **PASS** |
| `/app/staging.html` (middleware) | `isAdminAuthorized`, fail-closed 403 (\_middleware.ts:38-43) | n/a | n/a | header or path-scoped cookie (:37) | **PASS** |
| F56 `LaunchGate.svelte` (client) | **UX only** — not a boundary | n/a | n/a | n/a | **PASS (advisory)** |

---

## The four attack cases

### 1. Attacker holds a VALID FREE-tier session cookie and hits the cloud-sync endpoints directly (paywall bypass)

**Defended.** Every *mutating* sync route resolves the caller's subscription server-side and requires
`grantsCloud()` before writing:

- `POST /api/sync/push` → `if (!(await callerHasCloud(db, session.user_id))) return cloudRequired();`
  (`functions/api/sync/push.ts:65`), 402.
- `POST /api/sync/workspaces` → same gate at `functions/api/sync/workspaces.ts:58`.
- `PUT /api/sync/wrapped-ik` → same gate at `functions/api/sync/wrapped-ik.ts:39`.

`callerHasCloud` (`functions/_lib/sync.ts:56`) reads the D1 `subscriptions` row and applies the
locked period-end + grace policy in `grantsCloud` (`functions/_lib/accounts.ts:452`). A free-tier
session therefore cannot write a single blob — no free cloud storage, no storage DoS. The client's
own tier check (`Entitlements`) is explicitly advisory (`functions/_lib/sync.ts:47-51`).

The *read* routes (pull, workspaces GET, wrapped-ik GET) are intentionally **not** tier-gated
(`functions/_lib/sync.ts:50-55`) so a lapsed/downgraded account can still reconcile its already-stored
ciphertext back down to local IndexedDB. This is not a paywall bypass: a free user who *never* paid
has no rows to read (they could never have pushed), `ownedWorkspace` returns 404 for anything not
theirs, and reads neither grow storage nor reveal plaintext (server holds no key). Confirmed no
paywall or storage-abuse path via reads.

### 2. Unauthenticated direct requests

**Defended.** Every sync route calls `sessionFromRequest` and returns 401 `authRequired()` on a
missing/garbage/expired cookie (`push.ts:59-60`, `pull.ts:28-29`, `workspaces.ts:53-54`/`119-120`,
`wrapped-ik.ts:34-35`/`74-75`). `sessionFromRequest` (`functions/_lib/accounts.ts:226`) parses the
`id.secret` cookie, looks up the row by `id`, deletes-and-rejects if expired, and compares
`SHA-256(secret)` against `secret_hash` in **constant time** (`hashesEqual`, `accounts.ts:147`), so a
forged or truncated cookie never resolves. `/api/me` returns the anonymous `{tier:'local'}` shape for
no/invalid session (`me.ts:45`). All account/sync/webhook routes fail **closed** with 503 when
`ACCOUNTS_DB`/`SYNC_BUCKET` is unbound (`dbUnavailable`, `accounts.ts:49`; `bucketUnavailable`,
`sync.ts:37`) — never a silent success. WebAuthn register/login *verify* the authenticator response
server-side (`register-verify.ts:55`, `login-verify.ts:57`) — a fabricated response fails
cryptographic verification.

### 3. Cross-user access — reading another user's records/blobs even as ciphertext (ownership)

**Defended.** `ownedWorkspace` (`functions/_lib/sync.ts:135`) fetches the workspace row and returns
`null` unless `row.owner_user_id === userId`; push (`push.ts:82`) and pull (`pull.ts:38`) then answer
a uniform **404**, so existence never leaks across accounts. `workspaces` GET selects
`WHERE owner_user_id = ?` (`workspaces.ts:123`); a POST re-registering a workspace owned by someone
else returns 409 and never re-owns it (`workspaces.ts:68`). `wrapped-ik` reads/writes are keyed by
`user_id = session.user_id` (`wrapped-ik.ts:49`, `:78`). Records live under
`records/<workspace_id>/<blinded_id>` (`recordKey`, `sync.ts:144`) and are only reachable through an
owner-authorized workspace. Even if authorization were bypassed, stored data is opaque AES-GCM
ciphertext keyed by blinded ids — the server holds no key (S25). Cross-user read is closed at the
authorization layer *and* by encryption.

### 4. Wrong-Origin / CSRF

**Defended.** Every state-changing route calls `checkOrigin` first and returns 403 `badOrigin()` on a
missing or mismatched `Origin` header (`checkOrigin`, `functions/_lib/accounts.ts:158`; applied in
push/workspaces/wrapped-ik and all mutating `/api/account/*` + `/api/checkout` — verified present in
all 11 mutating routes). The session cookie is `__Host-`-prefixed, `HttpOnly`, `Secure`,
`SameSite=Lax` (`sessionSetCookie`, `accounts.ts:252`), so it is not sent on cross-site subrequests
and cannot be read by script. GET routes omit the Origin check by design — they change no state, and
because **no route emits any `Access-Control-Allow-Origin` header** (verified: zero `Access-Control-*`
in `functions/`), the same-origin policy prevents an attacker page from reading any response body
(and sync responses are ciphertext regardless). The Stripe webhook needs no Origin check — its
authenticity is the HMAC signature over the raw body (`webhook.ts:97`), verified before any
provisioning. `email-verify-confirm` intentionally skips Origin/session because the single-use
capability token *is* the auth and the GET arrives cross-site from a mail client
(`email-verify-confirm.ts:11`); the token is bound to one `user_id` and grants only that email's
verification.

---

## Client-side gates confirmed UX-only (not security boundaries)

- **F56 `LaunchGate.svelte`** (`src/app/parts/LaunchGate.svelte`) — renders a login/create-account
  card while `!account.user`. It gates *what the SPA shows*, not what the server returns; its login
  path calls the real server ceremonies. Bypassing it (e.g. editing the flag) reveals only the empty
  app shell — every data/sync/account call still hits a server route that re-checks the session. It
  is armed only on staging via `APP_FLAGS.ACCOUNT_GATE` and comments say so (`LaunchGate.svelte:1-11`).
- **`isStaging` / `isDemo` render guards + the staging `_middleware` HTML gate** — the middleware
  protects the staging *HTML asset* only (`functions/_middleware.ts:25`); the actual cloud-sync data
  boundary is the session + entitlement + ownership checks on `/api/sync/*`, which hold on every
  surface regardless of how the HTML was reached.
- **`Entitlements`/`/api/me` tier probe** — the client uses the tier only to pick a `Store`
  implementation; the server re-derives `cloud` from the signed-webhook-written `subscriptions` row
  (`me.ts:49`, and independently on every sync write). Spoofing the client tier grants nothing.

---

## Findings / gaps

No security gaps. One documentation-accuracy nit worth a low-priority cleanup:

### Candidate backlog item

```json
{
  "id": "A2xx",
  "title": "Fix stale MAX_PUSH_RECORDS comment in api/sync/push.ts (says 15, constant is 12)",
  "category": "docs",
  "priority": "P3",
  "effort": "trivial",
  "prompt": "functions/api/sync/push.ts:20-21 JSDoc states the push batch cap is 'MAX_PUSH_RECORDS (15)' and '2 fixed + 3 per record ⇒ ≤ 47 < 50 subrequests', but the enforced constant is MAX_PUSH_RECORDS = 12 (functions/_lib/sync.ts:129), and sync.ts's own budget note (sync.ts:121-128) correctly computes 6 fixed + 3·12 = 42. Enforcement is correct — this is only a stale comment left from when the cap was lowered 15→12. Update the push.ts header comment to say 12 and match sync.ts's subrequest math. No behavior change; not a security issue (the code uses the constant, not the number in the comment)."
}
```
