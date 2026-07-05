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

import type { Trade } from './types.ts';

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

/* ------------------------------------------------------------
   F52: the ATAS X .xlsx path — an EXPLICIT allowlisted route.
   An xlsx workbook is a ZIP container (PK magic), so the normal
   text gates rightly reject it as binary — that rejection is NOT
   weakened. Instead the app layer routes a file that isXlsxFile()
   recognizes through atasXlsxToCsv() (src/lib/core/xlsx.ts) and
   feeds the resulting CSV TEXT into the standard pipeline, where
   checkCsvText + Adapters.parse apply as usual.
   ------------------------------------------------------------ */

/** Size cap for an imported .xlsx workbook (F52) — a real ATAS statistics export is ~12 KB;
 *  10 MB is generous headroom while still refusing an arbitrary huge ZIP before it's read. */
export const XLSX_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Route test: does this file take the xlsx path (ATAS X statistics export) instead of the
 *  text-CSV gates? Extension OR reported MIME — drag-drops often carry no type at all. */
export function isXlsxFile(file: { name: string; type?: string }): boolean {
  return /\.xlsx$/i.test(file.name || '') || (file.type || '') === XLSX_MIME;
}

/** Pre-read gate for the xlsx path: size cap only — structural validation (ZIP walk, sheet
 *  presence) lives in the reader itself, which throws a readable error on a non-workbook. */
export function checkXlsxFile(file: CsvFileMeta): string | null {
  if (file.size > XLSX_MAX_BYTES) return 'That workbook is over the 10 MB import limit. Export a shorter date range and try again.';
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

/* ============================================================
   Cross-export reconciliation (TV calc audit, 2026-07-04)
   ------------------------------------------------------------
   A platform can export the SAME account at two fidelities: closed
   exports (TradingView balance history) list every realized-P&L
   event exactly; fills exports derive round trips from prices — and
   a fills export with limited reach-back (TV order history caps at
   ~100 orders) MISPAIRS its earliest round trips when a position was
   open at the boundary: wrong entries produce wrong P&L and even
   closes that never happened. Those copies hash to different
   tradeIds (pnl is in the id), so dedupe alone double-counts them.

   The rule, per import, scoped to the SAME platform family:
   • The closed export is AUTHORITATIVE inside its own time window —
     it lists every realized event, so a derived trade in that window
     either matches an authoritative record on time|symbol|side with
     the SAME pnl (→ normal dedupe + enrichment), or it is a phantom
     (mismatched pnl, or no event at all) → dropped.
   • Reverse order converges identically: when the authoritative
     export arrives second, stored derived trades inside its window
     that it doesn't corroborate are evicted, then the exact records
     import.
   • Without an authority/peer classifier (callers outside the app,
     no file provenance) it falls back to exact-collision resolution
     only. Trades outside the authoritative window, other platforms,
     and ambiguous shapes are untouched.
   Known trade-off (documented in the calc audit): two same-platform
   accounts imported as balance(acct A) + orders(acct B) would treat
   acct B's window-overlapping trades as unsupported — the preview
   states the resolved count BEFORE confirm, so the user sees it.
   ============================================================ */
export interface ImportReconciliation {
  /** The incoming trades to actually add (phantom derived copies removed). */
  add: Trade[];
  /** Stored trade ids to evict first (derived copies superseded by incoming authoritative data). */
  evictIds: string[];
  /** How many phantom copies were resolved (surfaced as an import notice). */
  conflicted: number;
}

const tkey = (t: Trade) => `${t.time}|${t.symbol}|${t.side}`;

export function reconcileImport(
  existing: Trade[],
  incoming: Trade[],
  incomingKind: string,
  opts?: {
    /** Existing trade is an authoritative (closed-export) record of the incoming file's platform family. */
    isAuthority?: (t: Trade) => boolean;
    /** Existing trade is a derived (fills-export) record of the incoming file's platform family. */
    isDerivedPeer?: (t: Trade) => boolean;
  }
): ImportReconciliation {
  const add: Trade[] = [];
  const evictIds: string[] = [];
  let conflicted = 0;

  if (incomingKind === 'fills' && opts?.isAuthority) {
    // Authority window + event map from the same-family closed records already in the store.
    const auth = existing.filter(opts.isAuthority);
    const authPnl = new Map(auth.map(t => [tkey(t), t.pnl]));
    let lo = '',
      hi = '';
    for (const t of auth) {
      if (!lo || t.time < lo) lo = t.time;
      if (!hi || t.time > hi) hi = t.time;
    }
    for (const t of incoming) {
      if (lo && t.time >= lo && t.time <= hi) {
        const p = authPnl.get(tkey(t));
        if (p === undefined || p !== t.pnl) {
          conflicted++; // phantom: the authoritative record has no such event (or a different P&L)
          continue;
        }
      }
      add.push(t);
    }
    return { add, evictIds, conflicted };
  }

  if (incomingKind === 'closed' && opts?.isDerivedPeer) {
    // Incoming IS the authority — evict stored same-family derived trades inside its window that
    // it doesn't corroborate, then import everything (dedupe + enrichment handle the matches).
    const inPnl = new Map(incoming.map(t => [tkey(t), t.pnl]));
    let lo = '',
      hi = '';
    for (const t of incoming) {
      if (!lo || t.time < lo) lo = t.time;
      if (!hi || t.time > hi) hi = t.time;
    }
    for (const ex of existing) {
      if (!ex.id || !opts.isDerivedPeer(ex) || ex.time < lo || ex.time > hi) continue;
      const p = inPnl.get(tkey(ex));
      if (p === undefined || p !== ex.pnl) {
        conflicted++;
        evictIds.push(ex.id);
      }
    }
    return { add: incoming.slice(), evictIds, conflicted };
  }

  // Fallback (no provenance classifiers): resolve only unambiguous exact collisions —
  // one existing record at the same time|symbol|side with a different pnl, where exactly one
  // side is authoritative (closed exports carry no holdMs).
  const byKey = new Map<string, Trade[]>();
  for (const t of existing) {
    const k = tkey(t);
    const arr = byKey.get(k);
    if (arr) arr.push(t);
    else byKey.set(k, [t]);
  }
  for (const t of incoming) {
    const matches = byKey.get(tkey(t)) || [];
    if (matches.length === 1 && matches[0].pnl !== t.pnl) {
      const ex = matches[0];
      if (incomingKind === 'fills' && ex.holdMs == null) {
        conflicted++;
        continue;
      }
      if (incomingKind === 'closed' && ex.holdMs != null && ex.id) {
        conflicted++;
        evictIds.push(ex.id);
      }
    }
    add.push(t);
  }
  return { add, evictIds, conflicted };
}
