# SAST for CI — evaluation (A112)

**Date:** 2026-07-05 · **Backlog item:** A112 (SECURITY, P3) · **Status:** discussion/evaluation — adoption spun off below

## Recommendation up front

- **Adopt: Semgrep Community Edition** — in a new, separate `security.yml` workflow. Its custom-rule
  engine is the one tool here that can mechanically enforce Blotterbook's own invariants: **no
  trade-data egress** (no `fetch`/`XMLHttpRequest`/`sendBeacon`/`WebSocket` to non-`'self'` origins in
  `src/`), no `indexedDB` outside `store.ts`, no literal `style=""`. That's outsized value no generic
  scanner offers.
- **Adopt: dependency scanning via `osv-scanner`** (with `npm audit` as the zero-dep fallback) — the
  real gap today. A28 pinned the lockfile, but **nothing in CI scans it**: a known-vulnerable pin
  stays green forever. Weekly cron + PR-diff scan closes that.
- **Skip: CodeQL.** This repo is **private**, and CodeQL on private repos is not free: it requires
  GitHub Code Security (GHAS), **$30/active-committer/month**, and only for orgs on Team/Enterprise —
  not available at all on a personal private repo. (Free CodeQL is public-repos-only.)
- **Skip: Socket.dev.** Private-repo support is on paid plans (Team, ~$25/dev/mo); the free tier is
  aimed at open source. Its behavioral supply-chain analysis is also least valuable here: only 2
  runtime deps (`@lucide/svelte`, `phosphor-svelte`), everything exact-pinned.
- **Skip (for now): extra ESLint security plugins.** `eslint-plugin-security` is notoriously noisy on
  TS (`object-injection` FPs) for little gain on this codebase. `eslint-plugin-svelte` is worth a
  *separate small item* — not for SAST but because `.svelte` files currently get svelte-check only,
  no lint; its `no-at-html-tags` rule is a genuine XSS guard.

## Comparison

| Tool | Cost on this (private) repo | Setup | Signal | CI runtime | Verdict |
|---|---|---|---|---|---|
| GitHub CodeQL | **Not free** — GHAS Code Security, $30/committer/mo, org Team/Enterprise only | Low (starter workflow) | High (interprocedural, low FP) | 3–10 min | **Skip** — pricing gates it out |
| Semgrep CE | Free (LGPL-2.1 engine; registry rules Semgrep Rules License v1.0 — internal use is fine, no login) | Medium — pick rulesets + write ~4 custom rules | Community rulesets: moderate, some noise. **Custom repo rules: very high** | ~1–2 min at this repo size | **Adopt** |
| osv-scanner | Free (Apache-2.0, Google; OSV.dev DB, no account) | Low — official reusable workflow, scans `package-lock.json` | High for SCA; broader/cleaner DB than npm's, PR-diff mode reports only *newly introduced* vulns | <30 s | **Adopt** |
| `npm audit` | Free, zero new tooling | Trivial (one CI line) | Same class as osv-scanner, noisier severity, no diff mode | <10 s | Fallback if we want zero new tools |
| Socket.dev | Free tier is OSS-oriented; private repos ⇒ Team ~$25/dev/mo | Low (GitHub App) | High for malicious-package behavior; low relevance at 2 pinned runtime deps | n/a (App) | **Skip** |
| eslint-plugin-security | Free | Low | Low on TS — high FP burden (object-injection etc.) | ~0 (rides `npm run lint`) | **Skip** |
| eslint-plugin-svelte | Free | Low–medium (wire `.svelte` into flat config) | Good Svelte-footgun + `{@html}` XSS coverage; not really SAST | ~0 | Separate item (below) |

## Fit with the existing gates

Current CI (`.github/workflows/ci.yml`) is lint → typecheck → format → unit → build → size-budget →
deploy-contract → e2e → drift. Two properties to preserve: the run is fast and every step is a hard
gate. So: **security scans go in a separate workflow**, not new `ci.yml` steps — they don't gate the
build artifact, a registry-ruleset update shouldn't block an unrelated PR the way a format check
does, and a weekly cron (deps go bad *without* commits) doesn't fit a push-triggered pipeline.
A28-wise, neither tool touches `package.json`: Semgrep runs from its pinned official container,
osv-scanner via its pinned reusable action. One caveat: uploading SARIF to GitHub's code-scanning UI
**also requires GHAS on private repos** — so both tools report via job logs + exit codes, not the
Security tab.

## Wiring plan

`.github/workflows/security.yml`, `permissions: contents: read`, triggers `pull_request` + weekly cron:

```yaml
jobs:
  semgrep:
    runs-on: ubuntu-latest
    container: semgrep/semgrep@sha256:<pin>          # A28: pinned by digest
    steps:
      - uses: actions/checkout@v5
      # Custom repo rules (.semgrep/) are BLOCKING; registry rules report-only at first.
      - run: semgrep scan --config .semgrep/ --error --severity ERROR src/ functions/
      - run: semgrep scan --config p/typescript --config p/security-audit src/ functions/ || true
  deps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: google/osv-scanner-action/...@<pinned-sha>   # scans package-lock.json; fails on findings
```

**Fail vs report:** custom Semgrep rules (egress, `indexedDB`, `style=`) — **fail**; they encode hard
invariants and should have ~zero FPs by construction. Registry rulesets — **report-only** for a few
weeks, promote to fail once the noise floor is known. osv-scanner — **fail** on the PR-diff scan
(new vulns introduced by the PR) and on the weekly full scan at high+ severity, with an
`osv-scanner.toml` for documented accepted-risk IDs. Total added CI time ≈ 2 min, parallel to (not
inside) the main pipeline.

Custom rules to write first (`.semgrep/`): (1) any `fetch(`/`new WebSocket(`/`navigator.sendBeacon(`/
`XMLHttpRequest` in `src/` whose URL isn't a relative-path literal; (2) `indexedDB` outside
`src/lib/core/store.ts`; (3) `style="` in `.svelte`/`.html` under `src/` (CSP `style-src 'self'`);
(4) `localStorage`/`sessionStorage` writes outside the store seam. These are belt-and-braces with the
runtime CSP (`connect-src 'self'` in `static/_headers`) — the scanner catches the mistake at PR time,
the CSP at runtime.

## Proposed backlog items

- **SEC-1 (P2, small):** "Add `.github/workflows/security.yml` with Semgrep CE: custom `.semgrep/`
  rules for the no-egress invariant (non-relative `fetch`/WebSocket/sendBeacon/XHR in `src/`), direct
  `indexedDB` outside `store.ts`, and literal `style=` — blocking; `p/typescript` + `p/security-audit`
  report-only. Pin the container by digest (A28). Done when: a seeded egress violation fails the PR."
- **SEC-2 (P2, small):** "Add dependency scanning to `security.yml`: osv-scanner (pinned action)
  against `package-lock.json`, PR-diff mode blocking + weekly-cron full scan; `osv-scanner.toml` for
  accepted-risk IDs. Done when: a known-vulnerable pin fails the scheduled run."
- **SEC-3 (P3, small):** "Wire `eslint-plugin-svelte` (flat config `recommended`) so `.svelte` files
  are linted, keeping `no-at-html-tags` as error; keep the ruleset minimal per A79. Done when:
  `npm run lint` covers `.svelte` and CI stays green."
- **SEC-4 (P3, tiny):** "Revisit CodeQL if the repo ever goes public (free tier) or lands in a
  GHAS-licensed org — re-evaluate against the Semgrep setup then."
