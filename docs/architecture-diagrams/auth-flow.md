# Auth flow — passkeys, sessions, recovery & the E2E vault

How a user signs in and how sign-in relates to encryption. Four views: the WebAuthn registration
and login ceremonies, the lost-passkey recovery path, the two-secret key hierarchy (passkey =
sign-in, passphrase/recovery/PRF = encryption unlock), and the cloud-sync vault setup/unlock wiring.

**Source of truth:** [`functions/api/account/`](../../functions/api/account/) ·
[`functions/_lib/accounts.ts`](../../functions/_lib/accounts.ts) ·
[`functions/api/me.ts`](../../functions/api/me.ts) ·
[`functions/api/sync/wrapped-ik.ts`](../../functions/api/sync/wrapped-ik.ts) ·
[`src/app/lib/account.svelte.ts`](../../src/app/lib/account.svelte.ts) ·
[`src/app/lib/vault.svelte.ts`](../../src/app/lib/vault.svelte.ts) ·
[`src/lib/core/crypto.ts`](../../src/lib/core/crypto.ts) ·
[`src/app/parts/CloudSyncSetup.svelte`](../../src/app/parts/CloudSyncSetup.svelte) ·
[`src/app/parts/UnlockModal.svelte`](../../src/app/parts/UnlockModal.svelte).

## Registration ceremony (create account / add passkey)

```mermaid
sequenceDiagram
    autonumber
    participant UI as Account.svelte / LaunchGate
    participant Acct as account.svelte.ts
    participant WA as "@simplewebauthn/browser + authenticator"
    participant RO as POST /api/account/register-options
    participant Ver as POST /api/account/register-verify
    participant D1 as D1 (ACCOUNTS_DB)

    UI->>Acct: register(email) — or addPasskey() when signed in
    Acct->>RO: POST {email} (anon) / empty body (add-passkey, identity from session)
    RO->>RO: checkOrigin · validate email · 409 if email taken
    RO->>D1: putChallenge(type register, email held server-side, 5-min single-use TTL)
    RO-->>Acct: options — residentKey required, UV required, excludeCredentials
    Acct->>WA: startRegistration(options)
    WA-->>Acct: attestation response (discoverable credential, user-verified)
    Acct->>Ver: POST {response}
    Ver->>D1: consumeChallenge (located via clientDataJSON, deleted even if expired)
    Ver->>Ver: verifyRegistrationResponse(origin + rpID + UV required) — 400 on fail
    alt new account
        Ver->>D1: createUser(email) — ON CONFLICT 409 (email_verified starts 0)
    else add-passkey / recovery re-enroll
        Ver->>D1: attach credential to challenge.user_id
    end
    Ver->>D1: insertCredential (COSE key, counter, transports, backedUp, userVerified)
    opt challenge flagged recovery
        Ver->>D1: deleteSessionsForUser — revoke a stolen device's sessions FIRST (A302)
    end
    Ver->>D1: createSession → Set-Cookie __Host-bb_session
    Acct->>Acct: refreshSession() — GET /api/me hydrates user + passkeys + tier
```

## Login ceremony (usernameless / discoverable)

```mermaid
sequenceDiagram
    autonumber
    participant Acct as account.svelte.ts
    participant WA as "@simplewebauthn/browser + authenticator"
    participant LO as POST /api/account/login-options
    participant Ver as POST /api/account/login-verify
    participant D1 as D1 (ACCOUNTS_DB)

    Acct->>LO: POST (empty — usernameless)
    LO->>D1: putChallenge(type login, no user bound)
    LO-->>Acct: options — no allowCredentials (browser offers its Blotterbook passkeys)
    Acct->>WA: startAuthentication(options)
    WA-->>Acct: assertion (user picks a discoverable credential)
    Acct->>Ver: POST {response}
    Ver->>D1: consumeChallenge (single-use) · credentialById — 401 if unknown
    Ver->>Ver: verifyAuthenticationResponse(origin + rpID · UV preferred, not required)
    Ver->>D1: touchCredential (signature counter + last_used_at)
    Ver->>D1: createSession → Set-Cookie __Host-bb_session
    Acct->>Acct: refreshSession() — GET /api/me
```

## Lost-passkey recovery (verified email → re-enroll)

```mermaid
sequenceDiagram
    autonumber
    participant U as User (logged out)
    participant Acct as Account.svelte + account.svelte.ts
    participant Send as POST /api/account/recover-send
    participant Mail as Email (Resend)
    participant RVer as POST /api/account/recover-verify
    participant Reg as POST /api/account/register-verify
    participant D1 as D1 (ACCOUNTS_DB)

    U->>Acct: Lost your passkey? (email form)
    Acct->>Send: POST {email}
    Send-->>Acct: always 200 — enumeration-safe
    opt user exists AND email_verified
        Send->>D1: createRecoveryToken (SHA-256 of secret stored, 15-min single-use)
        Send->>Mail: link /app/app.html?recover=TOKEN#account
    end
    U->>Acct: opens link — onMount reads ?recover=, scrubs the URL
    Acct->>RVer: POST {token}
    RVer->>D1: consumeRecoveryToken — 400 if expired/used
    RVer->>D1: setEmailVerified + claimDonationsForUser
    RVer-->>Acct: fresh register options (challenge flagged recovery, UV required)
    Acct->>Reg: startRegistration → POST {response} (standard ceremony)
    Reg->>D1: enroll new passkey · deleteSessionsForUser FIRST · createSession
```

## The two-secret model — sign-in vs. encryption unlock

