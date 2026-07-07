# Tauri desktop/mobile shell — wrap or stay a browser app? (A275)

**Decision record, 2026-07-07.** Closes backlog **A275** (the shell-feasibility discussion the
Phase-3 line in [`vault-storage-assessment.md`](vault-storage-assessment.md) defers to). Question:
should Blotterbook be wrapped in — or migrated to — a **Tauri** shell for cross-platform desktop /
mobile distribution, and if so, when does that earn its weight?

> **What Tauri is, for an owner who hasn't used it.** Tauri is a Rust framework that packages a web
> app as a native desktop/mobile binary. Unlike Electron (which ships a whole Chromium + Node runtime,
> ~100–200 MB per app), Tauri renders your existing HTML/JS in the **operating system's own webview**
> (WKWebView on macOS/iOS, WebView2/Edge on Windows, WebKitGTK on Linux, Android System WebView) and
> pairs it with a small Rust binary for anything the web can't do — real filesystem, OS integration,
> auto-update. The result is a 3–10 MB installer. **Your `dist/` bundle is the frontend, verbatim** —
> Tauri does not replace Vite/Svelte; it embeds their output. Tauri **v2 (stable since late 2024)**
> adds iOS + Android as first-class targets alongside the desktop three.

## Why a shell is attractive

Everything the "hard browser constraints" table in the vault assessment lists as *impossible in a web
app* becomes trivial in a shell:

- **A real filesystem — this is the headline.** The Phase-3 "shell-native vault" that
  `vault-storage-assessment.md` parks is exactly what a shell unlocks: Tauri's FS + dialog plugins give
  a `VaultStore` genuine read/write to a user-chosen folder on **every** OS (not Chromium-desktop-only,
  which is where the File System Access API leaves us today). The vault stops being a
  Chromium-only enhancement and becomes the natural default. Folder-watching (external edits →
  merge-on-load) works too.
- **No browser storage eviction.** IndexedDB can be evicted under storage pressure or wiped by "Clear
  site data"; a trader who clears their browser loses their journal. A shell writes to a durable app
  data directory (or the vault) that the browser's eviction heuristics never touch.
- **OS integration** the browser gates or forbids: native menus, a dock/taskbar presence, global
  shortcuts, file-type associations (double-click a `.csv` export → opens in Blotterbook), system
  notifications, tray, "open at login."
- **Offline packaging.** The app installs once and runs with no server round-trip for the shell
  itself. (Blotterbook's *compute* is already 100% offline — see below — so this is about not needing
  a page load, plus reference-data can be bundled.)
- **App-store presence.** Mac App Store, Microsoft Store, and — via Tauri v2 mobile — the iOS App Store
  and Google Play. That's a distribution + credibility channel a URL can't occupy, and the only way to
  get a real iOS/Android app short of a separate native build.

## The critical context: Blotterbook barely needs a server

Most "why go native" arguments are about escaping the browser sandbox for compute or storage. **We
already escaped the important half.** Per ADR-001 and `architecture.md`, *compute is 100% local on
every tier and never touches the network*; the only egress is the staging-gated, ciphertext-only
cloud-sync path. So a shell buys us **storage durability + OS reach**, not "unlock the product." That
reframes the whole decision: this is a *distribution* investment, not an *architecture* one. The
core (`src/lib/core/`) and the `Store` seam were built for exactly this kind of swap and don't move.

## Pros / cons vs. the alternatives

### vs. staying a pure PWA / browser app

