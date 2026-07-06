'use strict';
import { csvCell } from './core.ts';
/* ============================================================
   Minimal xlsx reader — ATAS-SCOPED (F52), not a general library
   ------------------------------------------------------------
   ATAS X exports its statistics as ONE .xlsx workbook (Statistics /
   Journal / Executions) instead of CSV. This module reads exactly
   what that file needs — a small ZIP walk + the four OOXML parts
   the Journal sheet touches — with NO dependency:

     • ZIP: end-of-central-directory → central directory → local
       headers; DEFLATE entries inflate through the platform's
       `DecompressionStream('deflate-raw')` (browsers + Node ≥18;
       this repo pins Node 22), STORE entries pass through raw.
     • XML: regex-scoped extraction of xl/workbook.xml (sheet name →
       r:id), xl/_rels/workbook.xml.rels (rid → worksheet target),
       xl/sharedStrings.xml, and each worksheet's <sheetData> cells
       (r/t/v; t="s" shared string, t="str" formula string, inline
       <is><t>). No styles, merges, formulas, dates1904, rich-text
       formatting, ZIP64, or encrypted workbooks — an ATAS export
       has none of those. Don't grow this into a general parser;
       if another platform needs more, revisit the F52 decision.

   The app layer routes an .xlsx File (intake.ts isXlsxFile) through
   atasXlsxToCsv() and feeds the resulting CSV TEXT into the normal
   synchronous Adapters.parse pipeline — the `atas` adapter never
   sees binary. Framework-agnostic and node-tested (test-adapters.mjs
   runs it against the real export in docs/csv-examples/atas-x/).
   ============================================================ */

/* ---------- ZIP container ---------- */

interface ZipEntry {
  /** Compression method: 0 = STORE (raw), 8 = DEFLATE. */
  method: number;
  /** Local-header offset (the compressed bytes sit past its variable-length name/extra fields). */
  offset: number;
  /** Compressed size in bytes. */
  csize: number;
}

const u16 = (dv: DataView, o: number) => dv.getUint16(o, true);
const u32 = (dv: DataView, o: number) => dv.getUint32(o, true);

/** Walk the central directory into a name → entry map (the canonical file list of a ZIP). */
function zipDirectory(bytes: Uint8Array<ArrayBuffer>): Map<string, ZipEntry> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End-of-central-directory record: scan back from EOF (its trailing comment is ≤64 KiB).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i--) {
    if (u32(dv, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP container (no end-of-central-directory record)');
  const count = u16(dv, eocd + 10);
  let p = u32(dv, eocd + 16); // central-directory offset
  const entries = new Map<string, ZipEntry>();
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(dv, p) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = u16(dv, p + 10);
    const csize = u32(dv, p + 20);
    const nlen = u16(dv, p + 28),
      xlen = u16(dv, p + 30),
      clen = u16(dv, p + 32);
    const offset = u32(dv, p + 42);
    entries.set(td.decode(bytes.subarray(p + 46, p + 46 + nlen)), { method, offset, csize });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

/** Inflate a raw-DEFLATE block via the platform stream (no JS inflate implementation shipped). */
async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read one ZIP member as UTF-8 text (all OOXML parts are XML text). */
async function zipText(bytes: Uint8Array<ArrayBuffer>, dir: Map<string, ZipEntry>, name: string): Promise<string> {
  const e = dir.get(name.replace(/^\//, ''));
  if (!e) throw new Error(`missing workbook part "${name}"`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (e.offset + 30 > bytes.length || u32(dv, e.offset) !== 0x04034b50) throw new Error('corrupt ZIP local header');
  // The LOCAL header's name/extra lengths can differ from the central directory's — reread them.
  const nlen = u16(dv, e.offset + 26),
    xlen = u16(dv, e.offset + 28);
  const start = e.offset + 30 + nlen + xlen;
  const raw = bytes.subarray(start, start + e.csize);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method === 8) return new TextDecoder().decode(await inflateRaw(raw));
  throw new Error(`unsupported ZIP compression method ${e.method}`);
}

/* ---------- XML micro-helpers (element prefixes vary by producer: <x:c> vs <c>) ---------- */

/** Decode the five named XML entities + numeric character references. */
function unesc(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e] ?? m;
  });
}

/** Value of attribute `name` inside a tag's attribute string ('' when absent). */
function attrVal(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? unesc(m[1]) : '';
}

/** Concatenated text of every <t> run inside a fragment (shared/inline strings, incl. rich-text runs). */
function textOf(xml: string): string {
  let out = '';
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) out += unesc(m[1]);
  return out;
}

/** xl/sharedStrings.xml → index-addressable string table. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(textOf(m[1]));
  return out;
}

/** "C7" → 0-based column index 2 (letters only; the row digits terminate the scan). */
function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** One worksheet's <sheetData> → dense rows of cell strings (gaps filled with ''). */
function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  for (let rm = rowRe.exec(xml); rm; rm = rowRe.exec(xml)) {
    const row: string[] = [];
    // A cell is either self-closing (<c r="A1"/> — empty) or wraps <v>/<is>.
    const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    for (let cm = cellRe.exec(rm[1]); cm; cm = cellRe.exec(rm[1])) {
      const attrs = cm[1],
        inner = cm[2] || '';
      const t = attrVal(attrs, 't');
      const vm = inner.match(/<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/);
      let val: string;
      if (t === 's')
        val = (vm && shared[parseInt(vm[1], 10)]) || ''; // shared-string index
      else if (t === 'inlineStr')
        val = textOf(inner); // inline <is><t>…</t></is>
      else val = vm ? unesc(vm[1]) : ''; // number / t="str" formula string / boolean — raw text
      const ref = attrVal(attrs, 'r');
      const ci = ref ? colIndex(ref) : row.length;
      while (row.length < ci) row.push('');
      row[ci] = val;
    }
    rows.push(row);
  }
  return rows;
}

