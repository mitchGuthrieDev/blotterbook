<p align="center">
  <img src="assets/banner.svg" alt="Blotterbook — private futures journal and cost dashboard" width="100%">
</p>

<p align="center">
  <img alt="Minimal dependencies" src="https://img.shields.io/badge/dependencies-minimal%20%26%20pinned-3fb950?style=flat-square&labelColor=151a21">
  <img alt="Runs in browser" src="https://img.shields.io/badge/compute-browser%20only-d6dde6?style=flat-square&labelColor=151a21">
  <img alt="Local storage" src="https://img.shields.io/badge/storage-IndexedDB%20(local)-6aa0ff?style=flat-square&labelColor=151a21">
  <img alt="Hosting" src="https://img.shields.io/badge/hosting-Cloudflare%20Pages-e3b341?style=flat-square&labelColor=151a21">
  <img alt="Privacy" src="https://img.shields.io/badge/data-never%20leaves%20your%20browser-c98bff?style=flat-square&labelColor=151a21">
</p>

---

**Blotterbook** is a private trading journal and cost dashboard for futures traders. You export
your account balance history from TradingView (or another supported platform), drop the CSV into
Blotterbook, and get a full performance, cost, and tax picture — an equity curve, a trading
calendar, commission and subscription breakdowns, a Section 1256 tax estimate, and a journal for
your notes, tags, and screenshots.

The catch is that there is no catch: **your trade data never leaves your browser.** Everything is
parsed, computed, and stored locally. No accounts, no uploads, no tracking.

## Why Blotterbook

<table>
  <tr>
    <td width="160"><img src="assets/why-private.svg" alt="A browser window holding a padlock — data parsed and stored locally, never uploaded" width="150"></td>
    <td><b>Private by design.</b> All parsing and computation run in your browser; your trades are saved locally in your browser's storage and never sent anywhere. No login, no cookie banner, no tracking.</td>
  </tr>
  <tr>
    <td width="160"><img src="assets/why-cost.svg" alt="A cost waterfall stepping down from gross PnL through commissions, subscriptions and tax to take-home" width="150"></td>
    <td><b>Knows what trading actually costs.</b> Models broker commissions, exchange/clearing/NFA fees, platform + data-feed subscriptions, and a Section 1256 tax estimate — so you see <i>take-home</i>, not just gross PnL.</td>
  </tr>
  <tr>
    <td width="160"><img src="assets/why-picture.svg" alt="A cumulative equity curve with gross and net overlays, gridlines and a day marker" width="150"></td>
    <td><b>The full picture.</b> Cumulative equity curve, a Sunday-first trading calendar of daily PnL, win rate, profit factor, expectancy, drawdown, payoff ratio, streaks, Sharpe/Sortino, and more.</td>
  </tr>
  <tr>
    <td width="160"><img src="assets/why-journal.svg" alt="A trading-calendar month grid with green and red daily PnL cells, note dots and a tag chip" width="150"></td>
    <td><b>A real journal.</b> Per-day and per-trade notes, tags, and screenshots; saved filter views; a tag filter — so you can actually review <i>why</i> a day went the way it did.</td>
  </tr>
  <tr>
    <td width="160"><img src="assets/why-platforms.svg" alt="Several platform CSV exports auto-detected and normalized into one unified trade table" width="150"></td>
    <td><b>Multi-platform import.</b> TradingView is fully verified; Tradovate, Rithmic, Sierra Chart, TradeStation, MotiveWave, Webull, Interactive Brokers, and Schwab/thinkorswim are supported in beta.</td>
  </tr>
  <tr>
    <td width="160"><img src="assets/why-deps.svg" alt="A small content-hashed bundle built from a few pinned dependencies, loading fast" width="150"></td>
    <td><b>Lean and fast.</b> Built with Vite + Svelte on a minimal, pinned, audited dependency set — it ships a small, content-hashed bundle that loads fast.</td>
  </tr>
