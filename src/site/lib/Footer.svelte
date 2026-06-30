<script lang="ts">
  // Shared info-site footer (A69 — ex partials/footer.html). `variant="admin"` renders the trimmed
  // internal-tool footer (A9: admin keeps a marketing-free chrome + an "internal admin page" note).
  interface Props {
    variant?: 'full' | 'admin';
  }
  let { variant = 'full' }: Props = $props();
</script>

<footer class="border-t border-border px-[22px] py-[34px] text-[12.5px] text-muted-foreground">
  <div class="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-4">
    <span class="inline-flex items-center gap-2 font-bold text-foreground"
      ><span class="h-2 w-2 rounded-[2px] bg-[linear-gradient(135deg,var(--primary),var(--chart-3))]"></span>Blotterbook</span
    >
    {#if variant === 'admin'}
      <div class="flex flex-wrap gap-4">
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="index.html">Home</a>
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="changelog.html">Changelog</a>
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="legal.html">Legal</a>
      </div>
      <p class="mt-1.5 mb-0 w-full text-[11.5px] leading-[1.6] text-muted-foreground">Internal admin page — not for public use.</p>
    {:else}
      <div class="flex flex-wrap gap-4">
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="index.html">Home</a>
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="howto.html">How To</a>
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="roadmap.html">Roadmap</a>
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="changelog.html">Changelog</a>
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="legal.html">Legal</a>
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="/app/">Launch</a>
        <a class="text-[13px] text-muted-foreground no-underline hover:underline" href="mailto:contact@blotterbook.com?subject=Blotterbook"
          >Contact</a
        >
      </div>
      <p class="mt-1.5 mb-0 w-full text-[11.5px] leading-[1.6] text-muted-foreground">
        Blotterbook is a trading journal and estimation tool — <b>not a broker</b>, and not financial, investment, or tax advice. All
        figures are estimates. Trading involves risk of loss.
      </p>
    {/if}
  </div>
</footer>
