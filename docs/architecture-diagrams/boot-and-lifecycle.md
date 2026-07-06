# Boot & lifecycle sequence

The ordered startup from `mount(App)` through reference-data load, store init, optional seeding,
data restore, and the first-run onboarding gate. One mode-aware `App.svelte` boots on every surface.

**Source of truth:** [`src/app/main.ts`](../../src/app/main.ts) ·
[`src/app/App.svelte`](../../src/app/App.svelte) ·
[`src/app/lib/dashboard.svelte.ts`](../../src/app/lib/dashboard.svelte.ts) ·
[`src/lib/core/core.ts`](../../src/lib/core/core.ts) (`loadRefData`, event bus).

```mermaid
sequenceDiagram
    autonumber
    participant M as main.ts
    participant App as App.svelte
    participant Dash as dashboard.svelte.ts
    participant Ref as loadRefData()
    participant Store as Store / DemoStore
    participant Bus as event bus

    M->>App: mount(App, {target: #app})
    Note over App: side-effect import format.ts + tailwind.css
    App->>App: PAGE_MODE = body.dataset.mode
    App->>App: store = isDemo ? DemoStore : Entitlements.storeFor('local')
    App->>App: if isStaging: store = wrapStore(store) — CloudStore write-behind (F63)
    App->>App: resolve store (prop-drilled — no context call)
    App->>Dash: createDashboard(store, {seed, isDemo})
    App->>Dash: onMount → dash.boot()
    activate Dash
    Dash->>Bus: emit app:ready — first, before refdata (A195 · replay-buffered A188)
    Dash->>Ref: await loadRefData()
    Ref-->>Dash: brokers / exchange-fees / feeds / state-tax
    Ref->>Bus: emit refdata:loaded
    Dash->>Store: await store.init()
    alt seed (demo or staging)
        Dash->>Store: seedIfEmpty() — parse demo CSV, addTrades
    end
    Dash->>Store: reloadAll() — trades, journal, tradeMeta, savedFilters
    Store-->>Dash: persisted data
    Dash->>Dash: restore setup · set calendar cursor · loaded = true
    Dash->>Bus: emit data:loaded with the trade count
    deactivate Dash
    App->>App: fetch /data/versions.json (badge) · loadFlags()
    App->>App: if isStaging: configureCloudSync({localStore, dash}) — opt-in E2E sync (F63)
    App->>App: needsOnboarding = !isDemo && !isStaging && loaded && allTrades.length == 0
```

## Notes

- **Seeding gate:** `SEEDED = isStaging || isDemo`. The real app (`data-mode="app"`) seeds nothing —
  an empty store is the first-run signal that shows onboarding.
- **Onboarding** appears only when `!isDemo && !isStaging && dash.loaded && !dash.allTrades.length`.
- **Demo never persists:** the in-memory `DemoStore` plus per-write `if (isDemo) return` guards
  (belt-and-suspenders) mean the boot path can seed demo in memory without ever touching disk.
- The event bus is a no-op when nothing is subscribed; `ActivityTerminal` is the usual listener.
- **Workspace-aware open (F59):** `Store.init()`/`open()` targets the *active* workspace's DB — the
  registry + active id live in `Store.local` (localStorage), read pre-paint so the correct
  `blotterbook:<uuid>` (or the legacy `blotterbook` Default) opens before first render.
- **Cloud sync is staging-gated (F58–F63):** only `data-mode="staging"` wraps the store in a
  `CloudStore` and calls `configureCloudSync`; prod/demo never sync. Sync stays paused until the user
  unlocks the in-memory key (F61b), and every push/pull is E2E-encrypted ciphertext.
