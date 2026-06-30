<script lang="ts">
  // Performance-report export (A34 — parity with vanilla export.js, F3/CH16). Builds the report
  // ONCE via report.js (A29 — the pure builder shared by the on-screen doc, the Markdown download
  // and the email summary) and renders it in an isolated <iframe> (its own baked-token palette, so
  // it tracks tokens.css — A8). Download is disabled until a real format is chosen; PDF prints the
  // iframe, PNG/JPEG rasterize it, Markdown/Email reuse the builder's strings.
  import { buildReport, reportHtmlDoc } from '../../lib/core/report.ts';
  import { fmtDate } from '../../lib/core/core.ts';
  import type { Metrics } from '../../lib/core/core.ts';
  import type { CostModel, ReportLabels } from '../../lib/core/types.ts';
  import { downloadBlob } from '../lib/files.ts';
  import * as Dialog from '$ui/dialog';
  import * as Select from '$ui/select';
  import { Button, buttonVariants } from '$ui/button';

  const FORMATS = [
    { value: 'pdf', label: 'PDF (print)' },
    { value: 'md', label: 'Markdown (.md)' },
    { value: 'png', label: 'Image (.png)' },
    { value: 'jpeg', label: 'Image (.jpg)' },
  ];

  interface Props {
    metrics: Metrics;
    cost: CostModel;
    // App supplies all header labels except `generated`, which this component stamps at export time.
    labels: Omit<ReportLabels, 'generated'>;
    onclose: () => void;
  }
  let { metrics: m, cost: c, labels, onclose }: Props = $props();

  // Bake the live design tokens into a :root{…} block so the standalone report matches tokens.css
  // without report.js touching the DOM (A8). System fonts + a CSS-gradient dot → no external assets.
  function tokenBlock() {
    const cs = getComputedStyle(document.documentElement);
    const vars = ['--bg', '--panel', '--panel2', '--line', '--txt', '--dim', '--faint', '--green', '--red', '--primary', '--take', '--mono', '--sans'];
    return ':root{' + vars.map(n => `${n}:${cs.getPropertyValue(n).trim()}`).join(';') + ';}';
  }

  const gen = new Date();
  const rep = $derived(buildReport(m, c, { ...labels, generated: gen }));
  // {html, css}: the iframe gets the body via srcdoc, and the CSS is injected via the CSSOM on load
  // (adoptedStyleSheets) so no inline <style> is needed — style-src 'self' clean (A55/S18).
  const built = $derived(reportHtmlDoc(rep, labels, tokenBlock()));
  const fname = `blotterbook-report-${fmtDate(gen)}`;

  function applyStyles() {
    if (!iframeEl || !iframeEl.contentWindow || !iframeEl.contentDocument) return;
    try {
      const sheet = new (iframeEl.contentWindow as Window & typeof globalThis).CSSStyleSheet();
      sheet.replaceSync(built.css);
      iframeEl.contentDocument.adoptedStyleSheets = [sheet];
    } catch (_) {
      /* older engine without constructable stylesheets — preview renders unstyled, print/raster still embed CSS */
    }
  }

  let format = $state('');
  let note = $state('');
  let noteKind = $state('');
  let iframeEl: HTMLIFrameElement;

  function setNote(t: string, k = '') {
    note = t || '';
    noteKind = k;
  }

  // Rasterize the report node (serialized HTML + CSS in an SVG <foreignObject> → 2× canvas → blob).
  // No external images (system fonts + CSS-gradient dot), so the canvas is not tainted.
  function rasterize(type: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        const idoc = iframeEl.contentDocument;
        const sheet = idoc?.querySelector('.sheet');
        if (!sheet) return reject(new Error('no report to render'));
        const w = Math.ceil(sheet.scrollWidth),
          h = Math.ceil(sheet.scrollHeight);
        const css = built.css;
        const xml = new XMLSerializer().serializeToString(sheet);
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
          `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
          `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${xml}</div>` +
          `</foreignObject></svg>`;
        const img = new Image();
        img.onload = () => {
          try {
            const sc = 2,
              cv = document.createElement('canvas');
            cv.width = w * sc;
            cv.height = h * sc;
            const ctx = cv.getContext('2d');
            if (!ctx) return reject(new Error('no 2d context'));
            ctx.scale(sc, sc);
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0d1014';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0);
            cv.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob returned null'))), type, type === 'image/jpeg' ? 0.92 : undefined);
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => reject(new Error('image render failed'));
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function doDownload() {
    if (!format) return;
    try {
      if (format === 'pdf') {
        iframeEl.contentWindow?.focus();
        iframeEl.contentWindow?.print();
      } else if (format === 'md') {
        downloadBlob(fname + '.md', new Blob([rep.reportMd], { type: 'text/markdown;charset=utf-8' }));
        setNote('Markdown downloaded.', 'ok');
      } else if (format === 'png' || format === 'jpeg') {
        setNote('Rendering image…');
        const blob = await rasterize(format === 'png' ? 'image/png' : 'image/jpeg');
        downloadBlob(fname + '.' + format, blob);
        setNote('');
      }
    } catch (err) {
      console.error('export download failed', err);
      setNote('Could not export ' + format.toUpperCase() + ' — try PDF or Markdown.', 'err');
    }
  }
</script>

<Dialog.Root open onOpenChange={(o: boolean) => !o && onclose()}>
  <Dialog.Content class="modal top-[5vh] flex max-h-[90vh] max-w-[880px] flex-col overflow-hidden" aria-label="Export performance report">
    <div class="flex items-center justify-between gap-3 border-b border-line bg-panel px-3.5 py-3 max-[560px]:flex-wrap">
      <strong class="text-[13px]">Performance report</strong>
      <div class="flex items-center gap-2 max-[560px]:w-full max-[560px]:flex-wrap max-[560px]:justify-start">
        <Select.Root type="single" bind:value={format} items={FORMATS}>
          <Select.Trigger aria-label="Download format" class="max-[560px]:min-w-0 max-[560px]:flex-1"
            ><Select.Value placeholder="Download as…" /></Select.Trigger
          >
          <Select.Content>
            {#each FORMATS as f (f.value)}<Select.Item value={f.value} label={f.label} />{/each}
          </Select.Content>
        </Select.Root>
        <Button variant="primary" class="pri" disabled={!format} onclick={doDownload}>Download</Button>
        <a href={rep.mailto} class={buttonVariants({ variant: 'default' })}>Email a copy</a>
        <Button data-expclose onclick={onclose}>Close</Button>
      </div>
    </div>
    {#if note}<div
        class="border-b border-line px-3.5 py-1.5 text-xs {noteKind === 'ok' ? 'text-green' : noteKind === 'err' ? 'text-red' : 'text-dim'}"
      >
        {note}
      </div>{/if}
    <!-- S24: same-origin srcdoc (print + CSSOM styling need it) but NO allow-scripts — defense-in-depth
         should an escaping bug ever slip past report.ts's esc(). The report carries no scripts of its own;
         allow-modals keeps the parent-triggered print() dialog working. -->
    <iframe bind:this={iframeEl} class="min-h-[50vh] w-full flex-1 border-0 bg-bg" title="Performance report preview" sandbox="allow-same-origin allow-modals" srcdoc={built.html} onload={applyStyles}></iframe>
  </Dialog.Content>
</Dialog.Root>
