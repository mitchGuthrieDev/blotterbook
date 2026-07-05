# Svelte 5 adoption survey (A65 + A80)

**Date:** 2026-07-05 · **Items:** A65 (under-used Svelte 5 features) + A80 (leaning further into the
reactivity model) — combined, they overlap heavily. Svelte is pinned at **5.56.4** (package.json), so
every feature below ($props.id() 5.20+, writable $derived 5.25+, attachments 5.29+, svelte/reactivity)
is available today.

## Recommendation summary

| Feature | Verdict |
| --- | --- |
| Snippets vs slots | **Done** — zero `<slot>`, snippets everywhere; nothing to do |
| `$derived.by` | **Done where it helps** (17 sites); convert remaining long chains only opportunistically |
| Attachments (`{@attach}`) vs actions | **Skip migration**; prefer attachments for *new* element lifecycle needs |
| `$props.id()` | **Adopt narrowly** — pattern proven in TagInput; sweep the 8 hardcoded form ids when touched |
| `.svelte.ts` rune modules vs context | **Keep the factory+props architecture**; fix the dead `'bb:store'` context; extract the tabs block from App.svelte |
| `$effect` cleanup correctness | **Correct as-is** (14 blocks, the only 2 that acquire resources both clean up) |
| `$bindable()` | **Skip broad adoption** — the callback pairs are deliberate staged-commit seams |
| `$state.snapshot` at persistence | **Sound** (9 call sites + Store-side defensive copies); no gaps found |
| Fine vs coarse reactivity | **Adopt `$state.raw`** for the big dashboard collections — the one real perf lever |
| `svelte/reactivity` | Partially adopted (MediaQuery); **make `REDUCED_MOTION` live** |

## Snippets vs slots (A65)

Evidence: `<slot>`/`$$slots` appear **0** times in `src/`; `{#snippet}`/`{@render}` appear on **136**
lines across 11 app files (47 `{#snippet}` blocks in screens/parts alone). Snippets are also used as
typed props: `actions?: Snippet` / `children: Snippet` (`src/lib/components/shell/AppShell.svelte:25,29`),
a parameterized `slide: Snippet<[number]>` (`src/app/parts/ModuleCarousel.svelte:11`), and a `button(tip)`
snippet passed into SidebarNav (`AppShell.svelte:94`). **Verdict: fully adopted — close this thread.**

## `$derived.by` patterns (A65 + A80)

**17 call sites already**: `src/app/App.svelte:102,428,453,470,496,502`, `Calendar.svelte:121,157,178`,
`Analytics.svelte:127,142,174`, `Dashboard.svelte:237,356`, `Blotter.svelte:109`,
`dashboard.svelte.ts:91`, `TagInput.svelte:30` — exactly the multi-statement builders the form is for.
The remaining heavy App.svelte chains are single-expression `$derived(...)` wrapping large `.map()`
literals: `dashSeries` (:124), `blotterRows` (:548), `editorRows` (:565), `csvFiles` (:634),
`analytics` (:488). `.by` would change nothing semantically (same one-signal granularity); it's purely
a readability call. **Verdict: no systematic conversion; use `.by` when next editing those blocks.**

## Attachments vs actions (A65)

**Zero `{@attach}`**. Three actions exist: `styleProps` (`src/app/lib/actions.ts`, the documented
CSP-safe CSSOM seam — used at `Dashboard.svelte:1260` and in chart components), `focusSelect`
(`TradeEditor.svelte:238,261`), and the site's `reveal`/`barWidth` (`Home.svelte`, `Admin.svelte:478`).
`styleProps` leans on the action `update(props)` contract for cheap prop-only updates; an attachment
re-runs its whole body on any dependency change — a rewrite buys nothing and risks the CSP seam that
CLAUDE.md pins by name. Attachments *do* beat actions in one place actions can't go: components (e.g.
attaching behavior to a shadcn primitive without the bits-ui `child` snippet dance). **Verdict: keep
the three actions; reach for `{@attach}` for new element/component lifecycle needs.**

## `$props.id()` (A65)

One adopter: `TagInput.svelte:29` (`const uid = $props.id()` → `id="bb-tags-{uid}"` datalist), which is
the right pattern since TagInput mounts many times per screen. Elsewhere there are **8 hardcoded
`id="..."`/`for=` label pairs** in screens (`Dashboard.svelte:570,580` `f-from`/`f-to`;
`Reports.svelte:162,163` `r-title`/`r-acct`; etc.). These are singletons per route today, so no live
collision — but Dashboard's filter popover markup is one refactor away from double-mounting.
**Verdict: adopt in anything reusable; sweep screen singletons when touched (trivial churn).**

## `.svelte.ts` rune modules vs context (A80)

Two rune modules exist, not one: `src/app/lib/dashboard.svelte.ts` (598 lines, `createDashboard` — the
whole engine) and `src/app/lib/pagination.svelte.ts` (62 lines, `createPagination`, shared by
Blotter + TradeEditor per A157). The context story is the odd part: `setContext('bb:store', store)`
(`App.svelte:71`) has **zero `getContext` consumers** — screens receive everything as props from
App.svelte, which is the intended seam ("Screens read real data via props", App.svelte:7). So the app
is *already* factory-module-first; context is vestigial. The cost is that `App.svelte` (1049 lines,
21 `$derived`) is a monolithic view-model layer: the dashboard-tabs + workspace-templates block alone
is ~145 lines of self-contained rune state (:136–280). Distributing `dash` via context instead of props
would gut the screens' prop-driven testability/preview story for no perf gain (the deriveds are lazy
either way). **Verdict: keep factory + props; delete-or-use the dead `'bb:store'` context; extract the
tabs/workspace block into a `dashTabs.svelte.ts` factory (mechanical, view-only, A29-clean).**

