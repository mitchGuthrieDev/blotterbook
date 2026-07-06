# docs/archive

Point-in-time records whose work is **complete and shipped**. They are kept for historical
rationale — why a decision was made or what an audit found at the time — not as current guidance.
For the live architecture and active decision records, see the top-level [`docs/`](../).

| Doc | What it recorded | Superseded / executed by |
| --- | --- | --- |
| [`backlog-reviews-2026-06-29.md`](backlog-reviews-2026-06-29.md) | Backlog review + design tradeoffs | Spun off A95–A97 (done) |
| [`calculations-audit-2026-06-29.md`](calculations-audit-2026-06-29.md) | Calculation-pipeline correctness audit | A113–A120 (shipped) |
| [`repo-audit-2026-06-30.md`](repo-audit-2026-06-30.md) | R1 repo audit (post shadcn re-platform) | Findings filed / fixed in-flight |
| [`repo-audit-2026-07-01.md`](repo-audit-2026-07-01.md) | R1 repo audit (post-CH16 full audit) | A147–A164 (shipped) |
| [`repo-audit-2026-07-01-pass5.md`](repo-audit-2026-07-01-pass5.md) | R1 repo audit pass 5 (post-#92, behavior-level bugs) | A147–A164 (shipped) |
| [`repo-audit-2026-07-02.md`](repo-audit-2026-07-02.md) | R1 repo audit pass 6 (post dashboard-tabs-v2 batch) | A190–A195 (shipped) |
| [`repo-audit-2026-07-04.md`](repo-audit-2026-07-04.md) | R1 repo audit pass 7 (post intake/provenance/rates batch) | A212–A218 (shipped) |
| [`tagging-review-2026-07-01.md`](tagging-review-2026-07-01.md) | R17 review of what tagging means in Blotterbook | A165–A167 (shipped) |
| [`calc-audit-2026-07-01.md`](calc-audit-2026-07-01.md) | A66 exhaustive calculation-correctness audit | A168–A175 (shipped) |
| [`calc-audit-tradingview-2026-07-04.md`](calc-audit-tradingview-2026-07-04.md) | A219 TradingView cross-export reconciliation audit | Shipped as `reconcileImport()` in `src/lib/core/intake.ts` |
| [`perf-shortlist-a136.md`](perf-shortlist-a136.md) | A136 performance-optimization shortlist | Top recommendations shipped as A223 |
| [`ui-libs-eval-a204.md`](ui-libs-eval-a204.md) | A204 UI/animation library evaluation (anime.js, Kokonut UI, bklit UI) | Decision: skip all three; no follow-on work |
| [`structure-reorg-plan.md`](structure-reorg-plan.md) | `src/` + `static/` layout plan | Executed by A30 + A76 |
| [`build-step-decision.md`](build-step-decision.md) | R19 "adopt a build step?" decision | Superseded by [ADR-001](../adr-001-vite-svelte-spa.md) |
| [`typescript-decision.md`](typescript-decision.md) | Native-TypeScript migration decision | Executed via A30 / A61 |
