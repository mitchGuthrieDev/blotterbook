---
name: repo-audit
description: Run Blotterbook's recurring full-repo audit (backlog item R1) — a READ-ONLY architecture / code-quality / duplication / security pass over the current Svelte 5 + TS codebase, delivered as a written, prioritized report with every finding filed as a new backlog item. Use when asked to "run the repo audit", "do an R1", "do a fresh audit", or to periodically review the codebase before a release.
---

# Blotterbook repo audit (R1)

R1 in `static/data/backlog.json` is the canonical, always-open recurring driver. **Read that item's
`prompt` first** — it is the source of truth; this skill is the operating procedure around it.

## Hard rules

- **READ-ONLY.** Make NO code edits. Each discrepancy becomes a filed backlog item, not an inline fix.
- **R1 is recurring** — NEVER set it to `done`, set `completedDate`, or strip its prompt. Each run ships
  its output as NEW backlog items; R1 stays open for the next pass.
- Respect every **hard constraint in `CLAUDE.md`**, above all the product moat: **compute is local — no
  trade data ever leaves the browser.** Flag anything that risks egress as P1.

## Procedure

1. **Orient** to the current architecture (don't assume an older layout): ADR-001 Vite multi-page build →
   `dist/` (A26), Cloudflare Pages + `/functions/*` (TS, A78), source tree `src/{lib,app,site}` (A30),
   one Svelte 5 SPA on all app surfaces (A33), site SSG (A69). Skim `CLAUDE.md` +
   `docs/architecture.md`.
2. **Audit four dimensions** (consider fanning out a sub-agent per dimension for breadth):
   - **Architecture & duplication** — is the pure-logic core (`src/lib/*`) single-sourced and reused
     verbatim (A29)? Is the `Store` seam (`src/lib/core/store.ts`, prop-drilled from `App.svelte` —
     there is no `context()` seam) the only persistence path (A4)? Any re-implementations of
     `compute`/`costModel`/`adapters`/formatters?
   - **Svelte 5 / TS quality** — runes-only (no `export let`/`$:`/`createEventDispatcher`/store
     writables); `src/` is `any`-free; `npm run typecheck` (tsc + svelte-check) clean.
   - **Security posture** — no trade-data egress; CSP `style-src 'self'` / no inline styles (S18/A55);
     no `innerHTML`/`{@html}`; functions verify Access JWT + Stripe signature + admin token; deps
     pinned + lockfile (A28).
   - **Correctness / build / CI** — calc paths, test coverage gaps, the drift gate, `bump-version` path
     classification.
3. **Adversarially verify** each finding against the source before filing — drop claims that don't hold.
4. **Deliver** a written, prioritized report at `docs/repo-audit-<YYYY-MM-DD>.md` (P1/P2/P3 with
   `file:line`), mirroring the house style of the existing `docs/repo-audit-*.md`.
5. **File follow-ups** into `static/data/backlog.json` in the same item shape (next free `A###` id,
   `status: "open"`, a self-contained `prompt`, `doneNote: null`). Then verify the manifest is unchanged
   (`node scripts/build-manifest.mjs` — `backlog.json` is not a cache-busted asset, so it should not
   move) and run `npm run format` on the touched JSON/MD.
6. Commit with a `docs:` conventional title; open a PR only if asked.

**Done when:** the written audit exists and new follow-ups are filed. Leave R1 open.
