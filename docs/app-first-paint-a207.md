# A207 — Making the /app surface "static load": prerendered shell / skeleton options

**Date:** 2026-07-05 · **Backlog item:** A207 (discussion/analysis) · Pairs with A206 (skeleton loaders — SHIPPED 2026-07-05, but rendered by the SPA *after* JS boots)

## Where the time goes today

`/app/app.html` is a bare mount point (`<div id="app">` + `main.ts`). The built page declares the
full boot module graph as parallel `<script type="module">` tags plus two stylesheets in `<head>`
(verified in `dist/app/app.html`) — so network discovery is already optimal; there is **no import
waterfall to fix with modulepreload**. The user-visible sequence is:

1. HTML (tiny) → CSS (~73 KiB) + boot JS (~427 KiB, A213; 559 KiB with lazy screens) in parallel.
2. **Nothing paints** until the CSS arrives *and* all boot JS parses/executes and Svelte mounts.
3. `App.svelte` renders the AppShell + the A206 `screenSkeleton` (`dash.loaded` still false).
4. `dash.boot()`: `/data/manifest.json` fetch → 4 ref-data fetches → IndexedDB open → compute → real dashboard.

The A206 skeleton fixed step 3→4 (data wait). A207 is about step 1→3: the blank window before any
JS runs. Real SSR of *content* is impossible by design — trade data lives only in IndexedDB
(hard constraint: client-only compute, nothing server-side) — so only the **data-free chrome**
(shell + skeleton) can ever pre-paint. That also means SvelteKit SSR buys nothing here; A62's
no-SvelteKit decision stands unchallenged by this analysis.

## Prioritized recommendations

| # | Option | First-paint win | Complexity / risk | Verdict |
|---|--------|-----------------|-------------------|---------|
| 1 | **(b) Static skeleton markup in the HTML shells**, styled by the existing linked Tailwind sheet | Large — skeleton paints after ~73 KiB CSS instead of ~427 KiB JS + execute | Low; 3 shells to keep in sync; must be cleared before `mount()` | **Adopt now** |
| 2 | **(c) Preload/priority hints** (font preload; `versions.json`/flags preload; drop the `?t=` on the manifest fetch + `as="fetch"` preload) | Small-medium — no first-paint change, but `dash.loaded` flips ~1 RTT earlier and no font swap | Low | **Adopt now** |
| 3 | **(a) SSG-prerender the AppShell chrome + skeleton** via `vite-ssg.mjs` (replace-not-hydrate) | Medium over #1 — real sidebar/topbar pre-paints, not just content skeleton | Medium; SSR-safety of shell imports, first-run onboarding mismatch, replace-vs-hydrate care | **Phase 2**, only if #1 feels insufficient |
| 4 | **(d) Service-worker asset caching** (repeat visits paint from cache) | Large for returning users — the dominant audience of a daily journal | Medium-high; update/staleness policy | **Own backlog item** |
| — | Inline critical CSS in `<head>` | — | Breaks CSP `style-src 'self'` (see below) | **Reject** |
| — | SvelteKit / server rendering of app state | — | No trade data server-side, ever; A62 | **Reject** |

## Option detail

### 1. Static skeleton in the mount shells (adopt)

