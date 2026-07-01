# App shell & routing

The redesigned sidebar shell + hash router, and how the `createDashboard` state factory feeds every
screen via props while screens push mutations back through callbacks.

**Source of truth:** [`src/app/App.svelte`](../../src/app/App.svelte) ·
[`src/lib/components/shell/AppShell.svelte`](../../src/lib/components/shell/AppShell.svelte) ·
[`src/lib/components/shell/SidebarNav.svelte`](../../src/lib/components/shell/SidebarNav.svelte) ·
[`src/app/lib/nav.ts`](../../src/app/lib/nav.ts) ·
[`src/app/lib/dashboard.svelte.ts`](../../src/app/lib/dashboard.svelte.ts).

```mermaid
flowchart TD
    subgraph SHELL["AppShell.svelte — rail + content column"]
        NAV["SidebarNav.svelte<br/>data-driven sections (nav.ts)"]
        TOP["topbar: toggle · page title · actions"]
    end

    NAV -->|"navigate(key)"| HASH["location.hash<br/>fromHash() → active $state<br/>+ hashchange $effect"]
    HASH --> ROUTER{"active route"}

    ROUTER -->|dashboard| D["Dashboard"]
    ROUTER -->|calendar| C["Calendar"]
    ROUTER -->|analytics| A["Analytics"]
    ROUTER -->|blotter| B["Blotter"]
    ROUTER -->|csv| CSV["CsvLibrary"]
    ROUTER -->|trades| TE["TradeEditor"]
    ROUTER -->|reports| R["Reports"]
    ROUTER -.->|invalid → default| D

    STORECTX["context('bb:store')<br/>Store / DemoStore"] --> DASHSTATE
    DASHSTATE["createDashboard(store)<br/>$state + $derived:<br/>filters · metricsAll/Active · cost ·<br/>journal · tradeMeta · savedFilters"]

    DASHSTATE -->|"data props"| D
    DASHSTATE --> C
    DASHSTATE --> A
    DASHSTATE --> B
    DASHSTATE --> CSV
    DASHSTATE --> TE
    DASHSTATE --> R
    D -.->|"mutation callbacks"| DASHSTATE
    TE -.-> DASHSTATE
    CSV -.-> DASHSTATE
    C -.-> DASHSTATE
    R -.-> DASHSTATE

    subgraph PARTS["parts/ — cross-screen pieces"]
        ONB["Onboarding"]
        CS["CostSetup"]
        SB["StatusBanner"]
        AT["ActivityTerminal"]
        DEF["Definitions"]
    end
    DASHSTATE --- PARTS
```

## Route map

| Hash | Screen | Group |
| --- | --- | --- |
| `dashboard` | `Dashboard.svelte` | main |
| `calendar` | `Calendar.svelte` | main |
| `analytics` | `Analytics.svelte` | main |
| `blotter` | `Blotter.svelte` | main |
| `csv` | `CsvLibrary.svelte` | data management |
| `trades` | `TradeEditor.svelte` | data management |
| `reports` | `Reports.svelte` | data management |

Missing/invalid hash defaults to `dashboard`. Hand-rolled hash router — **no SvelteKit** (ADR-001).

## Notes

- **Unidirectional data flow:** screens are prop-driven and never fetch/persist directly — they read
  derived state and call mutation callbacks on the dashboard factory, which owns the `Store` seam.
- Every dashboard mutation is `isDemo`-guarded so demo can't persist.
