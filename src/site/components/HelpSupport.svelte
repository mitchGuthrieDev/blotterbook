<script lang="ts">
  // Help > Support (A273 — new content). Contact + bug-report guidance + pointers to Roadmap/Changelog
  // for known issues and recent ships. Shared chrome from HelpShell.
  import HelpShell from '../lib/HelpShell.svelte';
  // ARCHIVE FREEZE (docs/archive-freeze.md): the shared freeze flag — annotates the Account & billing
  // section below. See src/lib/archive.ts for the full explanation + revert instructions.
  import { ARCHIVED } from '$lib/archive.ts';
</script>

<HelpShell active="support">
  <p class="eyebrow">Blotterbook Help</p>
  <h1>Support</h1>
  <p class="blurb">
    Stuck on something, or think you found a bug? Here's how to reach us — and how to check first whether it's already known.
  </p>

  <section id="sup-check-first" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">Check first</h2>
    <p>Two quick stops before writing in — your question might already be answered:</p>
    <ul>
      <li><a href="/roadmap.html">Roadmap</a> — what's shipped, what's in progress, and what's planned next.</li>
      <li><a href="/changelog.html">Changelog</a> — the version-by-version list of what actually changed, most recent first.</li>
      <li>
        <a href="/help/getting-started.html">Getting started</a> and <a href="/help/import.html">Importing your trades</a> — the setup walkthrough
        and per-platform export steps.
      </li>
    </ul>
  </section>

  <section id="sup-contact" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">Contact us</h2>
    <p>
      For anything else — a bug, a misparsed CSV, a question, or general feedback — email
      <a href="mailto:contact@blotterbook.com?subject=Blotterbook%20support">contact@blotterbook.com</a>. We read every message.
    </p>
    <div class="note warn">
      <b>Please never email us a CSV, a screenshot of your trades, or any other trade data.</b> Blotterbook is built so your trade data never
      has to leave your browser, and support never needs it to help you — describe the problem in words (see below) and we'll work it out together.
      If a parsing bug needs a real file to reproduce, we'll ask you to redact or synthesize a sample first.
    </div>
  </section>

  <section id="sup-bug-report" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">What to include in a bug report</h2>
    <p>The fastest way to get a fix is a report we can reproduce. Please include:</p>
    <ol class="steps">
      <li>
        <b>Platform</b> — which trading platform you trade on (TradingView, Tradovate, ATAS X, …) and which export type you used (see the
        list in <a href="/help/import.html">Importing your trades</a>).
      </li>
      <li>
        <b>CSV source</b> — where the file came from (export type, roughly how many rows, any special characters in the account/symbol names)
        — not the file itself.
      </li>
      <li><b>Steps</b> — what you clicked, in order, and what you expected vs. what actually happened.</li>
      <li>
        <b>Browser &amp; device</b> — e.g. "Chrome on macOS," "Safari on iPhone" — parsing and cloud-sync unlock behavior can be browser-specific.
      </li>
    </ol>
    <p>
      For a <b>cloud sync</b> question specifically, see <a href="/help/cloud-sync.html">Cloud sync</a> first — most "my data isn't showing up
      on my other device" cases are one of: the workspace isn't enabled for sync on both devices, or the second device hasn't unlocked encryption
      yet this session.
    </p>
  </section>

  <section id="sup-account" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">Account &amp; billing</h2>
    <p>
      Manage your passkeys, recovery email, and cloud-sync subscription from <a href="/account.html">your Account page</a>. Donations and
      subscriptions are processed by Stripe and are covered by the <a href="/legal.html#donations">Donations &amp; Refund Policy</a> and the
      rest of the <a href="/legal.html">Legal &amp; Disclaimers</a> page.
      {#if ARCHIVED}
        <!-- ARCHIVE FREEZE (docs/archive-freeze.md): one appended sentence — the Account page itself
             now shows an archived notice instead of the live dashboard. -->
        <b>Blotterbook is currently archived:</b> that page shows an archived notice rather than the live dashboard — see it for options if you
        have an existing account.
      {/if}
    </p>
  </section>
</HelpShell>
