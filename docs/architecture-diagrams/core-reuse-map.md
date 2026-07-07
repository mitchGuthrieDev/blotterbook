# Pure-logic core reuse map

The framework-agnostic `src/lib/core/` is reused verbatim by the journal app and (partly) the info
site, and the `Store` interface is the seam a future `CloudStore` drops into.

**Source of truth:** [`src/lib/core/`](../../src/lib/core/) ·
[`src/lib/core/store.ts`](../../src/lib/core/store.ts) (the seam) ·
[`src/lib/core/types.ts`](../../src/lib/core/types.ts) (`StoreLike`).

```mermaid
flowchart TD
    subgraph CORE["src/lib/core/ — pure-logic core (framework-agnostic TS, node-tested)"]
        ADP["adapters.ts — CSV detect/parse/pairFills"]
        XLS["xlsx.ts — dependency-free ATAS X .xlsx reader (F52)"]
        INT["intake.ts — file/text intake gates + reconcileImport (A177/A219)"]
        CMP["core.ts — compute · costModel · rateFor · helpers · event bus"]
        RPT["report.ts — report builder (screen/md/email)"]
        CRV["curveseries.ts — daily gross/net/take series"]
        SMP["sampledata.ts — demo CSV"]
        STR["store.ts — IndexedDB Store"]
        DMO["demostore.ts — in-memory Store"]
        FMT["format.ts — esc · platformLabel · version badge"]
        TYP["types.ts — shared interfaces"]
        ENT["entitlements.ts — storage-tier resolver (WIRED /api/me, F60)"]
        CRY["crypto.ts — E2E envelope-encryption core (F61a)"]
        CSY["cloudsync-core.ts — pure push/pull/merge engine (F63, A314)"]
    end

    subgraph APP["src/app/ — journal SPA (app + demo + staging)"]
        A1["screens/*"]
        A2["parts/*"]
        A3["dashboard.svelte.ts"]
    end

    subgraph SITE["src/site/ — marketing/info SSG"]
        S1["components/* (Home, Changelog, …)"]
    end

    APP ==>|"imports verbatim"| CORE
    SITE -->|"format only (badge, esc, platformLabel)"| FMT

    STR -. "StoreLike seam · prop-drilled from App.svelte" .-> APP
    DMO -. "StoreLike seam (demo)" .-> APP
    ENT -. "storeFor(tier) — ALWAYS returns the base local Store (both tiers)" .-> STR
    CLS["CloudStore (src/app/lib/cloudstore.ts, F63)<br/>write-behind StoreLike wrapper — wraps every non-demo<br/>Store unconditionally at the App boundary (App.svelte:94-95);<br/>cloud-tier opt-in gated at RUNTIME by the sync controller (A256)"] -. "wraps Store, also a StoreLike" .-> STR
    CRY -. "encrypts records before egress" .-> CLS
    CSY -. "pure engine cloudsync.svelte.ts drives" .-> CLS
```

## Notes

- **One core, three consumers.** The app drives the full pipeline; the info site pulls only
  `format.ts` (shared version badge + escaping). The core is native TS (A61) and node-tested by the
  standalone suites (`scripts/test-*.mjs`) with **no DOM/framework**.
- **The `Store` seam is the extension point.** The app only ever talks to a `StoreLike` object that
  `App.svelte` resolves and prop-drills (into `createDashboard`/`createDashTabs` and down through the
  screens/parts — no `context()` call) — real IndexedDB (`store.ts`), in-memory (`demostore.ts`), or the
  `CloudStore` write-behind wrapper (`src/app/lib/cloudstore.ts`, F63). Swapping the backend changes no
  screen code.
- **`entitlements.ts` is wired (F60) but does NOT select `CloudStore`.** `current()` calls `/api/me`
  to resolve the tier; `storeFor(tier)` always returns the **base** local `Store` for both tiers —
  it deliberately never reaches for the app-level wrapper (`entitlements.ts:56-58`). The wrap happens
  one layer up, at the App boundary: `App.svelte:94-95` calls `cloudsync.svelte.ts`'s `wrapStore` on
  every non-demo store unconditionally, and the `cloud`-tier opt-in is gated at **runtime** inside the
  sync controller (A256) — not staging-gated, and not selected by `entitlements.ts`.
- **`crypto.ts` (F61a)** is the pure E2E envelope-encryption core (AES-KW/GCM/HKDF/HMAC + Argon2id via
  `hash-wasm`), node-tested by `scripts/test-crypto.mjs`; **`cloudsync-core.ts` (F63, relocated here
  from `src/app/lib` in A314 for strict `tsc` coverage)** is the pure push/pull/merge engine that
  `cloudsync.svelte.ts` drives. The `CloudStore` uses `crypto.ts` to encrypt every record before it
  leaves the browser.
