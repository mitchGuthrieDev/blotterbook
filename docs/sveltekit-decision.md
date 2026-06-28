# SvelteKit adoption — analysis & decision (A62)

**Status:** analysis complete · **decision: DEFER** (stay on Vite multi-page + Svelte 5 SPA)
· 2026-06-28

> A discussion/analysis deliverable for backlog **A62**, mirroring how
> [`build-step-decision.md`](build-step-decision.md) deferred a shipped-output build before
> [`adr-001-vite-svelte-spa.md`](adr-001-vite-svelte-spa.md) later adopted it. This is **not** a
> migration; it records the trade-offs and a trigger for revisiting. If SvelteKit is ever adopted, it
> should graduate to `adr-002-…` the way the build step graduated from this kind of doc to ADR-001.

## TL;DR

**Defer SvelteKit.** The current architecture — Vite multi-page build + a single mode-aware Svelte 5
SPA on `/app/`, static marketing pages, and a thin `functions/*` Cloudflare edge layer — already
delivers everything SvelteKit's headline features would give us, *without* the one thing SvelteKit
structurally pushes toward that fights our hard pillar: a server that renders application views.

SvelteKit's value (file routing, SSR/SSG, server endpoints, `adapter-cloudflare`) maps onto
capabilities we either don't need (SSR of the app), already have (SSG-equivalent static marketing
pages via Vite MPA; an edge layer via Pages Functions), or can adopt incrementally inside the current
setup if a concrete need appears (client-side routing for the app). Adopting it now would re-open the
deploy-contract reversal we just stabilized (A18/A26), churn the `functions/*` layer, and add a
framework whose central abstraction (the load/server boundary) is a permanent footgun against the
**no-trade-data-leaves-the-browser** moat. The cost is real and immediate; the benefit is speculative.

