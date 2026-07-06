# Architecture diagrams

Living visual documentation of how Blotterbook fits together. Unlike the dated audits/plans in
[`docs/archive/`](../archive/), these are **kept current** — update the diagram when you change the
code it describes.

For the prose architecture narrative see [`docs/architecture.md`](../architecture.md); the ADRs
([`adr-001`](../adr-001-vite-svelte-spa.md), [`adr-002`](../adr-002-tailwind-shadcn.md)) cover the
build/UI platform decisions. These diagrams are the pictures that go with that text.

## Diagrams

### Runtime / data flow

| Diagram | What it shows |
| --- | --- |
| [`boot-and-lifecycle.md`](boot-and-lifecycle.md) | Startup sequence: `mount(App)` → `loadRefData` → `Store.init` → seed → restore → onboarding gate |
| [`app-shell-and-routing.md`](app-shell-and-routing.md) | `AppShell` + hash router → screens/parts, and the `createDashboard` state → props → callbacks flow |
| [`storage-and-mode-separation.md`](storage-and-mode-separation.md) | How prod/demo/staging select a `Store` at boot and how their IndexedDB / in-memory data is isolated |
| [`csv-import-adapters.md`](csv-import-adapters.md) | CSV `detect` → adapter `parse`/`pairFills` → normalized trade → `Store.addTrades` dedupe |
| [`compute-costmodel-render.md`](compute-costmodel-render.md) | Trades → filters → `compute` (metrics) → `costModel` → curve/report → reactive screens |
| [`core-reuse-map.md`](core-reuse-map.md) | How `src/lib/core/*` is reused verbatim by the app + info site, and the `Store` seam |

### Backend / edge

| Diagram | What it shows |
| --- | --- |
| [`cloudflare-functions.md`](cloudflare-functions.md) | Edge API surface, the staging gate middleware, and the passkey-accounts + Stripe-donations backend |

### Build / deploy / CI

| Diagram | What it shows |
| --- | --- |
| [`build-and-deploy.md`](build-and-deploy.md) | `build-manifest` → Vite multi-page build (+ SSG prerender) → `dist/` → Cloudflare Pages |
| [`repo-layout-url-contract.md`](repo-layout-url-contract.md) | `src/` root + `static/` publicDir → `dist/` URL mapping (the 1:1 deploy contract) |
| [`ci-pipeline.md`](ci-pipeline.md) | Ordered `ci.yml` gates ending in the manifest drift gate |
| [`versioning-two-track.md`](versioning-two-track.md) | Commit-type + changed-path classification → two-track prod/staging version bump |

### Cross-cutting

| Diagram | What it shows |
| --- | --- |
| [`security-trust-boundaries.md`](security-trust-boundaries.md) | Sanitization boundaries + the CSP / demo / staging / admin / local-compute invariants |

## Conventions

- **Format: [Mermaid](https://mermaid.js.org/) fenced in Markdown** (```` ```mermaid ````). GitHub
  renders it inline, it needs no build step, and it diffs as text in git. No binary image files —
  keep the source diffable. (These are docs only, never shipped, so CSP doesn't apply.)
- **One topic per file**, named in kebab-case after the subsystem (`storage-and-mode-separation.md`).
- **Each file carries:** a one-line purpose, a **Source of truth** line linking the code the diagram
  describes (so a reader can verify it hasn't drifted), the diagram, and a short notes/legend
  section for anything the picture can't convey.
- **Link the code, then keep it honest.** When you touch a subsystem with a diagram here, update the
  diagram in the same change. Treat drift like a stale comment.
- **Add new diagrams to the table above** so this stays the index.

## Viewing

- **GitHub / most Markdown viewers:** renders automatically.
- **VS Code:** the *Markdown Preview Mermaid Support* extension (or any Mermaid preview) renders it.
- **Live editing:** paste a diagram block into <https://mermaid.live> to iterate on layout.

## CI drift gate

Every ```` ```mermaid ```` block under `docs/` is parsed by Mermaid's own parser in CI
([`scripts/check-mermaid.mjs`](../../scripts/check-mermaid.mjs), wired into
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)), so a diagram that no longer parses
**fails the build** instead of silently rendering as an error box on GitHub. Run it locally before
pushing:

```bash
npm run check-mermaid
```

It reuses the Playwright chromium the e2e job already installs (Mermaid needs a DOM), so the only
added dependency is the lightweight `mermaid` library itself.
