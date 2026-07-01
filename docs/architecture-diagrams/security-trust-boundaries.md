# Security model & trust boundaries

Where untrusted input is sanitized, and the invariants that keep the local-only trust model intact:
CSP, demo non-persistence, the staging fail-closed gate, and admin gating.

**Source of truth:** [`src/lib/core/store.ts`](../../src/lib/core/store.ts) (`importAll`, `SHOT_RE`,
`validShot`) · [`src/lib/core/adapters.ts`](../../src/lib/core/adapters.ts) (`rootSym`) ·
[`static/_headers`](../../static/_headers) (CSP) · [`functions/_middleware.ts`](../../functions/_middleware.ts).

```mermaid
flowchart TD
    subgraph UNTRUSTED["untrusted input boundaries"]
        CSVIN["CSV import"]
        BACKUP["backup restore (importAll)"]
        SHOTS["pasted / restored screenshots"]
    end

    CSVIN -->|"rootSym() charset sanitize"| STORE
    BACKUP -->|"validDate · cleanSym · cleanTags ·<br/>cleanShots · allow-list meta keys (S17/S20)"| STORE
    SHOTS -->|"SHOT_RE data-URI allow-list (S15/S18)<br/>rejects javascript: / data:text / SVG"| STORE

    STORE[("IndexedDB — via Store interface only")] --> RENDER["Svelte render<br/>utilities / styleProps · never a style= attr"]

    subgraph INVARIANTS["enforced invariants"]
        CSP["CSP style-src 'self' (_headers)<br/>no inline style= — CSSOM for dynamic styles"]
        DEMO["demo: DemoStore + isDemo write guards<br/>→ nothing persists (e2e-asserted)"]
        STG["staging: edge middleware<br/>fail-closed 403 if creds unset/invalid"]
        ADMIN["admin.html: Cloudflare Access + noindex"]
        LOCAL["no telemetry / no egress<br/>trade data never leaves the browser"]
    end

    RENDER --- CSP
    STORE --- DEMO
```

## Notes

- **Sanitize at the trust boundary, not the sink.** CSV symbols route through `rootSym()`; a restored
  backup is treated as fully untrusted — dates must be canonical `YYYY-MM-DD`, symbols re-sanitized,
  tags stripped of markup + lowercased, `meta` keys allow-listed (only `setup`/`savedFilters`, with
  `savedFilters` shape-validated), and screenshots kept only if they match `SHOT_RE` (well-formed
  base64 image data URIs). The live capture path shares the exact same `validShot` allow-list.
- **CSP `style-src 'self'` holds.** Tailwind ships as a linked stylesheet of classes; dynamic styles
  use the `styleProps` CSSOM action — **never** a literal `style=""` attribute. (bits-ui/Floating-UI
  positioning writes `element.style` via CSSOM, which isn't gated by `style-src`.)
- **Demo can't persist by construction** (in-memory `DemoStore`) *and* by guard (`if (isDemo) return`
  on every write) *and* by UI (controls disabled) — three independent layers; e2e asserts no
  Blotterbook IndexedDB is created on demo.
- **Staging fails closed** at the edge, and **admin** is Cloudflare Access-gated + `noindex`.
- The whole model rests on **local compute** — no telemetry, no egress; the only network calls are
  static `/data/*.json` reference data and the optional public `/api/*` niceties (geo, status, flags).