Revisit only if a **named** requirement appears that the current stack genuinely can't serve well
(see [Trigger to revisit](#trigger-to-revisit)).

## What SvelteKit actually adds — and whether we need it

SvelteKit is the application framework on top of Svelte + Vite. Its headline features, each weighed
against what Blotterbook actually needs:

| SvelteKit feature | What it gives | Do we need it? |
| --- | --- | --- |
| **Filesystem routing** (`src/routes/…`) | URL ↔ file convention, nested layouts, route params | **No, not yet.** The app is effectively single-route today (one dashboard, modals/panels are in-component state). The roadmap's complexity (R11 replay, R12 module menu, R13 resizable modules, F23 blotter) is *intra-dashboard composition*, not multi-page navigation. If the app ever wants real client-side routes (e.g. `/app/trade/:id`, deep-linkable views), that's a **single small router dependency** drop-in, not a framework migration. |
| **SSR** (server renders the view per request) | Faster first paint for data-driven pages; dynamic per-request HTML | **No — and actively hazardous.** The app's data is the user's trades, which live only in IndexedDB *in the browser*. There is nothing for a server to render: the server has no trades and **must never** have them. SSR of the app surface is a non-feature here. (See [the hard pillar](#the-hard-pillar-ssr-must-never-see-trade-data).) |
| **SSG / prerendering** (`prerender = true`) | Static HTML at build time for content pages | **Already have the equivalent.** Vite's multi-page build emits static, fingerprinted HTML for `index/howto/roadmap/changelog/legal/admin` today — these are authored HTML, not rendered behind an SPA shell. SvelteKit prerender would produce the *same* static-HTML outcome with *more* machinery. The only thing it'd add is component-authoring of those pages, which is **A69's** job and doesn't require SvelteKit (plain Svelte components compiled by Vite MPA suffice). |
| **Server endpoints** (`+server.js`) | Co-located API routes, typed `load` data fetching | **Already have a better-fitting equivalent.** `functions/*` *is* our edge API (geo, status, config, admin-key, the Stripe/accounts scaffold), running natively on Pages Functions with auth in `_lib/auth.js`. SvelteKit endpoints would mean **rewriting that layer** into the framework's routing model for zero capability gain. |
| **`adapter-cloudflare`** | Packages a SvelteKit app for Pages/Workers | Only relevant *because* you adopted SvelteKit. It introduces a Worker that serves the app and runs `functions/*`-equivalent routes through SvelteKit's handler — a heavier, framework-mediated deploy than "static `dist/` + Pages Functions picked up automatically." |
| **`$app/*` stores, form actions, `enhance`, hooks** | Progressive-enhancement ergonomics for server-backed forms | **No.** Form actions assume a server processes the form. Our forms (CSV load, trade editor, setup inputs) are **client-only by design** — they feed the local pure-logic core, never a server. |

**Net:** of SvelteKit's six pillars, two are non-features for us (SSR, form actions), two we already
have via simpler means (SSG → Vite MPA; endpoints → Pages Functions), one is a deferred maybe
(routing, replaceable by a micro-dep), and one (`adapter-cloudflare`) only exists to serve the others.

## The hard pillar: SSR must never see trade data

This is the decisive constraint. Blotterbook's moat (architecture.md → Design pillars #1; ADR-001
§Decision.1) is **"compute happens locally — no trade data ever leaves the browser."** It is the one
pillar ADR-001 explicitly says *does not bend*.

SvelteKit's gravitational center is the **`load` / server boundary**: the idiomatic way to build a
data-driven page is `+page.server.js` fetching data server-side and streaming HTML. For Blotterbook
that idiom is not just unused — it's a **standing invitation to violate the moat**:

- The trades live in IndexedDB, which is browser-only. A server `load` *cannot* read them, so any
  SSR'd app view is either empty (pointless) or requires shipping trades to the server (forbidden).
- Adopting the framework whose happy path is server data-loading means every future contributor (or
  AI agent) works against an architecture that makes the wrong thing easy and the right thing a
  swim-against-the-current `+page.js` (client `load`) / `browser`-guard / `ssr = false` dance.
- We'd be permanently running with `export const ssr = false` on the app routes to disable the
  framework's main feature — a strong signal the framework is a poor fit.

The current SPA has the opposite default: **there is no server render path for the app at all.** The
app boots in the browser, reads IndexedDB through the `Store` seam, and computes locally. The moat is
enforced by *construction*, not by configuration flags we must remember to keep set. That is exactly
the property we want for a privacy product handling financial data.

(The paid cloud-sync tier stays zero-knowledge / E2E-encrypted per A16; even then the server stores
*encrypted blobs* it can't read — still not an SSR-render-the-trades story.)

## Fit with Cloudflare Pages / Functions and the existing edge layer

Today's deploy is clean and well-matched:

- `npm run build` → static `dist/` → Pages serves it.
- `functions/*` is picked up from the repo root automatically (geo/status/config/admin-key + the
  Stripe scaffold), with its own auth (`_lib/auth.js`), middleware key-gate (`_middleware.js`), and
  guardrails (A15/A16/A17/S11/S22 — free-tier caps, KV low-write, webhook signatures).

SvelteKit + `adapter-cloudflare` changes the shape of this:

- The app would deploy as a **Worker** (SvelteKit's server handler) rather than pure static assets,
  even if every app route is `ssr=false` prerendered/SPA. That's more moving parts on the request
  path and counts differently against the **Workers free-tier 100k req/day cap** the guardrails
  (A16/A17/CH27) are carefully managing.
- The `functions/*` layer would need to be **either kept alongside SvelteKit** (two routing models in
  one project — confusing) **or migrated** into SvelteKit endpoints/hooks (a rewrite of a working,
  security-reviewed edge layer for no capability gain, and re-doing the auth/middleware/Access-JWT
  work in a new idiom). Both options are strictly worse than "leave it alone."
- The Access-gated staging middleware (`_middleware.js` gating `/app/staging.html`) maps to Pages
  Functions middleware today; under SvelteKit it'd move into `hooks.server.js` — again, rework of a
  working control.

There is **no Cloudflare-fit problem to solve.** The current stack is already idiomatic for Pages.

## Deploy-contract impact (A18 / A26)

A26 just executed the single riskiest change in the project's history: reversing the deploy contract
(A18) so the repo root is the *source* root and Pages serves a built `dist/`. It was done all-at-once
specifically because **there are no users yet**, gated by the Playwright suite, and it has stabilized.

SvelteKit would **re-open that contract**:

- SvelteKit imposes its **own** project structure (`src/routes`, `src/lib`, `app.html`,
  `svelte.config.js`, the `$lib`/`$app` aliases). Adopting it is not a tweak to `dist/` output — it's
  a wholesale relayout that subsumes and overrides A30's planned reorg.
- The URL-preservation invariant ("a file's source path mirrors its public URL," kept 1:1 through
  A26) is replaced by SvelteKit's routing-derived URLs. Preserving today's exact URLs
  (`/app/app.html`, `/app/demo.html`, `/app/staging.html`, the `/app/` rewrite in `_redirects`, the
  marketing `.html` paths, canonicals, sitemap) under SvelteKit's router is **possible but fiddly**
  (custom routes, `trailingSlash`, prerender entries) — re-doing work A26 got for free.
- `_headers` / `_redirects` semantics change under `adapter-cloudflare` (some handled by the adapter,
  some still file-based) — another coupled-path set to re-verify.

In short: SvelteKit doesn't *extend* the A26 contract, it **replaces** it. We'd spend the
deploy-contract risk budget a second time, for a framework we've shown we don't need.

## Would the static marketing pages benefit from SSG?

Marginally, and not enough to justify SvelteKit:

- The marketing/info pages are **already static HTML** emitted by Vite MPA — they are as fast and
  SEO-friendly as prerendered SvelteKit pages would be. First paint, crawlability, and cacheability
  are already optimal.
- What they *don't* have yet is **component-based authoring** (shared nav/footer is currently injected
  by `build-includes.mjs`; changelog/admin render via hand-written `assets/*.js`). Unifying that onto
  Svelte's component model is desirable — but that's **A69**, and A69 is achievable with plain Svelte
  components under the existing Vite MPA build (each marketing page = an HTML entry that mounts/compiles
  Svelte, or is prerendered). SvelteKit's prerender would reach the same endpoint with more framework.
- SvelteKit *would* give nicer prerender ergonomics (a `prerender` flag and a crawler vs. our explicit
  `rollupOptions.input` list). That's a DX nicety, not a user-facing or SEO win, and not worth a
  framework migration.

**Conclusion:** SSG is a solved problem here. A69 (Svelte-ify marketing) is the real follow-up and it
doesn't need SvelteKit.

## Pros / cons summary

**Pros of adopting SvelteKit**

- File-based routing if/when the app needs genuine multi-route navigation (deep-linkable views).
- One unified framework convention for routes + endpoints + layouts (cohesion, ecosystem docs, hiring
  familiarity).
- First-class prerender ergonomics for the marketing pages.
- `adapter-cloudflare` is officially maintained and Pages-aware.

**Cons / risks**

- **Fights the hard pillar:** its core `load`/server idiom is a permanent invitation to let trade data
  reach a server; we'd run with SSR disabled to neuter the framework's main feature.
- **Re-opens the deploy contract (A18/A26)** we just stabilized — a full relayout to SvelteKit's
  structure, re-deriving every URL we currently preserve 1:1.
- **Churns the `functions/*` edge layer** — either two routing models coexist, or we rewrite a
  working, security-reviewed auth/middleware/Stripe-scaffold layer into SvelteKit endpoints/hooks for
  zero capability gain.
- **Heavier Cloudflare deploy** (a Worker serving the app vs. pure static `dist/`), with different
  free-tier request accounting (A16/A17/CH27).
- **Adds a large dependency** whose weight isn't earned per **A28** (we'd use a fraction of it).
- **Supersedes/duplicates planned work**: it would override A30's reorg and partly pre-empt A69, but on
  the framework's terms rather than ours — coupling three separable decisions into one big-bang.
- **Capabilities we'd "gain" are already covered**: SSG → Vite MPA; endpoints → Pages Functions;
  routing → a micro-dep when actually needed.

## Recommendation: DEFER

Stay on **Vite multi-page + Svelte 5 SPA**. It already provides static SSG-equivalent marketing pages,
a clean edge layer via `functions/*`, an enforced-by-construction local-compute guarantee, and a
just-stabilized deploy contract. SvelteKit's distinctive features are either non-features for a
local-only app, hazards to the moat, or things we already have by simpler means — while its cost
(deploy-contract reversal #2, `functions/*` churn, a heavyweight dep) is immediate and real.

This is a **defer, not a never.** If a concrete trigger fires, revisit and graduate to `adr-002`.

### Trigger to revisit

Reconsider SvelteKit if **any** of these becomes a real, named requirement:

1. **Genuine multi-route app navigation** — deep-linkable, bookmarkable in-app views
   (`/app/trade/:id`, per-strategy pages) with nested layouts, beyond what a single small client
   router can serve cleanly. *(First reach for a micro-router inside the current SPA before a
   framework.)*
2. **Server-rendered *non-trade* surfaces that benefit from per-request SSR** — e.g. a public,
   shareable, server-rendered marketing/blog/docs section with dynamic content (still never trade
   data). *(Even then, weigh Vite MPA + a tiny SSG step first.)*
3. **The `functions/*` layer grows enough** that a unified framework routing model would materially
   reduce complexity (many interdependent endpoints, shared server middleware, typed `load`
   contracts) — and the win clearly outweighs rewriting the security-reviewed auth layer.
4. **The team/maintenance story** shifts toward contributors who strongly expect a SvelteKit-shaped
   project and the convention cohesion outweighs the migration cost.

Absent one of those, the answer stays defer.

## Sequencing relative to A30, A69, A61

This decision is a **prerequisite gate** for the structural items, exactly as their prompts note:

- **A30 (source-tree reorg)** — *Do A30 on the current Vite + Svelte structure.* A30 was deferred to
  after the A33 cutover and is now unblocked. Because we are **not** adopting SvelteKit, A30 should
  proceed toward a Vite/Svelte-shaped `src/` + static split + `components/lib/` layout + retiring
  `copy-static.mjs` for `publicDir` — **not** toward SvelteKit's mandated `src/routes` structure. Had
  we adopted SvelteKit, A30 would have been subsumed by the framework's layout; deferring SvelteKit
  means A30 is a clean, self-contained reorg. **A30 can proceed now without waiting on anything else.**
- **A69 (convert homepage/admin/info site to Svelte)** — its prompt already says "sequence after the
  SvelteKit decision (A62)." **That gate is now resolved: do A69 with plain Svelte components under
  the existing Vite MPA build** (each marketing page stays a static/prerendered HTML entry that
  compiles Svelte — *not* pulled behind the SPA shell, per ADR-001). No SvelteKit prerender needed.
- **A61 (TypeScript)** — **orthogonal and unaffected.** TS adoption is independent of SvelteKit
  (SvelteKit would have *included* TS tooling, but we get the same via `<script lang="ts">` + tsc/Vite
  in the current setup). A61 can proceed on its own timeline; this decision neither blocks nor
  accelerates it.

**Suggested order:** A61 (TS, anytime) ∥ then **A30** (reorg on the Vite/Svelte structure) → **A69**
(Svelte-ify marketing into that structure). Settling A30's structure before A69 avoids reorganizing
the marketing pages twice — the same "don't reorg twice" logic A30's prompt uses.
</content>
</invoke>
