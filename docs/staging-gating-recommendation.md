# Staging gating after the CH16 cutover — recommendation (A111)

> **2026-07-02 note:** the worked example below (A135 dashboard tabs as the live staging-only
> inventory) is now historical — tabs were promoted to all surfaces in the CH16 run the day after
> this was written. The recommendation itself stands unchanged.

**Decision record, 2026-07-01.** Closes backlog **A111**. Question: now that app/demo/staging all
mount ONE Svelte bundle (`main.ts` → the mode-aware `App.svelte`), is runtime `PAGE_MODE`/
`isStaging` gating still the right way to use staging as a proving ground — versus build-time
tree-shaking, admin feature flags, or a separate entry?

## What the gate actually protects (and what it doesn't)

Two different things get conflated:

- **Access to the staging *surface*** (`/app/staging.html`) is protected server-side by the
  `_middleware.ts` admin gate (cookie/header credential, fail-closed). That is the real fence.
- **The staging-only *code*** (`isStaging` branches, e.g. A135's dashboard tabs) ships in the
  public bundle on every surface, merely inert. The runtime gate is a UX switch, not a security
  boundary — and must never be treated as one (no secrets, no "hidden" behavior that matters if
  discovered). Everything currently gated passes that test.

## Options weighed

| Option | Verdict |
| --- | --- |
| **Runtime `PAGE_MODE` gating (status quo)** | ✅ Keep as the model. One bundle, one build, zero divergence (the A33 single-SPA simplicity is load-bearing); promotion = deleting the gate (CH16's cheap mechanism); demo non-mutation guards use the same idiom. Cost: inert bytes in the prod payload. |
| **Build-time define / tree-shaking** | ❌ Rejected. The multi-page Vite build emits ONE `dist/` that Cloudflare Pages serves to all surfaces — a per-surface define requires per-surface builds (a build matrix, doubled e2e, drift risk between artifacts), i.e. it reintroduces exactly the divergence the cutover eliminated, to save a few KiB. |
| **Separate staging entry/root** | ❌ Rejected — this was the interim pre-cutover arrangement and its cost is known: a second root that drifts. The cutover retired it deliberately. |
| **Admin feature flags (`/api/config` + `APP_FLAGS`)** | ➕ Orthogonal keep. Flags are the right tool for *prod kill-switches and gradual rollouts* (runtime-changeable without a deploy), not for proving-ground gating — a flag adds a network dependency and admin state to something `PAGE_MODE` answers statically. Use both, for different jobs. |
| **Runtime gate + lazy chunk (new since the code-split)** | ✅ Adopt as the *refinement*. The screen code-splitting landed the pattern: a staging-only part can sit behind `{#if isStaging}{#await import(...)}` so its bytes leave the prod **boot payload** (they remain in `dist/` as an unreferenced-for-prod chunk, which is fine — see above re: not a security boundary). |

## Recommendation

1. **Keep runtime `PAGE_MODE`/`isStaging` gating as the staging model.** Its simplicity is the
   feature; the bytes cost is small and now manageable (see 2).
2. **Size threshold for the lazy refinement:** when a staging-only feature exceeds roughly
   **10 KiB minified or pulls any new dependency**, load it behind `{#if isStaging}` +
   `{#await import(...)}` instead of a static import. Today's inventory (A135 `DashTabs`, ~2 KiB,
   no deps) is below the threshold — no change needed now.
3. **Promotion stays CH16:** promoting a feature = removing its `isStaging` gate (and inlining the
   lazy import if one was used). No new mechanism.
4. **Feature flags stay for prod operations** (maintenance banner class of things), not for
   proving grounds.
5. **Guardrail wording (folded into CH16's prompt rather than a new backlog item):** staging gates
   are UX switches, not security boundaries — anything that must actually be private belongs
   behind the server-side middleware or should not ship at all.

**No new items spun off** — the one actionable rule (the 10 KiB lazy threshold) is recorded here
and in CH16's prompt, and the current staging inventory is under it.