| | Browser / PWA (today) | Tauri shell |
| --- | --- | --- |
| Distribution | A URL. Zero install friction, zero per-OS build. | Download + install (or store listing) per OS. |
| Updates | Instant — deploy `dist/`, every user has it on reload. | Ship a new binary; auto-updater delivers it, but users must relaunch (and stores gate mobile updates behind review). |
| Storage durability | IndexedDB — evictable, wipeable with site data. | Real FS / app-data dir — durable. |
| Filesystem / vault | FSA is Chromium-desktop-only; else download-blob. | Real FS on all platforms. |
| Passkeys / WebAuthn | **Works** (first-class browser API). | **Broken in the webview — needs a plugin bridge** (see §4). |
| Stripe Checkout redirect | **Works** (full navigation). | Needs a deep-link / external-browser dance (see §4). |
| Maintenance | One target. | A **second** target: Rust toolchain, signing, notarization, per-OS CI, store accounts. |
| Reach | Every device with a browser, including where installs are blocked. | Named desktop OSes + app stores; a real mobile app. |

The honest summary: a PWA already delivers "installable, offline, home-screen icon, own window" with
**none** of the signing/toolchain/second-target cost. It does *not* deliver a real filesystem, durable
storage, or store presence. So the browser stays strictly better until one of those three specifically
earns the shell.

### vs. Electron

Electron bundles its own Chromium+Node, so binaries are ~100–200 MB, memory use is heavy, and it's
desktop-only (no mobile). Its one genuine edge — a **consistent** Chromium engine everywhere — matters
for apps that depend on bleeding-edge web features; Blotterbook is a Svelte SPA that already targets
the broad browser matrix, so we don't need that guarantee. For a privacy-positioned product, Electron's
bundled Node runtime is also a larger attack/supply-chain surface. **Tauri dominates Electron for our
profile** (tiny binary, lower memory, mobile targets, smaller surface); the only cost is that we render
in each OS's webview and must test against WKWebView/WebView2/WebKitGTK differences instead of one
Chromium.

### vs. Capacitor

Capacitor (Ionic) is the mobile-first analogue: it wraps the web app in a native **mobile** shell
(iOS/Android) with a plugin bridge, and has a desktop story via Electron. If the goal were *"an
iOS/Android app, fast, and desktop is an afterthought,"* Capacitor is the more mature mobile path and
its passkey/WebAuthn plugin story is further along. Tauri v2's advantage is a **single** Rust/webview
model spanning desktop **and** mobile with tiny binaries, so we don't run two shell stacks. Given
Blotterbook is a data-dense **desktop-leaning** dashboard (calendar, blotter table, multi-panel
analytics) whose users mostly sit at a trading desk, desktop-first-with-mobile-optional favors Tauri.
Capacitor would be the pick only if mobile were the primary target.

**Bottom line on alternatives:** if we ship a shell at all, it's **Tauri**. Electron loses on
size/mobile/surface; Capacitor wins only under a mobile-first mandate we don't have.

## Implementation difficulty — what actually changes

The good news is structural: **Vite/Svelte embeds in Tauri almost for free.** Tauri points at
`npm run build` and serves `dist/` inside the webview; `beforeDevCommand`/`beforeBuildCommand` wire to
our existing scripts. The multi-page nature of our build (10 HTML entries) is a wrinkle — Tauri expects
a frontend "dist dir" and a dev URL — but the app surface is what we'd ship in the shell (`app/app.html`
as the window's entry), with the marketing site staying on the web. No source files move. The friction
is entirely at the **web-platform seams** we lean on:

**1. The `Store` seam / IndexedDB vs. native FS — clean, and the payoff.** `StoreLike` is already the
only persistence contract, and the webview still *has* IndexedDB, so **the app runs in Tauri unchanged
on day one** — same `Store`, same DB. The upgrade is additive: implement the `VaultStore` (or an
`FsStore`) that `vault-storage-assessment.md` sketches, backed by Tauri's FS plugin, and select it at
boot the same way `Entitlements.storeFor()` picks `DemoStore`/`CloudStore` today. The write-behind
buffer that doc recommends (IndexedDB as cache, files as durable copy) is the right shape here too. This
is the single cleanest part of the whole port — the seam was designed for it.

