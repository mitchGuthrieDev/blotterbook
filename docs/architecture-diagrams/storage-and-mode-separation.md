# Storage & mode separation

How the three app surfaces (**prod / demo / staging**) select a `Store` at boot and how their data
is kept isolated. The whole app talks to one `Store` interface; only *which* implementation and
*which* backing database it gets differs per surface.

**Source of truth:** [`src/lib/core/store.ts`](../../src/lib/core/store.ts) ·
[`src/lib/core/demostore.ts`](../../src/lib/core/demostore.ts) ·
[`src/app/App.svelte`](../../src/app/App.svelte) ·
[`src/lib/core/core.ts`](../../src/lib/core/core.ts) (`PAGE_MODE`) ·
[`functions/_middleware.ts`](../../functions/_middleware.ts) (staging edge gate).

```mermaid
flowchart TD
    %% ---- Surfaces (hand-authored mount shells) ----
    subgraph SHELLS["Mount shells — src/app/*.html (data-mode)"]
        APPH["app.html<br/>data-mode = app"]
        DEMOH["demo.html<br/>data-mode = demo"]
        STGH["staging.html<br/>data-mode = staging"]
    end

    EDGE{{"functions/_middleware.ts<br/>gates /app/staging.html<br/>admin key/cookie · fail-closed 403"}}
    EDGE -. "gates page load (network layer)" .-> STGH

    APPH --> MAIN["main.ts — mount(App)"]
    DEMOH --> MAIN
    STGH --> MAIN

    MAIN --> APP["App.svelte<br/>PAGE_MODE = body.dataset.mode<br/>resolves store, prop-drills it (no context call)"]

    APP --> SWAP{"isDemo ?"}
    SWAP -->|"yes · demo"| DEMOSTORE["createDemoStore()<br/>demostore.ts"]
    SWAP -->|"no · app / staging"| ENT["Entitlements.storeFor('local')<br/>entitlements.ts → Store (IndexedDB)<br/>(both tiers resolve to the same base Store)"]

    %% ---- Every non-demo surface wraps the real Store in a CloudStore (App.svelte:94-95) ----
    %% the cloud-tier opt-in is a RUNTIME check inside the sync controller, not a mode branch (A256)
    ENT --> CLOUD["CloudStore (wrapStore)<br/>write-behind: reads local, writes enqueue<br/>encrypted push → /api/sync/* (F63)<br/>inert until cloud-tier opt-in + unlock (A256 runtime gate)"]
    CLOUD --> REALSTORE["Store<br/>store.ts (IndexedDB)"]

    %% ---- Real IndexedDB backend: separated by DB name, then per-workspace DB (F59) ----
    REALSTORE --> DBNAME{"active workspace DB<br/>mode === 'staging' ?"}
    DBNAME -->|"staging"| STGDB[("IndexedDB<br/>blotterbookStaging (Default)<br/>or blotterbookStaging:&lt;uuid&gt;<br/>seeded with sample data")]
    DBNAME -->|"app · default"| PRODDB[("IndexedDB<br/>blotterbook (Default)<br/>or blotterbook:&lt;uuid&gt; per workspace<br/>empty → first-run onboarding")]

    subgraph STORES["object stores — same schema in every workspace DB (DB_VERSION 5)"]
        OS["trades · journal · meta · trademeta · files · filetext ·<br/>tombstones (F58, composite-keyed `${type}:${id}` — v5/A269)"]
    end
    STGDB --- STORES
    PRODDB --- STORES

    %% ---- Demo backend: never touches disk, never syncs ----
    DEMOSTORE --> MEM["in-memory Maps / arrays<br/>NO IndexedDB · NO localStorage · NEVER a cloud store<br/>lost on reload — 'never persists' by construction"]

    %% ---- localStorage seam (small sync UI state) ----
    APP -. "Store.local (sync UI state:<br/>panel layout · workspace registry + active id (F59)<br/>· sync cursors, never a key (F63))" .-> LS["localStorage (origin-shared,<br/>namespaced by key prefix)<br/>app: bb:*  ·  staging: bb:staging:*<br/>demo: in-memory Map (no writes)"]

    classDef db fill:#1f2937,stroke:#9ca3af,color:#e5e7eb;
    classDef mem fill:#3f2937,stroke:#f59e0b,color:#fde68a;
    class STGDB,PRODDB db;
    class MEM mem;
```

## How separation actually happens

Two *different* mechanisms — not one shared switch:

| Surfaces | Isolation mechanism | Where |
| --- | --- | --- |
| **prod vs staging** | Same `Store`/IndexedDB engine, **different database name** (`blotterbook` vs `blotterbookStaging`). IndexedDB is origin-scoped, but named DBs are fully isolated, so the two never see each other's rows. | `store.ts` `LEGACY_DB_NAME` + `WS_DB_PREFIX` ternaries |
| **demo vs everything** | A **different `Store` implementation** (`DemoStore`) backed by in-memory `Map`s — it never calls `indexedDB.open` at all, so it can't touch (or pollute) the prod `blotterbook` DB. | `App.svelte` store swap |

## Notes / gotchas

- **The `LEGACY_DB_NAME`/`WS_DB_PREFIX` ternaries map both `app` *and* `demo` to `blotterbook`.** Demo is safe *only*
  because it never uses the real `Store`. If demo ever fell through to `Store`, it would write into
  the prod DB. That's why demo has belt-and-suspenders on top of the swap: every write path is
  `isDemo`-guarded (`if (isDemo) return;`) and the UI disables each data-writing control. The e2e
  suite asserts **no** Blotterbook IndexedDB is created on the demo surface.
- **Staging has a second, independent layer of protection:** the edge middleware gates the page
  itself (admin credential required; **fails closed with 403** if `ADMIN_KEY` is unset). This is
  access control, orthogonal to the data isolation above. Prod and demo are public.
- **All access funnels through the `Store` interface** — the app never touches `indexedDB` directly,
  so the `CloudStore` write-behind wrapper (F63) drops in behind the same async methods. `App.svelte`
  resolves the store through `Entitlements.storeFor()` and wraps it in `CloudStore` (`wrapStore`) for
  **every non-demo surface** (app + staging, unconditionally — `App.svelte:94-95`); demo never
  constructs one. The wrapper stays inert — no `/api/sync/*` traffic — until the sync controller's
  runtime check (A256) sees a `cloud`-tier user who has opted a workspace in and unlocked it.
- **Named workspaces (F59):** the store is now workspace-scoped — each named workspace is its **own**
  IndexedDB DB (`blotterbook:<uuid>`), while the pre-F59 **Default** keeps the legacy DB name
  (`blotterbook`/`blotterbookStaging`) so existing data is used in place. The `DB_NAME` seam that
  already split prod vs. staging now also selects the active workspace's DB; the registry + active id
  live in `Store.local`.
- **Dedupe & tombstones:** `trades` are keyed by a content hash (`tradeId`, FNV-1a over
  `time|symbol|side|pnl`), so re-uploading an overlapping CSV only inserts genuinely new rows — and a
  `tombstones` store (F58) stops a re-import from resurrecting a deleted trade.
- **The sync branch is live on prod + staging (opt-in, `cloud`-tier only; never demo)** and detailed
  in [`docs/synced-workspaces.md`](../synced-workspaces.md) + [`docs/data-flow.md`](../data-flow.md)
  §7a — only ciphertext + blinded ids ever reach `/api/sync/*`.