/* ---------- public API ---------- */

/**
 * Parse an xlsx ArrayBuffer into sheet name → rows of cell strings.
 * Numbers stay in their raw serialized form (Excel date-times remain serials — see
 * excelSerialToTime); shared/inline strings are resolved; empty cells are ''.
 */
export async function xlsxSheets(buf: ArrayBuffer): Promise<Map<string, string[][]>> {
  const bytes = new Uint8Array(buf);
  const dir = zipDirectory(bytes);
  const wb = await zipText(bytes, dir, 'xl/workbook.xml');
  const relsXml = await zipText(bytes, dir, 'xl/_rels/workbook.xml.rels');
  const shared = dir.has('xl/sharedStrings.xml') ? parseSharedStrings(await zipText(bytes, dir, 'xl/sharedStrings.xml')) : [];
  // rid → worksheet part path. Targets are '/xl/…' absolute (ATAS) or 'worksheets/…' workbook-relative.
  const rels = new Map<string, string>();
  const relRe = /<Relationship\s[^>]*?\/?>/g;
  for (let m = relRe.exec(relsXml); m; m = relRe.exec(relsXml)) rels.set(attrVal(m[0], 'Id'), attrVal(m[0], 'Target'));
  const out = new Map<string, string[][]>();
  const sheetRe = /<(?:\w+:)?sheet\s[^>]*?\/?>/g;
  for (let m = sheetRe.exec(wb); m; m = sheetRe.exec(wb)) {
    const name = attrVal(m[0], 'name');
    const target = rels.get(attrVal(m[0], 'r:id'));
    if (!name || !target) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    out.set(name, sheetRows(await zipText(bytes, dir, path), shared));
  }
  return out;
}

/**
 * Excel date-time serial → canonical 'YYYY-MM-DD HH:MM:SS'.
 * Excel's 1900 date system (with its deliberate 1900-leap-year bug) puts serial 25569 at
 * 1970-01-01 00:00:00, so days-since-25569 map straight onto the Unix epoch. Sub-second
 * fractions round to the nearest whole second (ATAS serials carry float noise).
 */
export function excelSerialToTime(n: number): string {
  const d = new Date(Math.round((n - 25569) * 86400) * 1000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Header row of the ATAS 'Journal' sheet (closed round trips — the import source). */
const JOURNAL_TIME_COLS = ['open time', 'close time'];

/**
 * ATAS X workbook → CSV text of its 'Journal' sheet, ready for Adapters.parse.
 * Headers: Account, Instrument, Open time, Open price, Open volume, Close time, Close price,
 * Close volume, Price PnL, Profit (ticks), PnL, Comment. The Open/Close time serials are
 * converted to canonical timestamps; everything else serializes verbatim (cells containing
 * commas/quotes/newlines are quoted).
 */
export async function atasXlsxToCsv(buf: ArrayBuffer): Promise<string> {
  const sheets = await xlsxSheets(buf);
  const journal = sheets.get('Journal');
  if (!journal || !journal.length) throw new Error('no “Journal” sheet found — is this an ATAS X statistics export?');
  const head = journal[0].map(h => h.trim().toLowerCase());
  const timeCols = new Set<number>();
  head.forEach((h, i) => {
    if (JOURNAL_TIME_COLS.includes(h)) timeCols.add(i);
  });
  const width = journal[0].length;
  return journal
    .map((row, ri) => {
      const cells: string[] = [];
      for (let i = 0; i < Math.max(width, row.length); i++) {
        const c = row[i] ?? '';
        // Data-row time cells are Excel serials — convert; a non-numeric cell passes through.
        if (ri > 0 && timeCols.has(i) && c !== '' && isFinite(Number(c))) cells.push(excelSerialToTime(Number(c)));
        // A247: csvCell (core.ts) — quoting only, no A154 formula-prefix neutralization. This CSV is
        // an INTERMEDIATE hand-off straight into Adapters.parse, never opened in a spreadsheet app,
        // so there's no formula-injection surface to neutralize here.
        else cells.push(csvCell(c));
      }
      return cells.join(',');
    })
    .join('\n');
}
