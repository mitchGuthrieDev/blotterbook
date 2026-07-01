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
        CMP["core.ts — compute · costModel · rateFor · helpers · event bus"]
        RPT["report.ts — report builder (screen/md/email)"]
        CRV["curveseries.ts — daily gross/net/take series"]
        SMP["sampledata.ts — demo CSV"]
        STR["store.ts — IndexedDB Store"]
        DMO["demostore.ts — in-memory Store"]
        FMT["format.ts — esc · platformLabel · version badge"]
        TYP["types.ts — shared interfaces"]
        ENT["entitlements.ts — storage-tier scaffold (not loaded)"]
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

    STR -. "StoreLike seam · context('bb:store')" .-> APP
    DMO -. "StoreLike seam (demo)" .-> APP
    ENT -. "future CloudStore implements StoreLike" .-> STR
```

## Notes

- **One core, three consumers.** The app drives the full pipeline; the info site pulls only
  `format.ts` (shared version badge + escaping). The core is native TS (A61) and node-tested by the
  standalone suites (`scripts/test-*.mjs`) with **no DOM/framework**.
- **The `Store` seam is the extension point.** The app only ever talks to a `StoreLike` object via
  `context('bb:store')` — real IndexedDB (`store.ts`), in-memory (`demostore.ts`), or a future
  server-backed `CloudStore` (the subscription tier sketched in `entitlements.ts` / `functions/`).
  Swapping the backend changes no screen code.
