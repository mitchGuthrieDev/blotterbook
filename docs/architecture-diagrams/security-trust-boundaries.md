# Security model & trust boundaries

Where untrusted input is sanitized, and the invariants that keep the local-only trust model intact:
CSP, demo non-persistence, the staging fail-closed gate, and admin gating.

**Source of truth:** [`src/lib/core/store.ts`](../../src/lib/core/store.ts) (`importAll`, `SHOT_RE`,
`validShot`) · [`src/lib/core/adapters.ts`](../../src/lib/core/adapters.ts) (`rootSym`) ·
[`static/_headers`](../../static/_headers) (CSP) · [`functions/_middleware.ts`](../../functions/_middleware.ts).

```mermaid
flowchart TD
    subgraph UNTRUSTED["untrusted input boundaries"]
        CSVIN["CSV import"]
        BACKUP["backup restore (importAll)"]
        SHOTS["pasted / restored screenshots"]
    end

    CSVIN -->|"rootSym() charset sanitize"| STORE
    BACKUP -->|"validDate · cleanSym · cleanTags ·<br/>cleanShots · allow-list meta keys (S17/S20)"| STORE
    SHOTS -->|"SHOT_RE data-URI allow-list (S15/S18)<br/>rejects javascript: / data:text / SVG"| STORE

    STORE[("IndexedDB — via Store interface only")] --> RENDER["Svelte render<br/>utilities / styleProps · never a style= attr"]

    subgraph INVARIANTS["enforced invariants"]
        CSP["CSP style-src 'self' · script-src 'self' 'wasm-unsafe-eval' (_headers)<br/>no inline style=/JS eval — wasm only, for Argon2id (F61a)"]
        DEMO["demo: DemoStore + isDemo write guards<br/>→ nothing persists, never syncs (e2e-asserted)"]
        STG["staging: edge middleware<br/>fail-closed 403 if creds unset/invalid"]
        ADMIN["admin.html: Cloudflare Access + noindex"]
        LOCAL["compute 100% local · no telemetry<br/>egress ONLY the opt-in cloud-sync ciphertext<br/>(E2E, zero-knowledge; F58–F63, live on prod + staging)"]
        GATE56["F56 login gate: app+staging boot fires a<br/>same-origin GET /api/me probe (LaunchGate)<br/>carries no plaintext trade data"]
    end

    RENDER --- CSP
    STORE --- DEMO
    GATE56 -. "identity/entitlement only" .-> LOCAL
```

## Notes

- **Sanitize at the trust boundary, not the sink.** CSV symbols route through `rootSym()`; a restored
  backup is treated as fully untrusted — dates must be canonical `YYYY-MM-DD`, symbols re-sanitized,
  tags stripped of markup + lowercased, `meta` keys allow-listed (only `setup`/`savedFilters`, with
  `savedFilters` shape-validated), and screenshots kept only if they match `SHOT_RE` (well-formed
  base64 image data URIs). The live capture path shares the exact same `validShot` allow-list.
- **CSP `style-src 'self'` holds.** Tailwind ships as a linked stylesheet of classes; dynamic styles
  use the `styleProps` CSSOM action — **never** a literal `style=""` attribute. (bits-ui/Floating-UI
  positioning writes `element.style` via CSSOM, which isn't gated by `style-src`.)
- **Demo can't persist by construction** (in-memory `DemoStore`) *and* by guard (`if (isDemo) return`
  on every write) *and* by UI (controls disabled) — three independent layers; e2e asserts no
  Blotterbook IndexedDB is created on demo.
- **Staging fails closed** at the edge, and **admin** is Cloudflare Access-gated + `noindex`.
- **The model rests on local compute** — no telemetry; compute never touches the network. The only
  network calls are static `/data/*.json` reference data, the optional public `/api/*` niceties (geo,
  status, flags), the F56 `/api/me` login-gate probe (identity/entitlement only, below), and — on the
  **opt-in, `cloud`-tier** cloud-sync path (F58–F63, live on prod + staging) — **ciphertext + blinded
  ids** over `/api/sync/*`. That sync path is refined-moat-safe: records are AES-GCM-encrypted with an
  in-memory per-workspace key the server never sees (zero-knowledge — [`synced-workspaces.md`](../synced-workspaces.md)),
  pulled records re-enter through the **same** `importAll` sanitizers as a backup restore. **Demo never
  constructs a `CloudStore`; prod/staging always wrap** the local `Store` in one (`App.svelte:94-95`),
  but the sync controller keeps it inert absent a `cloud`-tier opt-in + unlock (A256 runtime check) —
  wrapping is unconditional, syncing is not. The one CSP relaxation is `script-src 'wasm-unsafe-eval'`
  for the Argon2id **wasm** only (`'unsafe-inline'`/`'unsafe-eval'` stay absent).
- **F56 login gate:** on app + staging (never demo), the shell probes `GET /api/me` at boot
  (`refreshSession`, `src/app/lib/flags.ts`'s `accountGateEnabled()`, `App.svelte` ~930) and holds
  behind `LaunchGate` until `account.user` resolves — including the pre-gate `?recover=` re-enrollment
  ceremony (`App.svelte` ~932–943). The request carries a session cookie only; no plaintext trade
  field is ever sent.