**2. The `/functions` edge layer — keep it as a remote API (do NOT bundle a backend).** In a Tauri app
there are three options for the server tier: (a) keep calling the **same remote Cloudflare Pages
Functions** over HTTPS; (b) bundle a **local** backend (Tauri's Rust "commands" or a sidecar); (c) drop
the server entirely. For Blotterbook the answer is clearly **(a)**: `/api/me` (entitlements), `/api/sync/*`
(the encrypted-blob transport), `/api/checkout` + `/api/webhook` (Stripe), and the account endpoints are
*inherently* server-side (identity, billing, cross-device sync) and must stay one shared backend across
web and shell — you can't run Stripe webhooks or a sync change-index on the client. So the shell just
points its API base at the deployed origin. **This is where the seams bite, though**, because those
functions are hardened with **same-origin assumptions** (`__Host-` session cookies, `Origin` checks on
every mutation, `connect-src 'self'`) — and a webview's origin is *not* our web origin (see next two
points).

**3. CSP inside a webview — mostly portable, one required change.** Our `_headers` CSP
(`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; …`)
is served by Cloudflare for the web app. In Tauri, CSP is set in `tauri.conf.json` and applied to the
webview instead; we'd port the same policy. Two real deltas:
   - **`connect-src 'self'` must widen** to the deployed API origin (e.g. `connect-src 'self'
     https://blotterbook.com`), because in the shell the frontend origin is `tauri://localhost` /
     `https://tauri.localhost` (platform-dependent) while the API lives on our real domain — those are
     now cross-origin. This is a genuine loosening of the tightest line in our CSP and should be scoped
     to exactly the API host, nothing wildcard.
   - **`'wasm-unsafe-eval'` is still needed** (Argon2id via `hash-wasm` on the cloud-sync path) and
     ports directly. Tauri's webviews support WASM compilation; keep the allowance wasm-narrow exactly
     as today.
   - `style-src 'self'` / `script-src 'self'` hold — our no-inline discipline (S18/A55) already means
     nothing depends on `'unsafe-inline'`, so the CSP travels intact apart from `connect-src`.

**4. WebAuthn / passkeys in a webview — the real gotcha. Research it before committing.** This is the
sharpest edge and it hits a shipped feature (F53 passkey accounts). **Native WebAuthn does not work
inside Tauri's webview**: the OS webviews don't expose `navigator.credentials.create/get` to embedded
content the way a top-level browser does, and even where an API is present, the **relying-party (RP)
ID / origin check fails** because the webview origin (`tauri://localhost`) isn't our registered RP
origin. The community path is the third-party **`tauri-plugin-webauthn`**, which bridges to the OS's
native FIDO2/WebAuthn APIs and is *nearly* a drop-in for `@simplewebauthn/browser` — but "nearly": you
must **pass the origin explicitly** to register/authenticate, Linux needs a PIN event-handler the other
platforms don't, and you've now taken a dependency on a non-official plugin for your **auth** path. And
crucially, our passkeys are registered against our **web** RP ID; making them work in the shell means
either (i) accepting associated-domains / app-attestation plumbing so the platform authenticator treats
the shell as the same RP, or (ii) a shell-specific enrollment. None of this is a blocker, but it's
**bespoke work on the account path**, not a config flag — and it's the item most likely to be
underestimated. *Mitigation:* the shell can fall back to the existing email **recovery / magic-link
re-enrollment** flow (F55) for identity, and passkeys-in-shell becomes a later, isolated slice.

**5. Deep-links for the Stripe return — solvable, needs wiring.** On the web, Stripe Checkout is a full
navigation and returns via a redirect URL — "no CSP change needed" per our own `_headers`. In a shell
you don't want Checkout *inside* the webview (PCI surface, and the redirect would land on
`tauri://localhost`). The pattern is: open Checkout in the user's **real browser** (Tauri's shell/opener
plugin), and have Stripe's success URL deep-link **back** into the app via a **custom URL scheme**
(e.g. `blotterbook://checkout-complete`) registered by the deep-link plugin. That's a well-trodden
Tauri pattern but it's net-new plumbing (scheme registration per OS, a handler that re-focuses the
window and re-checks `/api/me`). Same mechanism would serve the F55 email magic-links, which today
302 back to `/app/app.html` — in the shell those must deep-link too.

