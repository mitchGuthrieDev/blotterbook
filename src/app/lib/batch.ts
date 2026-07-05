// F47: batch-intake support — per-file outcome rows for the detection-status list, plus the
// recognized-non-trade classifier that names known non-trade exports instead of letting them fall
// through to the generic A178 refusal. App-side glue (not core): classification is a UX nicety
// keyed to the real export sets in docs/csv-examples; the core's strict detection gate is untouched.

/** One file's outcome in the detection-status list. */
export interface BatchRow {
  name: string;
  state: 'ok' | 'nontrade' | 'refused';
  /** 'ok' → the detected platform label; 'nontrade' → the recognized export type; 'refused' → ''. */
  label: string;
  /** Human detail: '12 trades', 'recognized, not a trade file', or the refusal reason. */
  detail: string;
}

// Header signatures of KNOWN non-trade exports (from the real export sets — csv-examples README).
// Matched against the lowercased first line; first hit wins. Deliberately specific strings so a
// legitimate trade file can't be misclassified as non-trade.
const NON_TRADE: Array<{ sig: string[]; label: string }> = [
  { sig: ['cash change type'], label: 'Cash History' },
  { sig: ['total realized pnl', 'trade date'], label: 'Account Balance History' },
  { sig: ['pair id', 'paired qty'], label: 'Position History' },
  { sig: ['order group id', 'trigger price'], label: 'Orders history (order lifecycle)' },
  { sig: ['balance before', 'balance after'], label: '' }, // TV balance history IS trade data — never claim it
  { sig: ['time,text'], label: 'Trading journal (text log)' },
];

/** Name a refused file's export type when we recognize it as a KNOWN non-trade export; null = truly
 *  unrecognized (the A178 refusal stands). An empty/whitespace file reports as such. */
export function classifyNonTrade(text: string): string | null {
  const t = (text || '').trim();
  if (!t) return 'Empty file';
  const head = t
    .slice(0, 2000)
    .split(/\r?\n/, 1)[0]
    .toLowerCase()
    .replace(/^\uFEFF/, '');
  for (const { sig, label } of NON_TRADE) {
    if (!label) continue;
    if (sig.every(s => head.includes(s))) return label;
  }
  return null;
}
