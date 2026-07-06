# Repo audit — 2026-07-06 (R1 pass 8)

*Scope: the full tree as of today's unmerged work — accounts phases 1+2 (`functions/_lib/accounts.ts`,
`email.ts`, `functions/api/account/*` incl. recovery/verify, donation provisioning in
`webhook.ts`/`checkout.ts`, `schema.sql`), the CH16 promotion of the Account screen + boot splash to
all surfaces, the flag-off staging-only F56 launch gate, F49 (DatePickerPopover/SymbolSelect), F47
batch intake, F52 xlsx reader, A223 perf, CH37 weight normalization. Per the owner's instruction,
extra security attention on the new accounts backend. Read-only; every finding filed as a backlog
item. Baseline is green: `npm run typecheck` (tsc ×2 + svelte-check) 0/0, `test:unit` 105/105, lint +
format clean, size 663.8 / 840.0 KiB.*

## Verified clean

- **The moat holds — no trade-data egress.** The only new outbound surfaces are the accounts backend
  (identity + entitlements only, S25) and its client (`src/app/lib/account.svelte.ts`): every POST
  body is an email or a WebAuthn ceremony response — never trade data. `@simplewebauthn/browser` is a
  lazy dynamic import (account.svelte.ts:66), so it stays out of the boot payload. `functions/` never
  receives or stores a trade.
- **Accounts backend is hardened and thoroughly tested.** Sessions are opaque `id.secret` with only
  `SHA-256(secret)` stored + constant-time compare (accounts.ts:138, 230); `__Host-` + HttpOnly +
  Secure + SameSite=Lax; sliding expiry; server-side revocation. Every mutating `/api/account/*` route
  runs `checkOrigin` (fail-closed) and `getDb`→503 fail-closed. Challenges + recovery/verify tokens
  are single-use + TTL'd, hash-only, and a wrong secret never burns the row (accounts.ts:441). The
  Stripe webhook verifies the signature over the RAW body *before* any provisioning (webhook.ts:49),
  dedupes on the event-id PK (webhook.ts:72), and never trusts an unverified checkout email
  (webhook.ts:83-86). All of this is covered by the 620-line `scripts/test-accounts.mjs` (105 asserts:
  signature gate, forged-event → provisions nothing, replay dedupe, unclaimed→claim-on-verify,
  enumeration-safe recover-send, GET/POST confirm, fail-closed matrix).
- **Runes / TS discipline.** No `export let` (the core.ts `export let` are module-level ref-data
  bindings, not Svelte props), no `$:`, no `createEventDispatcher`, no `svelte/store` writables
  anywhere in `src/`. No `: any`/`as any`. All new parts use `$props`/`$state`/`$derived`/`$effect`
  correctly (the borderline `$effect`s in BootSplash/DatePicker/SymbolSelect/ModuleCarousel are
  genuine side effects or multi-writer state).
