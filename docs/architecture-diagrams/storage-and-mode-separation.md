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
    SWAP -->|"no · app / staging"| REALSTORE["Store<br/>store.ts (IndexedDB)"]

    %% ---- Real IndexedDB backend: separated by DB name ----
    REALSTORE --> DBNAME{"DB_NAME<br/>mode === 'staging' ?"}
    DBNAME -->|"staging"| STGDB[("IndexedDB<br/>blotterbookStaging<br/>seeded with sample data")]
    DBNAME -->|"app · default"| PRODDB[("IndexedDB<br/>blotterbook<br/>empty → first-run onboarding")]

    subgraph STORES["object stores — same schema in both DBs (DB_VERSION 2)"]
        OS["trades · journal · meta · trademeta"]
    end
    STGDB --- STORES
    PRODDB --- STORES

    %% ---- Demo backend: never touches disk ----
    DEMOSTORE --> MEM["in-memory Maps / arrays<br/>NO IndexedDB · NO localStorage<br/>lost on reload — 'never persists' by construction"]

    %% ---- localStorage seam (small sync UI state) ----
    APP -. "Store.local (sync UI state:<br/>panel layout, workspaces)" .-> LS["localStorage (origin-shared,<br/>namespaced by key prefix)<br/>app: bb:*  ·  staging: bb:staging:*<br/>demo: in-memory Map (no writes)"]

    classDef db fill:#1f2937,stroke:#9ca3af,color:#e5e7eb;
    classDef mem fill:#3f2937,stroke:#f59e0b,color:#fde68a;
    class STGDB,PRODDB db;
    class MEM mem;
```

## How separation actually happens

Two *different* mechanisms — not one shared switch:

| Surfaces | Isolation mechanism | Where |
| --- | --- | --- |
| **prod vs staging** | Same `Store`/IndexedDB engine, **different database name** (`blotterbook` vs `blotterbookStaging`). IndexedDB is origin-scoped, but named DBs are fully isolated, so the two never see each other's rows. | `store.ts` `DB_NAME` ternary |
| **demo vs everything** | A **different `Store` implementation** (`DemoStore`) backed by in-memory `Map`s — it never calls `indexedDB.open` at all, so it can't touch (or pollute) the prod `blotterbook` DB. | `App.svelte` store swap |

## Notes / gotchas

- **The `DB_NAME` ternary maps both `app` *and* `demo` to `blotterbook`.** Demo is safe *only*
  because it never uses the real `Store`. If demo ever fell through to `Store`, it would write into
  the prod DB. That's why demo has belt-and-suspenders on top of the swap: every write path is
  `isDemo`-guarded (`if (isDemo) return;`) and the UI disables each data-writing control. The e2e
  suite asserts **no** Blotterbook IndexedDB is created on the demo surface.
- **Staging has a second, independent layer of protection:** the edge middleware gates the page
  itself (admin credential required; **fails closed with 403** if `ADMIN_KEY` is unset). This is
  access control, orthogonal to the data isolation above. Prod and demo are public.
- **All access funnels through the `Store` interface** — the app never touches `indexedDB` directly,
  so a future `CloudStore` (subscription tier) can drop in behind the same async methods.
- **Dedupe:** `trades` are keyed by a content hash (`tradeId`, FNV-1a over
  `time|symbol|side|pnl`), so re-uploading an overlapping CSV only inserts genuinely new rows.
