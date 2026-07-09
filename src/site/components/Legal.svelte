<script lang="ts">
  // Legal & disclaimers (A69 — ex legal.html static markup). Pure content; all styles come from the
  // shared SiteShell (.wrap/typography/.note). No page-specific CSS or client logic.
  //
  // F18 legal pack + A202 arbitration clause — counsel-reviewed and in effect as of 2026-07-06.
  // Seller identity is consistent everywhere: "Blotterbook, operated by an individual sole
  // proprietor." Governing law / arbitration venue: Delaware. Privacy/legal contact:
  // privacy@blotterbook.com. Update the Effective date below when the terms materially change.
  import SiteShell from '../lib/SiteShell.svelte';
  // ARCHIVE FREEZE (docs/archive-freeze.md): the counsel-reviewed terms below are NOT edited while
  // archived — a status note up top corrects the operative facts (no account needed to launch; new
  // accounts/subscriptions paused) without touching reviewed language.
  import { ARCHIVED } from '$lib/archive.ts';
</script>

<SiteShell active="legal">
  <p class="eyebrow">The Fine Print</p>
  <h1>Legal &amp; Disclaimers</h1>
  <p class="blurb">
    Blotterbook is a private trading <b>journal and cost/tax estimation tool</b>, operated by an individual sole proprietor. This page holds
    the disclaimers, Terms of Service, binding-arbitration agreement, Privacy Policy, and donation terms. Please read them before relying on
    anything the app shows you. Last updated July&nbsp;2026.
  </p>

  {#if ARCHIVED}
    <!-- ARCHIVE FREEZE (docs/archive-freeze.md): status note only — the reviewed terms below are unedited. -->
    <div class="note warn" data-testid="archived-note">
      <b>Archived-status note (July 8, 2026):</b> Blotterbook is archived. While archived, launching the app requires <b>no</b> account, and new
      accounts, subscriptions, and donations are paused — references below to account-gated launch, subscriptions, or checkout describe the pre-archive
      service and apply only to accounts that already exist. Everything else on this page remains in effect.
    </div>
  {/if}

  <!-- F18/A202: counsel-reviewed and in effect. Update the Effective date when terms materially change.
       2026-07-08 (docs audit): the Privacy Policy gained the cloud-sync section (E2E ciphertext egress,
       live since GA) + subscription billing wording — factual as-built updates; flag for counsel review. -->
  <p class="text-[13px] text-muted-foreground"><b>Effective date:</b> July 8, 2026.</p>

  <div class="note warn">
    <b>Not a broker. Not advice.</b> Blotterbook does not execute trades, hold funds, or route orders, and it is not a broker-dealer, futures
    commission merchant, investment adviser, accountant, or tax advisor. Nothing it displays is financial, investment, legal, or tax advice or
    a recommendation to buy or sell anything.
  </div>

  <h2 id="disclaimer">Disclaimer</h2>
  <ul>
    <li>
      <b>Estimates, not statements of record.</b> Commissions, exchange/clearing/NFA fees, data-feed costs, Section&nbsp;1256 tax figures,
      P&amp;L, drawdown, and all other numbers are <b>modeled estimates</b> derived from editable reference data and from the CSV you provide.
      They can drift from your broker's actual statements and your real tax liability.
    </li>
    <li>
      <b>Tax figures are illustrative.</b> The Section&nbsp;1256 model (a blended 60/40 federal rate plus a state top marginal rate) is a rough
      planning aid only. Tax law is complex and individual. Consult a qualified tax professional before filing or making decisions.
    </li>
    <li>
      <b>Imports may be imperfect.</b> Platform CSV adapters other than TradingView are marked <i>beta</i> and were built from documented formats;
      verify the parsed numbers against your own records. Hold-time and round-trip pairing for fills-based exports are best-effort.
    </li>
    <li>
      <b>Trading is risky.</b> Futures and other leveraged products carry substantial risk of loss. Past performance shown in your journal does
      not indicate future results.
    </li>
  </ul>

  <h2 id="terms">Terms of Service</h2>
  <p>
    These Terms of Service (the “Terms”) are a binding agreement between you and <b>Blotterbook</b>, a service operated by an individual
    sole proprietor (“Blotterbook,” “we,” “us,” or “our”). They govern your access to and use of the Blotterbook website, the browser
    application, the demo, and any related services (together, the “Service”).
  </p>

  <h3>1. Acceptance of these Terms</h3>
  <p>
    By accessing or using the Service — including creating an account to launch the app, importing data, or making a donation — you agree to
    these Terms and to the Privacy Policy and arbitration agreement below. If you do not agree, do not use the Service. We may update these
    Terms; material changes take effect when posted, and your continued use after an update constitutes acceptance.
  </p>

  <h3>2. Eligibility &amp; accounts</h3>
  <p>
    You must be of legal age to form a binding contract in your jurisdiction. Launching the app on the live site requires a free account
    secured by a passkey (there is no password); the public demo requires no account. You are responsible for maintaining access to your
    passkey and recovery email and for all activity under your account. Notify us promptly of any unauthorized use.
  </p>

  <h3>3. License to use the Service</h3>
  <p>
    Subject to these Terms, we grant you a personal, limited, non-exclusive, non-transferable, revocable license to use the Service for your
    own trading-journal and cost/tax-estimation purposes. The software is proprietary and all rights are reserved — see the
    <a href="https://github.com/mitchGuthrieDev/blotterbook/blob/main/LICENSE">LICENSE</a>. Viewing the source is permitted; copying,
    redistributing, reselling, or creating derivative works is not, absent our written permission. You retain all rights to the trade data
    you import — it stays in your browser, and this license grants us no ownership of it.
  </p>

  <h3>4. Acceptable use</h3>
  <p>You agree not to:</p>
  <ul>
    <li>
      use the Service for any unlawful purpose or in violation of any applicable law, regulation, or the terms of the platforms and brokers
      you export data from;
    </li>
    <li>
      reverse engineer, decompile, scrape, or attempt to derive source code except to the limited extent that applicable law expressly
      permits;
    </li>
    <li>probe, attack, disrupt, overload, or circumvent any security or access control of the Service or its edge functions;</li>
    <li>resell, sublicense, white-label, or commercially redistribute the Service or its reference data; or</li>
    <li>misrepresent the Service's estimates as statements of record, official tax advice, or brokerage confirmations.</li>
  </ul>

  <h3>5. Disclaimer of warranties</h3>
  <p>
    The Service is provided <b>“as is” and “as available,” without warranties of any kind</b>, whether express, implied, or statutory,
    including implied warranties of merchantability, fitness for a particular purpose, title, non-infringement, and accuracy. We do not
    warrant that the Service will be uninterrupted, error-free, or that any figure, estimate, import, or tax calculation it produces is
    accurate or complete. You use the Service, and rely on its output, at your own risk.
  </p>

  <h3>6. Limitation of liability</h3>
  <p>
    To the maximum extent permitted by law, in no event will Blotterbook or its operator be liable for any indirect, incidental, special,
    consequential, exemplary, or punitive damages, or for any trading losses, lost profits, lost data, or tax liabilities, arising out of or
    relating to your use of (or inability to use) the Service or reliance on any figure it produces — even if advised of the possibility of
    such damages. To the extent any liability is not excludable, our total aggregate liability for all claims relating to the Service will
    not exceed the greater of the amount you paid us (if any) in the twelve months before the claim, or US$50. Some jurisdictions do not
    allow certain exclusions, so parts of this section may not apply to you.
  </p>

  <h3>7. Your data &amp; responsibilities</h3>
  <p>
    You are responsible for the accuracy of the data you import, for keeping your own backups (local storage is per-browser and can be
    cleared), and for complying with the export terms of your platforms and brokers. Blotterbook stores your trade data only in your browser
    (for workspaces you opt into cloud sync, our servers additionally hold an end-to-end-encrypted copy we cannot read) — see the
    <a href="#privacy">Privacy Policy</a>.
  </p>

  <h3>8. Governing law &amp; venue</h3>
  <p>
    These Terms, and any dispute arising out of or relating to them or the Service, are governed by the laws of the <b>State of Delaware</b
    >, excluding its conflict-of-laws rules. Subject to the binding-arbitration agreement below, you and Blotterbook agree that any dispute
    not subject to arbitration will be brought exclusively in the state or federal courts located in <b>Delaware</b>, and you consent to the
    personal jurisdiction and venue of those courts.
  </p>

  <h3>9. Termination</h3>
  <p>
    You may stop using the Service at any time and delete your locally stored data from <b>Manage data</b>. We may suspend or terminate
    access for any violation of these Terms or to comply with law. Sections that by their nature should survive termination (including
    licensing restrictions, disclaimers, limitation of liability, arbitration, and governing law) survive.
  </p>

  <h2 id="arbitration">Binding Arbitration &amp; Class-Action Waiver</h2>
  <div class="note warn">
    <b>Please read this section carefully — it affects your legal rights.</b> It requires most disputes to be resolved by
    <b>binding arbitration</b>
    on an individual basis and waives your right to a jury trial and to participate in a class action. You may opt out within
    <b>30 days</b> as described below.
  </div>
  <h3>1. Agreement to arbitrate</h3>
  <p>
    You and Blotterbook agree that any dispute, claim, or controversy arising out of or relating to the Service, these Terms, the Privacy
    Policy, or any donation — whether based in contract, tort, statute, or otherwise — will be resolved by <b
      >final and binding arbitration</b
    >, rather than in court, except that either party may bring an individual claim in small-claims court if it qualifies, and either party
    may seek injunctive relief in court for infringement or misuse of intellectual property.
  </p>
  <h3>2. Rules &amp; venue</h3>
  <p>
    The arbitration will be administered by the <b>American Arbitration Association (AAA)</b> under its <b>Commercial Arbitration Rules</b>
    (and, where applicable, its Consumer Arbitration Rules). The arbitration will be governed by the laws of the <b>State of Delaware</b>,
    consistent with the Terms above, and the seat/venue of arbitration will be
    <b>Delaware</b> unless the parties agree otherwise or the applicable rules require a location convenient to a consumer. A single arbitrator
    will decide the dispute, and judgment on the award may be entered in any court of competent jurisdiction.
  </p>
  <h3>3. Class-action waiver</h3>
  <p>
    All claims must be brought in the parties' <b>individual capacity</b>, and not as a plaintiff or class member in any purported class,
    collective, consolidated, or representative proceeding. The arbitrator may not consolidate more than one person's claims and may not
    preside over any form of class or representative proceeding. If this class-action waiver is found unenforceable as to a particular
    claim, that claim (and only that claim) will be severed and heard in court.
  </p>
  <h3>4. 30-day opt-out</h3>
  <p>
    You may opt out of this arbitration agreement within <b>30 days</b> of first accepting these Terms by emailing
    <a href="mailto:privacy@blotterbook.com?subject=Arbitration%20opt-out">privacy@blotterbook.com</a> with the subject “Arbitration opt-out”
    and your account email. Opting out will not affect any other part of these Terms. If you opt out, disputes will be resolved in the Delaware
    courts as described under Governing law &amp; venue.
  </p>

  <h2 id="privacy">Privacy Policy</h2>
  <p>
    Blotterbook is built local-first: <b>your trade data never leaves your browser readable.</b> All computation is local on every plan; the one
    exception to "never leaves" is the optional, opt-in cloud sync, which transmits only end-to-end-encrypted ciphertext we cannot read (section
    2). This policy explains the little data the Service does touch, why, and your choices. It applies to the website, the app, and the demo.
  </p>

  <h3>1. Your trade data stays in your browser</h3>
  <p>
    CSV/xlsx parsing, all computation (P&amp;L, costs, tax estimates), and storage happen entirely on your device. Trades, journal notes,
    tags, saved filters, layouts, and attached screenshots live in your browser's <b>IndexedDB</b> (plus first-party local storage for
    settings and layouts). Unless you opt a workspace into cloud sync (section 2), we do not receive, transmit, or store your trade data on
    any server — and even then, only ciphertext we cannot decrypt. The public demo uses an in-memory store, persists nothing, and can never
    sync. Export a backup any time from <b>Manage data → Download backup</b>, and erase everything from the same panel — your data is yours.
  </p>

  <h3>2. Optional cloud sync (end-to-end encrypted, opt-in)</h3>
  <p>
    Subscribers can opt individual workspaces into <b>cloud sync</b>. When (and only when) you do, your trades, journal notes, and settings
    for that workspace are encrypted <b>on your device</b> with keys that never leave your devices, and the resulting
    <b>ciphertext</b> is stored on our servers (Cloudflare R2/D1) so your other devices can fetch and decrypt it. The server sees only
    opaque encrypted blobs, blinded record ids, and timestamps — <b>never a symbol, P&amp;L figure, note, tag, or workspace name</b>, and it
    holds no key that could decrypt them. Workspaces you don't opt in, free-tier accounts, and the demo never sync anything. You can pause
    sync, remove a workspace's synced copy, or delete your account (which permanently deletes all synced ciphertext) at any time. The
    plain-language explainer lives in <a href="/help/cloud-sync.html">Help › Cloud sync</a>.
  </p>

  <h3>3. Coarse-region tax lookup (/api/geo)</h3>
  <p>
    To pre-fill a sensible tax state, the app may ask our own <code>/api/geo</code> endpoint for an <b>approximate region</b> derived from Cloudflare's
    edge metadata. This returns a coarse region only — never a precise location — carries no trade data, stores nothing, and never overrides a
    state you choose or have saved. You can always change the state yourself.
  </p>

  <h3>4. Accounts (passkeys, recovery email, session cookie)</h3>
  <p>
    Launching the app on the live site uses a free account so the Service can carry your identity and any entitlements. The accounts system
    is designed to hold <b>identity and entitlements only — never your trade data</b>. Specifically, we store:
  </p>
  <ul>
    <li>
      <b>Passkey credentials</b> — a WebAuthn <b>public key</b> and related metadata for each passkey. There are <b>no passwords</b>; we
      never store or see a private key.
    </li>
    <li><b>A recovery email</b> — lowercased, used to verify ownership and to recover access if you lose your passkey.</li>
    <li>
      <b>A first-party session</b> — an opaque, HttpOnly session cookie; only a hash of the session secret is stored server-side, so a database
      leak can't yield a usable session.
    </li>
    <li><b>Entitlement flags</b> — such as whether you've donated and the donation total (see below).</li>
  </ul>
  <p>
    This identity data is stored in <b>Cloudflare&nbsp;D1</b> (our database). We use <b>Resend</b> as our transactional-email processor solely
    to send verification and recovery emails; it processes your email address for that delivery and nothing about your trading.
  </p>

  <h3>5. Donations, subscriptions &amp; payments (Stripe)</h3>
  <p>
    Donations and the optional <b>$5/month cloud-sync subscription</b> are processed by <b>Stripe</b>. Your payment details (card number,
    billing information) go directly to Stripe — whether through Stripe's hosted checkout page or the embedded, Stripe-hosted payment form
    in the app — and we never receive or store them. Stripe returns only the confirmation we need to record a
    <b>donor flag / donation amount</b>
    or a <b>subscription status keyed to your account</b>. Stripe's handling of your payment data is governed by Stripe's own privacy
    policy.
  </p>

  <h3>6. Outbound network calls (the honest list)</h3>
  <p>The Service makes only these outbound calls, and none of them include your trades in readable form:</p>
  <ul>
    <li>loading the site's own static reference data, version, and release-notes JSON (brokers, exchange fees, feeds, state tax);</li>
    <li>a small feature-flag/status endpoint on our host to decide whether a maintenance banner shows;</li>
    <li>the coarse-region <code>/api/geo</code> lookup described above;</li>
    <li>
      account endpoints on our host to register/sign in with a passkey, verify or recover your email, and carry your session — identity
      only, never trades;
    </li>
    <li>
      for workspaces you've opted into cloud sync: the <code>/api/sync/*</code> endpoints on our host, carrying only the end-to-end-encrypted
      ciphertext, blinded ids, and timestamps described in section 2 — never plaintext trade data;
    </li>
    <li>Stripe, only when you choose to donate or subscribe (including Stripe's script and payment iframe on the payment form); and</li>
    <li>
      the optional <b>Send feedback</b> button, which opens <i>your own</i> email client pre-filled with text you typed — nothing is sent automatically.
    </li>
  </ul>

  <h3>7. Cookies &amp; tracking</h3>
  <p>
    We use a single first-party, essential <b>session cookie</b> for signed-in accounts. We do <b>not</b> use advertising cookies, third-party
    analytics that profile you, cross-site trackers, or ad networks, and we do not sell or share your personal information.
  </p>

  <h3>8. Your rights (GDPR / CCPA)</h3>
  <p>
    We hold the minimal identity data described above and <b>no readable trade data</b> (for synced workspaces, only ciphertext we cannot
    decrypt). Subject to applicable law, you may request access to, correction of, or deletion of your account data, and you may object to
    or restrict certain processing. We do <b>not sell</b> personal information and run <b>no ad tracking</b>. To exercise any right —
    including deleting your account, its identity records, and all synced ciphertext (also available self-serve on the
    <a href="/account.html">Account page</a>) — email
    <a href="mailto:privacy@blotterbook.com?subject=Privacy%20request">privacy@blotterbook.com</a>. To delete your locally stored trade
    data, use <b>Manage data → Erase</b> in the app; because it lives only in your browser, we cannot access or delete it for you.
  </p>

  <h2 id="donations">Donations &amp; Refund Policy</h2>
  <p>
    Blotterbook is free to use. If it helps you, you can optionally support the project with a one-time donation (currently <b>$25</b>)
    processed by Stripe.
  </p>
  <ul>
    <li>
      <b>Donations are voluntary and NON-REFUNDABLE.</b> Once made, a donation cannot be refunded except where a refund is required by applicable
      law.
    </li>
    <li>
      <b>No goods or services are exchanged.</b> A donation is a gift of support — it is <b>not a purchase</b> and grants
      <b>no product access, entitlement, feature, warranty, or service-level commitment</b>. The full app is free with or without a
      donation.
    </li>
    <li>
      <b>Not a subscription.</b> The donation is a one-time payment; it does not auto-renew and creates no ongoing obligation on either side.
      If additional donation options are offered in the future, these same terms apply to each of them unless stated otherwise at checkout.
    </li>
    <li>
      Payments are handled by <b>Stripe</b>; we store only a donor flag and the amount keyed to your account (see the Privacy Policy). If
      you believe a donation was made in error, contact us and we will review it in good faith, though refunds are not guaranteed.
    </li>
  </ul>

  <h2 id="contact">Contact</h2>
  <p>
    Questions about these Terms, the arbitration agreement, the Privacy Policy, or donations, or to make a privacy request or arbitration
    opt-out? Email <a href="mailto:privacy@blotterbook.com?subject=Blotterbook%20legal">privacy@blotterbook.com</a>.
  </p>
</SiteShell>
