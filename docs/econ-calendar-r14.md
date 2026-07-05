# R14 — Economic-event data on the Calendar module (scoping)

**Date:** 2026-07-05 · **Backlog item:** R14 (P3, medium) · **Status:** written scoping — no code

## Recommendation

**Build it, small.** Ship a curated, US-government-sourced event dataset as a static ref-data file
(`static/data/econ-events.json`, manifest-hashed like the other `/data/*` files), render events as a
compact impact tick + tooltip inside the existing Calendar day cells plus a list in the day-detail
rail, behind a user toggle persisted via `Store.local`. All candidate sources are public-domain US
government schedules **published in advance** — no scraping drama, no licensing exposure, and the
5-year backfill is a one-time data-entry/script task. Estimated effort: **3–5 dev-days** end to end.
Third-party econ-calendar APIs (ForexFactory, Investing.com, FXStreet) are **rejected**: their terms
prohibit redistribution/embedding, and shipping their data inside our static JSON would be exactly
that.

## Event-set proposal (v1)

High-impact, futures-relevant, government-published events only. Counts drive the payload estimate.

| # | Event | Why futures-relevant | ~Occurrences/yr |
| - | ----- | -------------------- | --------------- |
| 1 | FOMC rate decision (+ press conf.) | The single biggest ES/NQ/ZN/GC vol event | 8 |
| 2 | FOMC minutes release | Recurring 2pm ET vol spike | 8 |
| 3 | CPI (BLS) | Rates/inflation repricing across all roots | 12 |
| 4 | Employment Situation / NFP (BLS) | First-Friday index/rates mover | 12 |
| 5 | PPI (BLS) | Secondary inflation print | 12 |
| 6 | GDP — advance/second/third (BEA) | Quarterly macro print | 12 |
| 7 | PCE price index (BEA, Personal Income & Outlays) | The Fed's preferred gauge | 12 |
| 8 | Retail sales (Census) | Consumer-demand index mover | 12 |
| 9 | EIA Weekly Petroleum Status (crude stocks) | The CL/RB/HO weekly event (Wed 10:30 ET) | 52 |
| 10 | EIA Weekly Natural Gas Storage | The NG weekly event (Thu 10:30 ET) | 52 |

≈ **192 events/yr × 5 back-years + 1 forward year ≈ ~1,150 rows.** Deliberately out of v1: ISM PMI
and UMich sentiment (private publishers — licensing unclear), quad-witching/contract-roll dates
(derivable, different feature), and non-US events.

## Sourcing table