Net: **the app body ports nearly for free; the identity/billing/sync *seams* are where the weeks go.**

## How dev / build / release / CI change

This is the part an owner unfamiliar with Tauri under-weights. Adding a shell adds a **whole second
release pipeline** on top of the Cloudflare Pages one:

- **Rust toolchain.** Contributors and CI now need Rust + platform SDKs (Xcode for macOS/iOS, the
  Android NDK/SDK for Android, WebView2 + MSVC/Windows SDK for Windows, WebKitGTK dev packages for
  Linux). The `dist/` build stays Node/Vite; the *packaging* step is Rust.
- **Per-OS builds — you cannot cross-compile freely.** macOS/iOS artifacts must be built on macOS;
  Windows on Windows; iOS needs Xcode. That means a **matrix CI** (GitHub Actions runners:
  `macos-latest`, `windows-latest`, `ubuntu-latest`, plus mobile lanes) — 4–6 build lanes vs. today's
  single Linux Pages build.
- **Code signing + notarization — recurring cost and friction.**
  - *macOS:* an Apple Developer account (**$99/yr**), a Developer ID cert, **and notarization** (submit
    the signed build to Apple, staple the ticket) or Gatekeeper blocks it. iOS additionally *requires*
    signing on-device and App Store review.
  - *Windows:* an Authenticode cert (OV or an EV/ hardware-token cert to avoid SmartScreen warnings) —
    an annual cost and an HSM/token workflow.
  - *Android:* a signing keystore; Play Store listing + review.
  - Certs are **secrets in CI** (keychains, tokens, provisioning profiles) — a real secret-management
    and rotation burden, and a security surface for a privacy product.
- **Auto-update infrastructure.** Tauri's updater plugin needs a hosted update manifest + signed
  release artifacts (its own signing keypair, separate from OS code-signing) and a place to serve them
  (could be Cloudflare, reusing our infra). You now version, sign, publish, and roll back **binaries** —
  a heavier release than "git push → Pages deploys." Mobile store updates are gated behind **review
  latency** (days), so the "instant fix" property of the web app is *lost* on the shell.
- **The maintenance tax of a second target.** Every feature now needs a thought about "does this behave
  in WKWebView / WebView2 / WebKitGTK?" (older/embedded webview quirks), plus store-policy compliance,
  plus the deep-link/passkey seams above. The e2e suite (Playwright against `dist/`) doesn't cover the
  packaged app — you'd want at least smoke tests per OS. Realistically this is **an ongoing part-time
  commitment**, not a one-off port.

For a solo/small owner with **no users on the shell yet**, that's the decisive cost: the web app keeps
its "deploy = shipped" superpower, and every hour on signing/notarization/store-review is an hour not
on the product.

## Recommendation — phased; browser stays primary

**Keep the browser app as the primary, canonical product. Treat a Tauri shell as an opt-in
distribution layer that ships only when a concrete trigger fires — and do the cheap, reusable pieces
first.** Nothing below requires a rewrite; each phase is independently valuable and the earlier phases
are worth doing *even if the shell never ships*.

1. **Phase 0 — PWA hardening first (small; do this regardless).** Before any Rust, capture most of the
   "native feel" from the web: a proper web-app manifest + installability, offline caching of the app
   shell + reference data (a service worker — the one piece we don't have), and request **persistent
   storage** (`navigator.storage.persist()`) to blunt IndexedDB eviction. This delivers "installable,
   offline, durable-ish" to *every* platform with zero second-target cost, and it sharpens the question
   of what's genuinely left that only a shell can do (answer: real FS, store presence, un-evictable
   storage). **Recommended now.**
