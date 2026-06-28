<script>
  // Performance-report export (A34 — parity with vanilla export.js, F3/CH16). Builds the report
  // ONCE via report.js (A29 — the pure builder shared by the on-screen doc, the Markdown download
  // and the email summary) and renders it in an isolated <iframe> (its own baked-token palette, so
  // it tracks tokens.css — A8). Download is disabled until a real format is chosen; PDF prints the
  // iframe, PNG/JPEG rasterize it, Markdown/Email reuse the builder's strings.
  import { buildReport, reportHtmlDoc } from '../../report.js';
  import { fmtDate } from '../../core.js';

  let { metrics: m, cost: c, labels, onclose } = $props();

  // Bake the live design tokens into a :root{…} block so the standalone report matches tokens.css
  // without report.js touching the DOM (A8). System fonts + a CSS-gradient dot → no external assets.
  function tokenBlock() {
    const cs = getComputedStyle(document.documentElement);
    const vars = ['--bg', '--panel', '--panel2', '--line', '--txt', '--dim', '--faint', '--green', '--red', '--accent', '--take', '--mono', '--sans'];
    return ':root{' + vars.map(n => `${n}:${cs.getPropertyValue(n).trim()}`).join(';') + ';}';
  }

  const gen = new Date();
  const rep = $derived(buildReport(m, c, { ...labels, generated: gen }));
  const doc = $derived(reportHtmlDoc(rep, labels, tokenBlock()));
  const fname = `blotterbook-report-${fmtDate(gen)}`;

  let format = $state('');
  let note = $state('');
  let noteKind = $state('');
  let iframeEl;

  function setNote(t, k = '') {
    note = t || '';
    noteKind = k;
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // Rasterize the report node (serialized HTML + CSS in an SVG <foreignObject> → 2× canvas → blob).
  // No external images (system fonts + CSS-gradient dot), so the canvas is not tainted.
  function rasterize(type) {
    return new Promise((resolve, reject) => {
      try {
        const idoc = iframeEl.contentDocument;
        const sheet = idoc.querySelector('.sheet');
        if (!sheet) return reject(new Error('no report to render'));
        const w = Math.ceil(sheet.scrollWidth),
          h = Math.ceil(sheet.scrollHeight);
        const css = (idoc.querySelector('style') || {}).textContent || '';
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
        iframeEl.contentWindow.focus();
        iframeEl.contentWindow.print();
      } else if (format === 'md') {
        download(fname + '.md', new Blob([rep.reportMd], { type: 'text/markdown;charset=utf-8' }));
        setNote('Markdown downloaded.', 'ok');
      } else if (format === 'png' || format === 'jpeg') {
        setNote('Rendering image…');
        const blob = await rasterize(format === 'png' ? 'image/png' : 'image/jpeg');
        download(fname + '.' + format, blob);
        setNote('');
      }
    } catch (err) {
      console.error('export download failed', err);
      setNote('Could not export ' + format.toUpperCase() + ' — try PDF or Markdown.', 'err');
    }
  }
</script>

<div class="overlay" role="presentation" onclick={e => e.target === e.currentTarget && onclose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Export performance report">
    <div class="bar">
      <strong>Performance report</strong>
      <div class="actions">
        <select aria-label="Download format" bind:value={format}>
          <option value="">Download as…</option>
          <option value="pdf">PDF (print)</option>
          <option value="md">Markdown (.md)</option>
          <option value="png">Image (.png)</option>
          <option value="jpeg">Image (.jpg)</option>
        </select>
        <button type="button" class="pri" disabled={!format} onclick={doDownload}>Download</button>
        <a class="btn" href={rep.mailto}>Email a copy</a>
        <button type="button" class="btn" data-expclose onclick={onclose}>Close</button>
      </div>
    </div>
    {#if note}<div class="parsestatus {noteKind}">{note}</div>{/if}
    <iframe bind:this={iframeEl} class="preview" title="Performance report preview" srcdoc={doc}></iframe>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 5vh 16px;
    z-index: 60;
  }
  .modal {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 12px;
    width: 100%;
    max-width: 880px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .bar strong {
    font-size: 13px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  select {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 7px 8px;
    font-size: 13px;
    font-family: var(--sans);
  }
  button,
  .btn {
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    border: 1px solid var(--line);
    background: var(--panel2);
    color: var(--txt);
    padding: 7px 14px;
    border-radius: 6px;
    text-decoration: none;
  }
  .pri {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
    font-weight: 600;
  }
  .pri:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .parsestatus {
    padding: 6px 14px;
    font-size: 12px;
    color: var(--dim);
    border-bottom: 1px solid var(--line);
  }
  .parsestatus.ok {
    color: var(--green);
  }
  .parsestatus.err {
    color: var(--red);
  }
  .preview {
    flex: 1;
    width: 100%;
    border: 0;
    background: var(--bg);
    min-height: 50vh;
  }
</style>