| Source | Events | License | Schedule known in advance? |
| ------ | ------ | ------- | -------------------------- |
| [federalreserve.gov FOMC calendars](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm) | FOMC decisions + minutes | US gov · public domain | Yes — year+ ahead; historical pages back past 2020 |
| [bls.gov/schedule](https://www.bls.gov/schedule/) ([CPI](https://www.bls.gov/schedule/news_release/cpi.htm), [Employment Situation](https://www.bls.gov/schedule/news_release/empsit.htm), PPI) | CPI, NFP, PPI | US gov · public domain | Yes — annual advance schedule per release |
| [bea.gov/news/schedule](https://www.bea.gov/news/schedule) | GDP, PCE | US gov · public domain | Yes — annual advance schedule |
| census.gov economic-indicator calendar | Retail sales | US gov · public domain | Yes — annual advance schedule |
| [eia.gov WPSR schedule](https://www.eia.gov/petroleum/supply/weekly/schedule.php) + NG storage schedule | Crude / NG inventories | US gov · public domain | Yes — Wed/Thu 10:30 ET, holiday shifts published |
| ForexFactory / Investing.com / FXStreet APIs | (aggregated) | **Rejected** — redistribution prohibited by ToS | n/a |

Caveat: government shutdowns occasionally reschedule releases after the fact (BLS republished
revised 2025/2026 dates). The dataset should record **actual** dates for the past, scheduled dates
for the future — which the annual refresh corrects.

## Data design

`static/data/econ-events.json` — fits the existing ref-data pattern (schemaVersion, fetched at
runtime, cache-busted via `manifest.json`; regenerating requires `node scripts/build-manifest.mjs`).

```jsonc
{
  "schemaVersion": 1,
  "updated": "2026-07-05",
  "range": { "from": "2021-01-01", "to": "2027-12-31" },
  "types": {
    "fomc":  { "label": "FOMC rate decision", "impact": "high",   "et": "14:00", "src": "federalreserve.gov" },
    "cpi":   { "label": "CPI (BLS)",          "impact": "high",   "et": "08:30", "src": "bls.gov" },
    "eiaCl": { "label": "EIA crude stocks",   "impact": "medium", "et": "10:30", "src": "eia.gov" }
    // …one entry per event type
  },
  "events": [ { "d": "2026-07-29", "t": "fomc" }, { "d": "2026-07-14", "t": "cpi", "et": "08:30" } ]
}
```

Rows are two short fields (per-row `et` only when it deviates from the type default). **Size:**
~1,150 rows × ~30 B ≈ 35–50 KB raw, **~8–15 KB gzipped** — negligible next to the existing `/data`
files, and it should be **lazy-fetched on first toggle-on** (not in the `loadRefData()` boot path)
so users who never enable it pay nothing. Types go in `src/lib/core/types.ts` (boundary-typed JSON,
A162); a pure `eventsForMonth(year, month)` helper belongs in the core so it's node-testable.

## Render + toggle UX

The month-grid cell (`src/app/screens/Calendar.svelte`) is already dense: day number + note dot
(top-left), target-hit check (top-right), P&L (bottom-right), trades/win% (sm+). Events must not
compete with P&L color. Proposal:

- **Cell marker:** a single small diamond/tick cluster on the bottom-LEFT (the only free corner) —
  `chart-4` (amber = warning, per the token contract) for high-impact, `text-muted-foreground` for
  medium; max 2 marks + a `+n`. No new colors, no text, utilities only (CSP-safe).
- **Tooltip:** merge event labels into the existing cell `title` (which already carries day tags).
- **Day-detail rail:** an "Economic events" mini-list (time ET · label · impact badge) above the
  Trades list — this is where the detail lives; the cell mark is just a cue.
- **Year heatmap:** no marks (10px cells) — tooltip only, or skip in v1.
- **Dashboard `cal` module:** skip in v1 (it's the "lite" calendar); revisit after the screen ships.
- **Toggle:** a labeled `Switch` in the Calendar toolbar ("Econ events"), default **off**, persisted
  as `Store.local` key `bb.cal.econEvents`. Demo-safe by construction: demo resolves to
  `DemoStore.local` (in-memory), so toggling in demo persists nothing. No `isDemo` guard needed,
  but keep the e2e "no IndexedDB/localStorage on demo" assertion green.

## Maintenance plan

- **Annual refresh** (each Dec, when Fed/BLS/BEA/EIA publish next-year schedules): update
  `econ-events.json`, correct any rescheduled past dates, run `build-manifest.mjs`, commit. ~1 hr/yr.
- Optionally script it: `scripts/build-econ-events.mjs` fetching the ~6 schedule pages, run
  manually and committed (same posture as the other generated-but-committed data). If it ever moves
  onto the roadmap's scheduled Cron Worker, guardrail **A15** applies — 6 sources is far under the
  50-subrequest free-tier cap.
- The weekly EIA events are generable by rule (Wed/Thu 10:30 ET + published holiday shifts), so the
  script can synthesize them rather than scrape 104 rows/yr.

## Effort estimate

| Work | Estimate |
| ---- | -------- |
| Dataset backfill (5 yr, 10 types) + build script + types + manifest | 1–2 days |
| Core `eventsForMonth` helper + node test (`scripts/test-*`) | 0.5 day |
| Calendar cell marker + tooltip + day-rail list + toolbar toggle + lazy fetch | 1–1.5 days |
| e2e (toggle renders/persists; demo stays non-persisting) + polish | 0.5–1 day |
| **Total** | **3–5 dev-days** ("medium" — matches the backlog sizing) |

## Open questions

1. **Timezone:** events are ET; trade days are rendered in the user's local dates. Pin event dates
   to the ET calendar date (recommended — matches how traders talk about "CPI day"), or convert?
2. **Default state:** off (proposed) vs. on-with-high-impact-only for first-run delight?
3. **Impact filter:** is the toggle binary, or a High/All two-step (weekly EIA rows make Wed/Thu
   noisy for index traders)?
4. **Scheduled vs. actual** historical dates — backfill from the revised (actual) schedules only?
5. Do we want ISM/UMich enough to chase permission, or is the gov-only set sufficient? (Proposed:
   gov-only.)
6. Should analytics eventually correlate P&L with event days (e.g. "your FOMC-day expectancy")?
   Out of scope here, but the dataset design should not preclude it — it doesn't.

## Proposed backlog items

- **R14a** — Build `static/data/econ-events.json` (5-yr backfill + forward year) + generator script
  + `types.ts` shapes + manifest wiring. *(effort: small/medium)*
- **R14b** — Calendar screen: event markers + day-detail event list + persisted toolbar toggle +
  lazy fetch; e2e coverage incl. demo non-persistence. *(effort: small/medium; depends R14a)*
- **R14c** — Annual econ-schedule refresh ritual: December checklist entry (or extend the future
  rate-data Cron Worker under the A15 subrequest cap). *(effort: ongoing)*
- **R14d (stretch)** — Event-day performance analytics (expectancy on FOMC/CPI/NFP days) once R14a/b
  land. *(effort: medium; deferred)*