2. **Phase 1 — Tauri desktop spike behind a flag (small–medium, ~3–5 days).** Prove the embed: a
   `tauri.conf.json` pointing at `npm run build` + `dist/`, the app booting in the desktop webview on
   one OS, the ported CSP (with `connect-src` widened to the API origin), and `/api/me` +
   read-only flows working against the **live** remote functions. Deliberately *stop* before signing,
   mobile, passkeys, and the vault. This tells us the real integration cost with almost no sunk
   investment, and produces an unsigned dev binary for the owner to feel.
3. **Phase 2 — the shell-native vault (medium).** Implement `VaultStore` over Tauri's FS plugin — the
   Phase-3 payoff from `vault-storage-assessment.md`, now the *default* durable store in the shell
   (write-behind over IndexedDB, merge-on-load through the existing `importAll` trust boundary). This is
   the first feature the shell does that the web app **structurally cannot** on all platforms, and it's
   the strongest single reason to ship one. Still desktop-only; still unsigned/dev.
4. **Phase 3 — productionize desktop: signing, notarization, updater, CI matrix (medium–large).** Only
   once Phases 1–2 prove the value: Apple Developer + Windows cert, notarization, the updater channel,
   the multi-OS GitHub Actions matrix, and the Stripe **deep-link** return + magic-link deep-links. This
   is the phase that turns a spike into a shippable product and carries the recurring cost — commit to it
   only with intent to maintain it.
5. **Phase 4 — passkeys-in-shell, then mobile (large; each gated on demand).** Tackle the WebAuthn
   webview gotcha (the `tauri-plugin-webauthn` bridge + RP-ID/associated-domains work, or ship the shell
   with email-recovery identity and passkeys web-only). **Mobile (iOS/Android) is its own initiative** —
   app-store accounts, review, mobile signing, *and* a genuine responsive-layout pass on a
   desktop-dense dashboard — and should be a separate go/no-go, not a rider on the desktop shell.

**Trigger for starting Phase 1+:** a real, repeated user demand for (a) durable local storage that
survives "clear browsing data," (b) a real filesystem vault, or (c) app-store presence — that Phase-0
PWA work cannot satisfy. Absent that signal, **stay browser-only**; the shell is a standing option, not
a backlog obligation.

**Not recommended:** Electron (loses on size/mobile/surface); a **bundled local backend** in the shell
(the server tier is inherently remote — keep one shared Cloudflare Functions API); making the shell the
*primary* product (it forks distribution and forfeits "deploy = shipped"); or shipping mobile as an
afterthought of the desktop shell (it's a distinct responsive + store investment).

## Done-when check (A275)

Feasibility assessed against **this** app's real architecture: the `Store` seam ports cleanly (IndexedDB
works in-webview day one; `VaultStore` is the additive win), the `/functions` edge layer stays a shared
**remote** API (not bundled), the CSP travels intact except a scoped `connect-src` widening, and the two
sharp seams — **WebAuthn/passkeys are broken in the webview** (needs the `tauri-plugin-webauthn` bridge +
RP-ID work) and the **Stripe/magic-link returns need custom-scheme deep-links** — are called out as the
places effort concentrates. Tauri beats Electron (size/mobile/surface) and Capacitor (single
desktop+mobile stack for a desktop-leaning app) for our profile; the dev/build/release cost is a full
**second pipeline** (Rust toolchain, per-OS matrix, signing + notarization, updater, store review) with
ongoing maintenance. **Recommendation: browser stays primary; do the free PWA hardening now (Phase 0),
then a low-cost desktop spike (Phase 1, ~3–5 days) only when durable-storage / real-vault / app-store
demand actually materializes, and add signing/mobile/passkeys strictly on demand.** Rough effort to a
*shippable, signed desktop app with the native vault*: on the order of **3–6 focused weeks** plus the
recurring cert/store/notarization overhead; mobile is a separate multi-week initiative on top.