- **CSP / sinks.** No inline `style=""` in any markup (the two grep hits are comments). `{@html}` is
  only Home.svelte's static constant SVG art. F56 LaunchGate is correctly `isStaging &&
  accountGateEnabled()` gated (App.svelte:792-793) and holds the whole `appBody` (App.svelte:1047).
- **Demo non-mutation holds.** Account.svelte disables every control via `disabled` (isDemo || busy ||
  !available) and skips the session probe entirely on demo (Account.svelte:75) — zero account traffic
  on demo. DashTabs/workspace writes go through the DemoStore seam and are hard-guarded.
- **Single-source wins since pass 7.** `DOW_NAME` (the A214 finding) is gone — `DOW_LABEL` (core.ts:336)
  is the one source, imported by report/analytics/Calendar/Analytics/Dashboard/DatePickerPopover.
  `platformOf` is centralized in App.svelte:578 and passed down; no per-screen re-derivation.

## Findings

### P2

- **A### — `showBetaAdapters` is a dead admin control (lost seam, A147 class).** The admin panel ships
  a toggle "Show beta platform adapters in the upload picker" (`src/site/components/Admin.svelte:71`),
  the flag is defaulted (`src/app/lib/flags.ts:23`) and Worker-mirrored
  (`functions/api/config.ts:25`), and adapters carry `beta:true`/`false` (`src/lib/core/adapters.ts:528,834`)
  — but **no app code ever reads `flags.showBetaAdapters`**. `App.svelte` consumes only
  `flags.maintenanceBanner` (App.svelte:1045). Beta adapters always participate in auto-detection
  regardless of the flag, so the admin toggle does nothing and the flags.ts:11 comment ("gates the
  import picker's beta adapters") is false. Owner decision: either wire the flag (gate beta-adapter
  detection / the preview-confirm) or retire the flag + admin row + stale comment (retiring touches the
  Worker `DEFAULTS.flags` and the `scripts/test-flags.mjs` mirror, A14). Admin-only, so low blast
  radius, but it is a control that renders and does nothing.

### P3

- **A### — F49 popover / editable-cell scaffolding is copy-duplicated.** `DatePickerPopover.svelte:92`,
  `SymbolSelect.svelte:73-75`, and the plain cell button `TradeEditor.svelte:268` share a byte-identical
  trigger `<button {...props} type="button" class={cn('block w-full rounded px-1.5 py-1 text-sm
  hover:bg-accent', className)}>`; DatePickerPopover and SymbolSelect additionally repeat the same
  `open` state + reset-on-open `$effect` + `Popover.Root bind:open`→`Trigger`→`child` snippet→`Content
  align="start"` + close-on-select shell (DatePickerPopover.svelte:26,40-46,68 ↔ SymbolSelect.svelte:22,27-33,48).
  Extract a small `EditableCellPopover` primitive owning the trigger + open/reset/close-on-select; leave
  the grid-vs-list content per component.

- **A### — single-source formatter/constant drift (A29).** Three small local re-implementations of
  things the core already owns: `Account.svelte:53-54` `fmtMoney` re-does whole-dollar USD formatting
  that `usdWhole`/`usd` own (`core.ts:388-401`); `Changelog.svelte:44` `MONTHS = ['Jan'..'Dec']` is a
  verbatim copy of `MONTH_ABBR` (`core.ts:56`) — and `format.ts` proves the site can import shared
  modules (Admin.svelte:9); `xlsx.ts:229` CSV-quote `esc` duplicates the quoting half of
  `App.svelte:642-645` `esc` with no shared `csvCell()` helper. Consolidate.

- **A### — CLAUDE.md repo-layout drift (R23 missed).** The prose + Repo-layout block are stale against
  today's tree: `parts/` lists only CostSetup/Onboarding/ActivityTerminal/Definitions/StatusBanner but
  12 more exist (BootSplash, DashTabs, DatePickerPopover, DetectionStatus, FeedbackDialog, LaunchGate,
  ModuleCarousel, PaginationControls, ScreenshotLightbox, SegmentedControl, SymbolSelect, TagInput);
  `screens/` omits `Account`; `app/lib/` omits `account.svelte.ts`, `batch.ts`, `pagination.svelte.ts`,
  `flavor.ts`, `motion.ts`; the core file list omits `xlsx.ts`. (The bundle ceiling at CLAUDE.md:373 is
  correct — 840 KiB.) A doc-only refresh.

- **A### — accounts posture hardening (low / accepted-risk batch).** Three low-severity items on the new
  backend: (1) `register-options` returns 409 "an account with that email already exists"
  (`register-options.ts:55`), leaking account existence on the signup path, while `recover-send` is
  deliberately enumeration-safe — likely a by-design passwordless-signup tradeoff, but worth an explicit
  decision. (2) `email-verify-confirm` GET consumes the single-use `verify` token
  (`email-verify-confirm.ts:60`), so an email link-prefetcher/scanner can burn it before the user clicks
  (harmless for `verify` since it performs the intended action, but the user's later click shows
  "expired"). (3) The webhook credits donor status even when `amount_total` is 0/absent
  (`webhook.ts:75,102`), and `applyDonationToUser` sums `donation_total_cents` across currencies without
  a currency check (`accounts.ts:378`). Decide/guard each.

- **A### — quality cleanup batch (trivia).** Fold together: dead flag `betaRibbon` (never read; App.svelte:912
  says it's superseded by the version-based Beta pill) and the stale `flags.ts:11` comment; unused
  `MeResponse.tier`/`cloudSync` fields (`account.svelte.ts:31-32`); the repeated
  "index `csvFiles` by id → scan `t.fileIds`" idiom implemented three times with different payloads
  (`App.svelte:578-586` platform, `dashboard.svelte.ts:94-99` broker, `:313-321` reconcile family) that
  a `resolveFromFiles(t, pick)` helper could own; `motion.ts:5` `REDUCED_MOTION` frozen at module load
  (a mid-session `prefers-reduced-motion` change is ignored); the untyped-at-runtime `api<T>` fetch
  boundary (`account.svelte.ts:51-63`, `data as T` with no schema check); and the local `family =
  id => id.split('-')[0]` splitter (`dashboard.svelte.ts:313`) that arguably belongs in `adapters.ts`.

## Disposition

No P1 — the moat, CSP, demo non-mutation, and the new accounts auth surface are all intact and, for
accounts, unusually well tested. Findings filed as new backlog items (see PR). R1 stays open (recurring).
</content>
</invoke>
