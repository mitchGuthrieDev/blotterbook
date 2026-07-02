<script lang="ts">
  // Legal & disclaimers (A69 — ex legal.html static markup). Pure content; all styles come from the
  // shared SiteShell (.wrap/typography/.note). No page-specific CSS or client logic.
  import SiteShell from '../lib/SiteShell.svelte';
</script>

<SiteShell>
  <p class="eyebrow">The Fine Print</p>
  <h1>Legal &amp; Disclaimers</h1>
  <p class="blurb">
    Blotterbook is a private trading <b>journal and cost/tax estimation tool</b>. Please read these disclaimers before relying on anything
    it shows you. Last updated July&nbsp;2026.
  </p>

  <div class="note warn">
    <b>Not a broker. Not advice.</b> Blotterbook does not execute trades, hold funds, or route orders, and it is not a broker-dealer, futures
    commission merchant, investment adviser, accountant, or tax advisor. Nothing it displays is financial, investment, legal, or tax advice or
    a recommendation to buy or sell anything.
  </div>

  <h2>Disclaimer</h2>
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

  <h2>Terms of Use</h2>
  <ul>
    <li>
      Blotterbook is provided <b>“as is” and “as available,” without warranties of any kind</b>, express or implied, including
      merchantability, fitness for a particular purpose, and accuracy.
    </li>
    <li>
      To the maximum extent permitted by law, the authors are <b>not liable</b> for any loss or damages arising from your use of (or inability
      to use) Blotterbook, including trading losses or reliance on any figure it produces. You use it at your own risk.
    </li>
    <li>
      You are responsible for the accuracy of the data you import and for complying with the terms of the platforms and brokers you export
      it from.
    </li>
    <li>
      The software is proprietary and all rights are reserved — see the
      <a href="https://github.com/mitchGuthrieDev/blotterbook/blob/main/LICENSE">LICENSE</a>. Viewing the source is fine; copying,
      redistributing, or reusing it is not without written permission.
    </li>
    <li>These terms may change; continued use after an update constitutes acceptance.</li>
  </ul>

  <h2>Privacy</h2>
  <ul>
    <li>
      <b>Your trade data never leaves your browser.</b> CSV parsing, all computation, and storage happen locally; trades, journal notes, tags,
      and attached screenshots live in your browser's IndexedDB (plus first-party local storage for settings and layouts) and are not uploaded.
    </li>
    <li>
      <b>No accounts, no tracking, no advertising cookies.</b> Local storage used to keep your data and settings is first-party and essential
      — not used to track you across sites.
    </li>
    <li>
      <b>Limited outbound calls.</b> The site loads its own static reference data, version, and release-notes JSON, and the app asks a tiny
      feature-flag/status endpoint on our own host whether a maintenance banner should show — these carry no personal data, no cookies, and
      never anything about your trades. The optional <b>Send feedback</b> button only opens <i>your own</i> email client pre-filled with the text
      you typed; nothing is sent automatically.
    </li>
    <li>Export a backup any time from <b>Manage data → Download backup</b> — your data is yours.</li>
  </ul>

  <h2>Contact</h2>
  <p>
    Questions about any of the above?
    <a href="mailto:contact@blotterbook.com?subject=Blotterbook%20legal">contact@blotterbook.com</a>.
  </p>
</SiteShell>