</table>

## Quick start

1. **Open the app.** From the homepage, click **Launch Blotterbook** — or run it locally:

   ```bash
   npm install      # one-time: install the pinned deps from the lockfile
   npm run dev      # Vite dev server (HMR) — open the printed URL, then /app/app.html
   ```

   (To preview the production build instead: `npm run build` emits `dist/`, then `npm run preview`.
   It must be served over http — the app loads its reference data over the network.)

2. **Set up costs.** In the **Broker & Costs** panel, pick your **Broker**, **Data feed**, and
   **State**, and set your monthly **Platform fee**.

3. **Export your CSV.** In TradingView, export your account balance history (the "List of trades"
   export) as CSV.

4. **Load it.** Click **Load CSV**, pick the file, then **Start Blotterbook**. Your data is saved
   locally and restored automatically next time. Re-uploads merge — only genuinely new trades are
   added, so you can export a wider window each time without creating duplicates.

**Just want to look around?** Click **See Demo** on the homepage for a generated, profitable
two-year sample dataset (nothing is saved). To clear your data later, use **Manage data → Erase all
local data**.

A step-by-step walkthrough and per-platform import guides live in the in-app **How-To** wiki
(`howto.html`).

## How it works

```
Your CSV ─▶ parsed & platform-detected in the browser
         ─▶ saved locally (IndexedDB) — never uploaded
         ─▶ metrics + cost/tax model computed client-side
         ─▶ rendered: cards · equity curve · calendar · cost waterfall · stats
```

The only network calls Blotterbook ever makes are for its *own* reference data (broker/fee/tax
tables) and an optional coarse-region lookup to pre-fill your tax state — never your trades. The
full privacy statement is on the in-app **Legal** page (`legal.html`).

## Pricing

An **Obsidian-style** model: the app is **free for everyone** and stays free. Support is optional,
and the only planned paid feature is cross-device sync.

| Tier | Price | What | Status |
| --- | --- | --- | --- |
| **Blotterbook** | Free | the full app — CSV import, journal, cost/tax model | shipped |
| **Back the project** | $25 one-time *or* $50/year | optional donation that keeps it free & funds features | planned |
| **Synced workspaces** | ~$5/mo | end-to-end-encrypted cross-device sync of trades/notes/tags/filters | planned |

## Documentation

- **[`docs/architecture.md`](docs/architecture.md)** — how Blotterbook works under the hood: data
  flow, the platform adapters, the cost/tax model, the Vite build + Svelte SPA (ADR-001), and
  versioning. Start here to contribute.
- **[`CLAUDE.md`](CLAUDE.md)** — quick operational reference: commands, the file-by-file map, and
  the conventions to follow when changing the code.
- **[`functions/README.md`](functions/README.md)** — the Cloudflare Pages Functions backend
  (admin/Live indicator, and the accounts/payments scaffold).

## Roadmap

Highlights, roughly in priority order (the live version is `roadmap.html`):

- **Trustworthy live rate data** — replace the hand-maintained fee/tax estimates with values pulled
  on a schedule from authoritative sources.
- **Validate & harden the beta adapters** against real exports; widen the futures point-value map.
- **Journal feature parity** — setups, R-multiple & risk tracking, MAE/MFE.
- **Accounts + zero-knowledge cross-device sync** — end-to-end-encrypted, so your data moves
  between devices without us ever seeing it.

## License

**Proprietary — all rights reserved.** See [`LICENSE`](LICENSE). The source is published for
transparency and is viewable, but it is **not** licensed for copying, redistribution, modification,
or commercial/hosted reuse without written permission. Personal use of the hosted app is fine,
subject to the on-site [disclaimers and terms](legal.html).

> **Disclaimer.** Blotterbook is a trading journal and cost/tax estimation tool — **not a broker**,
> and not financial, investment, or tax advice. All figures are estimates; trading involves risk of
> loss. See [`legal.html`](legal.html).
