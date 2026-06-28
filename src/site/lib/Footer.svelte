<script lang="ts">
  // Shared info-site footer (A69 — ex partials/footer.html). `variant="admin"` renders the trimmed
  // internal-tool footer (A9: admin keeps a marketing-free chrome + an "internal admin page" note).
  interface Props {
    variant?: 'full' | 'admin';
  }
  let { variant = 'full' }: Props = $props();
</script>

<footer class="site">
  <div class="frow">
    <span class="fbrand"><span class="dot"></span>Blotterbook</span>
    {#if variant === 'admin'}
      <div class="flinks">
        <a href="index.html">Home</a>
        <a href="changelog.html">Changelog</a>
        <a href="legal.html">Legal</a>
      </div>
      <p class="disclaimer">Internal admin page — not for public use.</p>
    {:else}
      <div class="flinks">
        <a href="index.html">Home</a>
        <a href="howto.html">How To</a>
        <a href="roadmap.html">Roadmap</a>
        <a href="changelog.html">Changelog</a>
        <a href="legal.html">Legal</a>
        <a href="/app/">Launch</a>
        <a href="mailto:contact@blotterbook.com?subject=Blotterbook">Contact</a>
      </div>
      <p class="disclaimer">
        Blotterbook is a trading journal and estimation tool — <b>not a broker</b>, and not financial, investment, or tax advice. All
        figures are estimates. Trading involves risk of loss.
      </p>
    {/if}
  </div>
</footer>

<style>
  footer.site {
    border-top: 1px solid var(--line);
    padding: 34px 22px;
    color: var(--faint);
    font-size: 12.5px;
  }
  footer.site .frow {
    max-width: 1080px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  footer.site .fbrand {
    font-weight: 700;
    color: var(--txt);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  footer.site .fbrand .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: linear-gradient(135deg, var(--accent), var(--take));
  }
  footer.site .flinks {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  footer.site .flinks a {
    color: var(--dim);
    font-size: 13px;
    text-decoration: none;
  }
  footer.site .flinks a:hover {
    text-decoration: underline;
  }
  footer.site .disclaimer {
    width: 100%;
    margin: 6px 0 0;
    font-size: 11.5px;
    color: var(--faint);
    line-height: 1.6;
  }
</style>
