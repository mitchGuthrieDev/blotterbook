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
        SHDR["sidebarHeader snippet<br/>WorkspaceSwitcher (app/staging only;<br/>undefined on demo → renders nothing)"]
        NAV["SidebarNav.svelte<br/>data-driven sections (nav.ts)"]
        TOP["topbar: toggle · page title · actions"]
    end

    GATE{"gateBlocking ?<br/>F56: !isDemo && accountGateEnabled() && !account.user"}
    GATE -->|"yes · app+staging"| LG["LaunchGate<br/>renders in place of the whole shell body<br/>until account.user resolves"]
    GATE -->|"no · or demo (never gated)"| NAV

    NAV -->|"navigate(key)"| HASH["location.hash<br/>fromHash() → active $state<br/>+ hashchange $effect"]
    HASH --> ROUTER{"active route"}

    ROUTER -->|dashboard| D["Dashboard"]
    ROUTER -->|calendar| C["Calendar"]
    ROUTER -->|analytics| A["Analytics"]
    ROUTER -->|blotter| B["Blotter"]
    ROUTER -->|csv| CSV["CsvLibrary"]
    ROUTER -->|trades| TE["TradeEditor"]
    ROUTER -->|reports| R["Reports"]
    ROUTER -->|account| ACC["Account (all surfaces;<br/>demo renders it read-only via isDemo prop)"]
    ROUTER -.->|invalid → default| D

    STORECTX["App.svelte resolves Store / DemoStore<br/>(prop-drilled — no context call)"] --> DASHSTATE
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

    subgraph PARTS["parts/ — cross-screen pieces (22 files + LaunchGate, A src/app/parts/)"]
        direction TB
        subgraph PARTSCORE["dashboard / cross-screen"]
            ONB["Onboarding"]
            CS["CostSetup"]
            SB["StatusBanner"]
            AT["ActivityTerminal"]
            DT["DashTabs"]
            DS["DetectionStatus"]
            FB["FeedbackDialog"]
            MC["ModuleCarousel"]
            PC["PaginationControls"]
            SL["ScreenshotLightbox"]
            SC["SegmentedControl"]
            TI["TagInput"]
            IT["InfoTip"]
            SS["SymbolSelect"]
            DPP["DatePickerPopover"]
            ECP["EditableCellPopover"]
            BSP["BootSplash"]
            SCR["StatCardRow"]
        end
        subgraph PARTSSYNC["synced-workspaces UI (opt-in, cloud-tier)"]
            CSS["CloudSyncSetup"]
            UM["UnlockModal"]
            SSPL["SyncStatusPill"]
            WSW["WorkspaceSwitcher"]
        end
    end
    DASHSTATE --- PARTS
    WSW -.-> SHDR
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
| `account` | `Account.svelte` | Account (ships on all surfaces — demo renders it read-only, F53/CH16) |

Missing/invalid hash defaults to `dashboard`. Hand-rolled hash router — **no SvelteKit** (ADR-001).

## Notes

- **Unidirectional data flow:** screens are prop-driven and never fetch/persist directly — they read
  derived state and call mutation callbacks on the dashboard factory, which owns the `Store` seam.
- Every dashboard mutation is `isDemo`-guarded so demo can't persist.
- **`account` ships on every surface (F53/CH16 — promoted, not future).** `App.svelte:114` appends the
  Account nav section unconditionally and lazy-loads `Account.svelte` on every surface; demo passes
  `isDemo` down so the screen renders read-only and issues no account network traffic
  (`if (isDemo) return;` guards, `Account.svelte`). The `promote-staging` (CH16) pass that used to gate
  this already ran — there is no remaining gate to remove.
- **The F56 login gate (`LaunchGate`) is separate from the Account *screen*** — it's a shell-level
  hold (armed on app + staging, never demo) that blocks the whole router behind a sign-in ceremony
  before any screen renders; once `account.user` resolves the gate unmounts and routing proceeds
  normally, including to `account` itself.
- **`WorkspaceSwitcher`** renders into `AppShell`'s `sidebarHeader` snippet slot on app/staging only —
  `App.svelte` passes `sidebarHeader={isDemo ? undefined : sidebarHeader}`, so the slot (and the
  single-workspace switcher UI) is absent on demo by construction.
