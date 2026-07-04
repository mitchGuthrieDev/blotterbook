'use strict';
/* ============================================================
   CSV intake validation (A177)
   ------------------------------------------------------------
   Shared guards that run IN FRONT of Adapters.parse at every CSV
   intake point (CsvLibrary upload zone + picker, the Onboarding
   dropzone). Pure client-side — no file ever leaves the browser;
   the goal is a readable rejection instead of a frozen tab or a
   garbage import when someone drops a binary, an oversized file,
   or something that isn't a CSV at all.

   Two stages, matching what's knowable when:
     • checkCsvFile()  — name/MIME/size, BEFORE reading the file
     • checkCsvText()  — binary sniff + row cap, on the read text
       (also called inside Adapters.parse as belt-and-braces so
       every path through parse is covered)

   Both return a user-facing error string, or null when the file
   passes. Framework-agnostic and node-tested (test-adapters.mjs).
   ============================================================ */

/** Size cap for an imported CSV — beyond this we refuse rather than freeze the tab. */
export const CSV_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
/** Row cap (a season of fills is thousands of rows; hundreds of thousands is not a trade export). */
export const CSV_MAX_ROWS = 250_000;

/** The pieces of a File we validate — plain fields so node tests don't need a DOM File. */
export interface CsvFileMeta {
  name: string;
  size: number;
  /** Browser-reported MIME; often '' for drag-drops and 'application/vnd.ms-excel' for .csv on Windows. */
  type?: string;
}

const OK_EXT = /\.(csv|txt|tsv)$/i;
const SIZE_MSG = 'That file is over the 20 MB import limit. Export a shorter date range (or split the file) and try again.';

/**
 * Pre-read gate: extension/MIME allowlist + size cap.
 * Allow when the extension is .csv/.txt/.tsv OR the reported MIME is text/* —
 * Windows reports .csv as application/vnd.ms-excel and drag-drops often carry
 * no type at all, so the extension check has to be able to pass on its own.
 */
export function checkCsvFile(file: CsvFileMeta): string | null {
  if (file.size > CSV_MAX_BYTES) return SIZE_MSG;
  const extOk = OK_EXT.test(file.name || '');
  const mimeOk = (file.type || '').startsWith('text/');
  if (!extOk && !mimeOk) return 'That doesn’t look like a CSV export — pick the .csv (or .txt) file your platform exported.';
  return null;
}

/**
 * Post-read gate: binary sniff + row cap.
 * Sniffs the first 4 KB — a NUL byte, or a >2% density of non-text control
 * characters (U+FFFD replacement chars from a mis-decoded binary count too),
 * means this is not a text CSV.
 */
export function checkCsvText(text: string): string | null {
  if (text.length > CSV_MAX_BYTES) return SIZE_MSG; // belt-and-braces for paths that never saw a File
  const sample = text.slice(0, 4096);
  if (sample.indexOf('\0') >= 0) return 'That file is binary data, not a CSV — pick the .csv file your platform exported.';
  let ctl = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffd) ctl++;
  }
  if (sample.length && ctl / sample.length > 0.02)
    return 'That file doesn’t read as text — it may be binary or in an unsupported encoding. Export a plain CSV and try again.';
  let rows = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (++rows > CSV_MAX_ROWS) return `That file has more than ${CSV_MAX_ROWS.toLocaleString()} rows — export a shorter date range.`;
  }
  return null;
}