## `$effect` cleanup/teardown (A80)

**14 `$effect` blocks** in app code. Only 2 acquire external resources, and **both return cleanups**:
the hashchange listener (`App.svelte:91–95`) and the bus subscription (`ActivityTerminal.svelte:62–72`,
which also resets `lines` so a remount can't double-render the backfill). The other 12 are pure state
sync needing no teardown: index clamps (`ModuleCarousel.svelte:16`, `pagination.svelte.ts:24`),
dialog-close resets (`CsvLibrary.svelte:190`, `Dashboard.svelte:302`), selection-driven draft loads
(`Blotter.svelte:146`, `Dashboard.svelte:324`, `Calendar.svelte:67`), autoscroll
(`ActivityTerminal.svelte:77`), and three prop-reseed guards (`TradeEditor.svelte:77`,
`CsvLibrary.svelte:164`, `Dashboard.svelte:202`). Note: writable `$derived` (5.25+) is *not* a drop-in
for those reseed guards — they deliberately compare an id-set key so that a parent re-derive with the
same ids (e.g. a tag save round-trip) does **not** blow away the local draft, which a writable derived
would. **Verdict: correct as-is; no action.**

## `$bindable()` props (A80)

Adopted where it fits: `TagInput.svelte:12` (`value = $bindable('')`) plus the vendored shadcn
primitives (`ref`/`value`/`open` throughout `src/lib/components/ui/`), consumed via `bind:open`/
`bind:value` in the screens. The remaining callback pairs are not faked two-way binding — they are
**staged-commit seams by design**: `modules`/`onmoduleschange` exists so App can `markDirty()` and
persist only on explicit Save (A186/A189); `rows`/`onsave` (TradeEditor) diffs a draft against the
persisted snapshot; `onscope`, `onsavenote`, `onsetupsave` route through demo guards in the factory.
A `bind:` would force the parent to *observe* changes with an `$effect` to keep the dirty/guard logic —
strictly worse. The only mild candidate is Dashboard's local `scope` mirroring `dash.filters.scope`
via `onscope` (`Dashboard.svelte:312–316`), which could desync if scope were ever set elsewhere.
**Verdict: skip; revisit `scope` only if a second scope-writer appears.**

## `$state.snapshot` at persistence boundaries (A80)

**9 call sites**, all at real boundaries: `store.local` layout/tab/template writes
(`App.svelte:152,185,247`), `setMeta('savedFilters', …)` (`dashboard.svelte.ts:469,487,492`), the
rebuild-before-IndexedDB clone (`dashboard.svelte.ts:275` — the comment documents why: structured
clone rejects `$state` proxies), draft cloning (`TradeEditor.svelte:68`), and a JSON POST body
(`Admin.svelte:242`). The paths that *don't* snapshot (`saveNote`/`saveTradeMeta` passing
`ex?.shots` proxies down) are covered on the other side: the Store defensively re-copies arrays before
`put` (`store.ts:250` fileIds copy, `:281–282` `cleanTags` + `shots.filter`). **Verdict: sound; keep
the belt-and-suspenders Store-side copies.**

## Fine-grained vs coarse reactivity in the dashboard (A80)

The factory is deliberately coarse: every mutation ends in `reloadAll()`
(`dashboard.svelte.ts:145–159`), which re-reads IndexedDB and wholesale-reassigns `allTrades`,
`csvFiles`, `journal`, `tradeMeta`, `savedFilters` — then `filtered → metricsAll/metricsActive →
cost` re-derive (:79–107). That's the right shape (correctness by re-read; the deriveds are pure-core
calls per A29). The waste is **deep proxying**: `allTrades = $state<Trade[]>([])` (:40) wraps
potentially thousands of immutable trades (content-hash ids; edits rebuild via `updateTrade`), and
every `applyFilters`/`compute()` pass reads through proxies. Nothing mutates these collections in
place — all updates are reassignments — so **`$state.raw`** is a drop-in for `allTrades`, `csvFiles`,
`tradeMeta`, `journal`: proxy overhead gone, and the `:275` snapshot workaround becomes moot. Fit with
A29 is perfect — the core never sees runes either way. `SvelteMap`/`SvelteSet` are *not* needed (the
maps are replaced, never mutated). Related: `MediaQuery` from `svelte/reactivity` landed in
`Dashboard.svelte:75,187`; `REDUCED_MOTION` (`src/app/lib/motion.ts:5`) is still a one-time
`matchMedia().matches` read at module scope, so an OS-level toggle mid-session is ignored until reload.
**Verdict: adopt `$state.raw` for the four big collections; convert `REDUCED_MOTION` to a live
`MediaQuery`.**

## Proposed backlog items

1. **`$state.raw` for the dashboard collections** — `allTrades`/`csvFiles`/`tradeMeta`/`journal` in
   `dashboard.svelte.ts`; delete the now-moot snapshot at `:275`; verify Trade Editor + reimport flows.
2. **Resolve the dead `'bb:store'` context** — either remove `setContext` (`App.svelte:71`) or give it
   a consumer (parts that currently thread the store through props); today it's write-only.
3. **Extract `dashTabs.svelte.ts`** — the tabs/dirty/workspace-template block (`App.svelte:136–280`)
   into a rune-module factory beside `pagination.svelte.ts`; shrinks App.svelte ~145 lines, no
   behavior change.
4. **Live reduced-motion** — replace the static `REDUCED_MOTION` boolean (`motion.ts:5`) with a
   `MediaQuery('(prefers-reduced-motion: reduce)')` so `dur()` tracks OS changes.
5. **(Low) `$props.id()` sweep** — convert the 8 hardcoded form ids in Dashboard/Reports/etc. when
   those files are next touched; no dedicated PR.
