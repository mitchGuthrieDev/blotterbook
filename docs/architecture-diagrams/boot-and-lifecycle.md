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
    participant Acct as account.svelte.ts

    M->>App: mount(App, {target: #app})
    Note over App: side-effect import format.ts + tailwind.css
    App->>App: PAGE_MODE = body.dataset.mode
    App->>App: localStore = isDemo ? DemoStore : Entitlements.storeFor('local')
    App->>App: store = isDemo ? localStore : wrapStore(localStore) — CloudStore write-behind (F63)<br/>unconditional for every non-demo surface (App.svelte:94-95)
    App->>App: resolve store (prop-drilled — no context call)

    App->>App: gateArmed = !isDemo && accountGateEnabled() (F56, flags.ts)
    alt gateArmed - app + staging, demo is never gated
        App->>Acct: void refreshSession() — GET /api/me (App.svelte ~930)
        opt "?recover= param present"
            App->>Acct: completeRecovery(token) — pre-gate re-enrollment (A300)
        end
        Note over App: gateBlocking = gateArmed && !account.user<br/>renders LaunchGate instead of appBody (App.svelte ~1089-1096)<br/>until account.user resolves — login/register unmounts the gate
    end

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
    App->>App: if !isDemo: configureCloudSync({localStore, dash}) — opt-in E2E sync (F63, App.svelte:948)
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
- **Cloud sync is live on prod + staging (F58–F63), opt-in and `cloud`-tier only, never demo:** every
  non-demo surface wraps the store in a `CloudStore` and calls `configureCloudSync` unconditionally
  (`!isDemo`); the tier/opt-in gate is a runtime check inside the sync controller (A256), not a mode
  branch. Sync stays paused until a `cloud`-tier user opts a workspace in and unlocks the in-memory
  key (F61b), and every push/pull is E2E-encrypted ciphertext.
- **F56 login gate (2026-07-06 GA):** `gateArmed = !isDemo && accountGateEnabled()` — armed on app +
  staging, demo excluded by construction. When armed, `App.svelte` probes `/api/me` at `onMount` via
  `refreshSession()` (never throws) and, ahead of that, resolves a `?recover=` token pre-gate so a
  lost-passkey recovery link still works while `LaunchGate` is blocking. The whole shell renders
  `LaunchGate` instead of the normal body until `account.user` resolves; login/register flips
  `account.user` and the gate unmounts into the usual onboarding/dashboard flow.