Put the A206 skeleton's markup — mirrored shapes, same Tailwind utility classes (`bg-card`,
`border-border`, `animate-pulse`, …) — directly inside `<div id="app">` in `app/app.html`,
`demo.html`, `staging.html`, plus a `bg-accent`-toned sidebar/topbar frame. The Tailwind v4 Vite
plugin scans source HTML, and these classes already exist in the emitted sheet, so the skeleton
paints as soon as the (much smaller, long-cacheable) CSS file lands — the classic "static load"
feel, with zero JS and **zero impact on the A96/A190 size budget** (HTML bytes aren't gated).

- **CSP:** clean — classes on markup, linked stylesheet, no `style=""`, no inline `<style>`.
- **Mount interaction:** Svelte 5 `mount()` *appends* to the target; `main.ts` must clear the
  static skeleton first (`target.replaceChildren()` — one line). No hydration involved.
- **Consistency:** shape-match A206's `screenSkeleton` so the JS-rendered skeleton swap is
  invisible; drift risk across 3 shells is the main cost (they're already parallel hand-authored
  files; a shared comment or an e2e class-presence assertion keeps them honest).
- **Micro-win alongside:** `<meta name="color-scheme" content="dark">` in the shells makes the
  pre-CSS canvas dark (kills the white flash); it's a meta tag, not styling — CSP-irrelevant.
- **Deep links:** the skeleton is dashboard-shaped even for `#analytics` boots — acceptable; the
  A206 skeleton has the same property today.

### 2. Preload / priority hints (adopt)

- **Font:** `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the Geist Mono
  woff2 (23 KiB) in the app shells — today it's discovered only after CSS parses, so the static
  skeleton (option 1) would otherwise first paint in a fallback face. Verify Vite rewrites the
  `href` to the fingerprinted asset when referenced from an HTML entry (it resolves `<link href>`
  assets); if not, reference it from `static/` un-fingerprinted.
- **Data:** `<link rel="preload" as="fetch" crossorigin href="/data/versions.json">` (+ the flags
  endpoint) are free wins. The manifest fetch (`core.ts` line ~542) appends `?t=Date.now()` — a
  preload can never match that URL. The `cache: 'no-cache'` option already guarantees
  revalidation, so the `?t=` is redundant: drop it, then preload `/data/manifest.json`. The four
  hash-keyed ref-data files (`?k=<hash>`) can't be preloaded from static HTML by design; the
  manifest RTT saved is the win.
- **Not needed:** modulepreload — the boot graph is already fully declared in `<head>` (verified).

### 3. SSG-prerendered shell (defer to phase 2)

`scripts/vite-ssg.mjs` is generic: registering `app/app.html` with an `<!--ssg-outlet-->` and a
new data-free `AppShellSkeleton.svelte` (AppShell + nav sections + `screenSkeleton` markup, no
store/dashboard imports) would prerender the *real* chrome at build time and keep it in sync with
`AppShell.svelte` automatically — solving option 1's drift problem and pre-painting the actual
sidebar/topbar.

Constraints that make this phase 2, not phase 1:

- **Do not prerender `App.svelte` itself.** It reads `PAGE_MODE` from `document.body`, touches
  `location`/`localStorage` at init, and pulls the Store — none of it SSR-safe. Only a dumb
  sibling component qualifies; `AppShell` + `SidebarNav` + lucide icons should SSR cleanly, but
  the `IconTip`/tooltip imports need checking.
- **Replace, don't hydrate.** The live root stays `mount()`; `main.ts` clears the prerendered
  chrome first. Svelte `hydrate()` over SSR markers is possible but pointless risk here — the
  prerendered chrome is throwaway scaffolding, and hydration mismatch (hash route, mode badge,
  collapsed-rail state) is exactly the failure class we'd be signing up for.
- **First-run mismatch:** an empty prod store boots into `Onboarding` with `hideNav` — those users
  get a flash of sidebar chrome that then disappears. Rare (once per user), but real.
- **Dead chrome:** the prerendered nav looks clickable before JS lands. The window is short once
  option 1+2 land, which is why this is a follow-up, not the opener.
- **Budget/A62:** no JS added (prerendered HTML only); no SvelteKit — the existing A69 plugin
  already does everything required.

### 4. Service worker (split out)

Cache-first `/assets/*` (content-hashed, immutable) + the app shells makes *repeat* visits paint
from disk — for a daily-use journal that's the biggest perceived-perf lever of all, and it
composes with options 1–3. It needs its own design pass (update flow vs. the CH12 two-track
versioning, staging isolation, kill switch), so: separate backlog item, not part of A207's fix.

### Rejected: inline critical CSS

`_headers` ships `style-src 'self'` with **no** `'unsafe-inline'` (S18/A55 — a deliberate
hardening win). An inline `<style>` block would require either `'unsafe-inline'` (regression) or
per-build `'sha256-…'` hashes written into `static/_headers` by a new build step (`_headers` is
verbatim-copied today — this breaks the "static/ is served verbatim" contract and adds churn).
Not worth it: the linked Tailwind sheet is ~73 KiB, cacheable, and already in `<head>`; option 1
gets the same effect at zero CSP cost.

## Proposed backlog items

1. **A2xx — Static boot skeleton in the app shells (adopt).** Skeleton markup inside `#app` in all
   three shells using existing Tailwind utilities, `target.replaceChildren()` in `main.ts`,
   `color-scheme: dark` meta; e2e: skeleton classes present in served HTML, no `style=""`.
2. **A2xx — Boot preload hints (adopt).** Font preload + `versions.json`/flags preloads in the app
   shells; drop the redundant `?t=` from the manifest fetch in `core.ts` and preload
   `/data/manifest.json`. Verify fingerprint rewriting in the built HTML.
3. **A2xx — Phase 2 (optional): SSG-prerender the AppShell chrome** via a data-free
   `AppShellSkeleton.svelte` registered in `vite-ssg.mjs`; replace-not-hydrate; resolve the
   onboarding `hideNav` flash before shipping.
4. **A2xx — Service-worker asset caching for repeat-visit instant paint** (design pass required:
   update flow vs. CH12 versioning, staging isolation, kill switch).
