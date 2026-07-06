# CI pipeline & drift gate

The ordered `ci.yml` gates that run on every push to `main` and every pull request, ending with the
manifest drift gate that proves the build-time tooling left no committed source stale.

**Source of truth:** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) ·
[`package.json`](../../package.json) (scripts) · [`.node-version`](../../.node-version).

```mermaid
flowchart TD
    TRIG["push to main / pull_request<br/>(Node from .node-version)"] --> S1["npm ci"]
    S1 --> S2["lint — ESLint"]
    S2 --> S3["typecheck — tsc(core)+tsc(functions)+svelte-check"]
    S3 --> S4["format:check — Prettier"]
    S4 --> S5["test:unit — 9 node suites"]
    S5 --> S6["build — build-manifest + vite → dist/"]
    S6 --> S7["size-budget — /app/ bundle ≤ 840 KiB"]
    S7 --> S8["check-deploy — deploy contract + version classification"]
    S8 --> S8B["check-mermaid — every docs/ mermaid block still parses"]
    S8B --> S9["test:e2e — Playwright, boot every surface from dist/"]
    S9 --> S10["re-run scripts/build-manifest.mjs"]
    S10 --> GATE{"git status clean?"}
    GATE -->|"dirty"| FAIL["FAIL — committed manifest.json drifted"]
    GATE -->|"clean"| PASS["pass — safe to merge"]

    style FAIL fill:#3f2937,stroke:#f87171,color:#fecaca
    style PASS fill:#173a2a,stroke:#4ade80,color:#bbf7d0
```

## Notes

- **Any step is a hard gate** — lint, typecheck, format, unit, build, size-budget, deploy-contract,
  the Mermaid-diagram check, and e2e all fail the run on error. The diagram shows the happy path; a
  failure at any node stops it.
- **`check-mermaid`** parses every ```` ```mermaid ```` block under `docs/` (reuses the Playwright
  Chromium install) so a diagram edit that no longer parses fails CI instead of silently rendering as
  an error box on GitHub — see [the architecture-diagrams README](README.md#ci-drift-gate).
- **The drift gate is the finale.** Because `dist/` is gitignored, CI re-runs the deterministic
  `build-manifest.mjs` and asserts `git status` is clean — proving the committed
  `static/data/manifest.json` matches what the tooling produces. If you edit any `static/data/*.json`
  and forget to regenerate the manifest, this fails.
- **`check-deploy`** independently validates the deploy contract (source→URL assumptions) and the
  version-classification rules used by the [two-track bump](versioning-two-track.md).
- Concurrency cancels in-progress PR runs (not `main`); permissions are read-only.
- The **version bump** runs in a *separate* workflow on push to `main` — see
  [versioning-two-track.md](versioning-two-track.md).
