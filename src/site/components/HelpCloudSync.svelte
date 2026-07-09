<script lang="ts">
  // Help > Cloud sync (A273 — new user-facing content). Explains the opt-in, end-to-end encrypted
  // multi-device sync feature (F58–F63, live on prod + staging since CH16, 2026-07-07; never demo) in
  // plain language. Facts sourced from docs/synced-workspaces.md + docs/cloud-sync-ux-a279.md and the
  // real setup UI (src/app/parts/CloudSyncSetup.svelte, WorkspaceSwitcher.svelte) — rewritten for
  // traders, not engineers. Shared chrome from HelpShell.
  import HelpShell from '../lib/HelpShell.svelte';
  // ARCHIVE FREEZE (docs/archive-freeze.md): the shared freeze flag — drives the banner below. See
  // src/lib/archive.ts for the full explanation + revert instructions.
  import { ARCHIVED, ARCHIVE_NOTE } from '$lib/archive.ts';
</script>

<HelpShell active="cloud-sync">
  <p class="eyebrow">Blotterbook Help</p>
  <h1>Cloud sync</h1>
  {#if ARCHIVED}
    <!-- ARCHIVE FREEZE (docs/archive-freeze.md): cloud sync is paused for new users — the article
         below (nothing else gated) still describes the frozen feature as it exists for anyone who
         already has it. -->
    <div class="note warn" data-testid="archived-note">
      <b>Cloud sync is paused while Blotterbook is archived.</b> New signups and subscriptions aren't available. The article below describes the
      frozen feature as it exists today.
    </div>
  {/if}
  <p class="blurb">
    Blotterbook is local-first by default — your trades never leave your browser. <b>Cloud sync</b> is an optional, paid add-on that lets you
    use Blotterbook on more than one device, while keeping the same "we can't read your data" guarantee.
  </p>

  <section id="cs-overview" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">How it works, in plain language</h2>
    <p>
      Sync is <b>opt-in and per workspace</b> — turning it on for one workspace doesn't sync any others. When it's on, every trade, journal
      note, tag, and saved filter is <b>encrypted on your device before it ever leaves the browser</b>. Our server only ever stores that
      scrambled ciphertext in a bucket next to a little bit of bookkeeping (record counts, timestamps, sizes) — it never sees your symbols,
      P&amp;L, notes, screenshots, or tags, and it never sees a key that could decrypt them.
    </p>
    <p>
      Your other devices download the same ciphertext and decrypt it locally with the same key, then merge it into their own copy the same
      way importing a backup file works. If you're offline, everything keeps working from the local copy — sync just catches up once you're
      back online.
    </p>
  </section>

  <section id="cs-two-secrets" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">Two different secrets: signing in vs. decrypting</h2>
    <p>It helps to keep these apart — Blotterbook's Account screen names them separately on purpose:</p>
    <ol class="steps">
      <li>
        <b>Signing in</b> — your <b>passkey</b> proves who you are to our server, the same as any passkey login. It does not, by itself, let you
        read your synced data.
      </li>
      <li>
        <b>Decrypting your data</b> — a separate secret (a <b>passphrase</b>, your downloaded <b>recovery key</b>, or a passkey that
        supports it) turns the downloaded ciphertext back into readable trades, <b>inside your browser</b>. You're asked for it once per
        browser session, as a step of whichever sync action needs it — like turning sync on.
      </li>
    </ol>
    <p>
      Some passkeys can do both at once — sign you in <i>and</i> decrypt your data in a single tap. Whether yours can depends on your device and
      browser; if it can't, Blotterbook falls back to your passphrase.
    </p>
  </section>

  <section id="cs-recovery-key" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">The recovery key</h2>
    <p>
      When you set up cloud sync, Blotterbook generates <b>one recovery key for your whole account</b> and shows it to you exactly
      <b>once</b>, with a download/copy button. This key is the guaranteed way back into your encrypted data — keep it somewhere safe (a
      password manager, a printed copy in a drawer) the same way you'd keep a crypto-wallet seed phrase.
    </p>
    <div class="note warn">
      <b
        >If you lose every passkey and your passphrase and this recovery key, your cloud-synced data cannot be recovered — by you or by us.</b
      > Blotterbook never sees the key in the clear, so there is no "forgot my recovery key" reset. Your local copy in the browser you're currently
      using always survives, though; only the encrypted cloud copy (and any device that hasn't synced yet) becomes unreachable.
    </div>
    <p>
      You don't need to generate a new recovery key when you add a workspace or a new device — the one key covers your whole account. Adding
      a new passkey later re-enables decryption from that device, as long as you still have a device where sync is already running, your
      passphrase, or the recovery key handy to authorize it.
    </p>
  </section>

  <section id="cs-subscribe" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">Subscribing</h2>
    <p>
      Cloud sync is a <b>$5/month</b> subscription, billed by Stripe. Everything else in Blotterbook — importing, the dashboard, the
      calendar, cost &amp; tax modeling, local backups — stays free with or without it. Subscribe from
      <a href="/account.html">your Account page</a> ("Get cloud sync"); cancelling keeps sync active until the end of the period you already paid
      for, and a failed payment gets a short grace window before sync pauses. Your local data is never affected by billing status — only whether
      it keeps syncing to the cloud.
    </p>
  </section>

  <section id="cs-enable" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">Enabling sync for a workspace</h2>
    <p>Once you're subscribed, set up encryption and turn sync on from inside the app (<b>Account</b> screen):</p>
    <ol class="steps">
      <li>Open <b>Set up cloud sync</b> and generate your recovery key — download or copy it, and confirm you've saved it.</li>
      <li>Optionally add a passphrase, for browsers where your passkey can't decrypt your data directly.</li>
      <li>
        Switch to the workspace you want synced (the workspace switcher in the sidebar) and choose <b>Enable sync</b>. Other workspaces stay
        local-only unless you enable them too.
      </li>
      <li>
        On a second device, sign in and turn on sync — you'll be asked for your passphrase or recovery key (or a compatible passkey) as part
        of that step, and the workspace pulls down automatically.
      </li>
    </ol>
    <p>
      A status pill in the sidebar and on the Account page shows where things stand — <i>in sync</i>, <i>syncing</i>, <i>pending</i> (local
      edits not pushed yet), <i>needs your passphrase</i>, or <i>offline</i> — plus a <b>Sync now</b> action, and separate
      <b>Pull from cloud</b>
      /
      <b>Push to cloud</b> / <b>Pause sync</b> controls on the Account page if you ever want more direct control. When two devices edited the
      same note or tag differently, the newest edit wins; trades themselves never conflict, since importing the same trade twice always converges
      to one record.
    </p>
  </section>

  <section id="cs-multi-device" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">Using multiple devices</h2>
    <p>
      A synced workspace behaves like a shared, private notebook: import a CSV on your desktop, and it shows up on your laptop without
      re-uploading it there. Deleting a trade on one device removes it everywhere (deletes sync too, so re-importing the same file later
      won't bring it back). Local, un-synced workspaces stay exactly that — local to the device they're on.
    </p>
  </section>

  <section id="cs-zero-knowledge" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">The zero-knowledge guarantee</h2>
    <p>
      "Zero-knowledge" means our server is a dumb, encrypted storage bucket — it cannot decrypt your trades under any circumstance,
      including a legal request, a database breach, or an employee mistake, because it never holds the key. Only ciphertext and
      one-way-scrambled identifiers cross the network; the actual merging of your data happens on your own devices, the same trust boundary
      as restoring a local backup file. This is a refinement of Blotterbook's original promise — compute and plaintext still never touch the
      network on any tier — not a change to it. See the <a href="/legal.html#privacy">Privacy Policy</a> for the full, formal accounting of what
      leaves your browser and when.
    </p>
  </section>

  <p class="endnote">
    Questions about cloud sync specifically, or anything else? See <a href="/help/support.html">Support</a>.
  </p>
</HelpShell>