```mermaid
flowchart TB
    subgraph SIGNIN["Sign-in (server-verified identity)"]
        PK["Passkey (WebAuthn)"] -->|"login ceremony"| SESS["session cookie __Host-bb_session<br/>server stores only SHA-256 of the secret"]
        SESS --> ME["GET /api/me → user + tier<br/>(cloud on active/grace subscription, F60)"]
    end

    subgraph UNLOCK["Encryption unlock (client-only — server never sees a key)"]
        PRF["PRF passkey output<br/>(WebAuthn prf extension)"] -->|"HKDF-SHA256"| KEK1["KEK (prf)"]
        PP["Passphrase"] -->|"Argon2id (hash-wasm)"| KEK2["KEK (passphrase)"]
        RK["Recovery key<br/>(256-bit, shown once at setup)"] -->|"HKDF"| KEK3["KEK (recovery)"]
        KEK1 & KEK2 & KEK3 -->|"AES-KW unwrap"| IK["account IDENTITY KEY (IK)<br/>in-memory only, per session"]
        IK -->|"AES-KW unwrap"| DEK["per-workspace DEK"]
        DEK -->|"AES-GCM, fresh IV, AAD (A308)"| REC["trade / journal / meta records"]
    end

    subgraph SERVER["Server-side (opaque ciphertext — cannot decrypt any of it)"]
        WIK["sync_wrapped_ik<br/>IK wrapped once per unlock method"]
        WDEK["sync_workspace_keys<br/>DEK wrapped under IK"]
        BLOB["sync_records + R2<br/>ciphertext + blinded ids (HMAC)"]
    end

    PK -.->|"a PRF passkey does BOTH<br/>in one tap"| PRF
    KEK1 & KEK2 & KEK3 -.->|"wrap IK → PUT /api/sync/wrapped-ik"| WIK
    IK -.->|"wrap DEK → POST /api/sync/workspaces"| WDEK
    DEK -.->|"encrypt → push"| BLOB
```

## Cloud-sync vault setup & unlock (UI → endpoint → crypto)

```mermaid
sequenceDiagram
    autonumber
    participant Setup as CloudSyncSetup.svelte
    participant Unlock as UnlockModal.svelte
    participant V as vault.svelte.ts
    participant C as crypto.ts
    participant WIK as PUT/GET /api/sync/wrapped-ik

    Note over Setup,WIK: SETUP (once per account, cloud tier)
    Setup->>V: beginSetup()
    V->>C: mint IK + recovery key (escrow)
    V-->>Setup: recovery key rendered ONCE for download
    Setup->>V: finishSetup({passphrase?})
    V->>C: wrap IK under recovery KEK (+ passphrase KEK if set)
    V->>WIK: PUT wrapped-ik per method — 402 unless cloud tier
    V->>V: IK promoted to in-memory session (zero transient bytes)

    Note over Unlock,WIK: UNLOCK (per browser session)
    Unlock->>WIK: GET wrapped-ik — ungated, so a LAPSED account can still unlock
    WIK-->>Unlock: WrappedIK blobs (methods prf / passphrase / recovery)
    alt PRF passkey
        Unlock->>V: unlockWithPasskey() — navigator.credentials.get with prf eval
        V->>C: kekFromPrf(HKDF) → unwrap IK
    else passphrase
        Unlock->>V: unlockWithPassphrase() — Argon2id params from the blob descriptor
        V->>C: kekFromPassphrase → unwrap IK
    else recovery key
        Unlock->>V: unlockWithRecoveryKey(base64)
        V->>C: kekFromRecoveryKey(HKDF) → unwrap IK
    end
    V->>V: IK in memory — cleared by lock() / logout / page refresh
```

## Notes

- **Session model:** the cookie value is opaque `id.secret`; the server persists only
  `SHA-256(secret)` (constant-time compare), so a D1 leak yields no usable token. 30-day sliding
  TTL with a 90-day absolute cap from creation (A302); `/api/me` re-issues the cookie so the
  browser's Max-Age tracks the slide. Logout deletes the session row by id (revocation-only, no
  secret required). `__Host-` forces Secure + Path=/ + no Domain; CSRF = SameSite=Lax plus an
  explicit Origin check on every mutating route.
- **Challenges and recovery tokens are single-use** and TTL'd (5 min / 15 min); a consumed or
  expired row is deleted on touch. The register ceremony requires user verification (UV); login
  accepts UV-preferred.
- **Email verification** (`email-verify-send` → emailed link → `email-verify-confirm`) flips
  `email_verified=1` and claims any pending donations. Recovery only ever emails a **verified**
  address, and `recover-send` answers 200 regardless — no account enumeration.
- **Two independent secrets:** the passkey proves identity to the *server*; the
  passphrase/recovery key/PRF output turns synced ciphertext back into plaintext in the *browser*.
  A PRF-capable passkey does both in one tap — but PRF must be requested at credential creation,
  so cloud sync enrolls a fresh PRF passkey (`registerPrfPasskey`, client-side extension only; no
  server change).
- **The server can never read** the IK, any DEK/KEK, the recovery key, or any plaintext trade
  field: it stores wrapped keys and AES-GCM ciphertext addressed by HMAC-blinded ids (S25). Keys
  live in module-scoped memory only and vanish on refresh/lock/logout.
- **Fail-closed plumbing:** every `/api/account/*` and `/api/sync/*` route 503s when
  `ACCOUNTS_DB` is unbound; the fail-open rate limiter is defense-in-depth only, never the control
  (S22).
