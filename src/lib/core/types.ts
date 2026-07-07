/* Blotterbook · shared TypeScript types (A61 — full-TS conversion; was JSDoc @typedefs in CH33).
 *
 * Real `interface`/`type` declarations for the data shapes that flow through the pure-logic core
 * (adapters → compute → costModel → report → the Svelte view). Imported with real `.ts` specifiers
 * (allowImportingTsExtensions). Type-only — erased at build time, ships as nothing. */

/** One row of a parsed CSV (cells as strings). */
export type Row = string[];

/**
 * One normalized, closed trade — the single internal shape every platform adapter emits,
 * so compute()/costModel() never branch on platform (see app/adapters.ts).
 */
export interface Trade {
  /** Canonical `YYYY-MM-DD HH:MM:SS`. */
  time: string;
  /** `YYYY-MM-DD` (the close day). */
  date: string;
  /** Realized PnL for the trade. */
  pnl: number;
  /** Raw instrument symbol as exported. */
  symbol: string;
  /** Sanitized root ticker (e.g. `MES`). */
  root: string;
  /** `'long'` | `'short'` | `''`. */
  side: string;
  /** Contracts (fills/MotiveWave); absent ⇒ 1. */
  qty?: number;
  /** Round-trip entry timestamp (fills exports). */
  entryTime?: string;
  /** Round-trip exit timestamp (fills exports). */
  exitTime?: string;
  /** Hold time in ms (fills exports). */
  holdMs?: number;
  /** Round-trip entry price (F42) — the executed/average entry price when the export carries per-fill
   *  prices (all fills exports + MotiveWave). Each round trip pairs one entry lot with one close fill,
   *  so this is the exact executed price (the broker's avg-fill price is already the VWAP of any
   *  sub-partials). Absent for balance-history exports (no per-execution price). NOT part of tradeId. */
  entryPrice?: number;
  /** Round-trip exit price (F42). See entryPrice. NOT part of tradeId. */
  exitPrice?: number;
  /** Within-file ordinal (2nd+ occurrence of an identical time|symbol|side|pnl) so genuinely
   *  distinct same-second trades aren't collapsed by the dedupe key (A114). Unset ⇒ 0 (first/unique). */
  dup?: number;
  /** PnL was derived from price × a FALLBACK point value ($1/point) because the root has no known
   *  contract size — the figure is a guess and is surfaced to the user (A113). */
  pvEstimated?: boolean;
  /** ACTUAL round-turn commission+fees ($, positive = cost) from the source CSV (A208) — when set,
   *  costModel uses it verbatim instead of the modeled tier rate. NOT part of tradeId. */
  commission?: number;
  /** Source-file provenance (F37): ids of every imported CSV that contributed this trade (a trade
   *  in two overlapping exports carries both). Absent = imported pre-F37 (always included).
   *  NOT part of tradeId. */
  fileIds?: string[];
  /** Epoch ms of the last local write (F58) — the record-level LWW clock for the future sync layer.
   *  Stamped by Store on every insert/enrich; absent on trades from a store predating F58.
   *  NOT part of tradeId (identity must not change, or re-imports would stop deduping). */
  updated?: number;
  /** Stable dedupe id once persisted (Store.tradeId). */
  id?: string;
}

/** A single execution fed to the FIFO round-trip matcher (pairFills). */
export interface Fill {
  time: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  /** Per-row realized PnL when the export provides it (IBKR). */
  realized?: number;
  /** Per-fill commission+fees ($, positive = cost) when the export provides it (A208 — e.g. IBKR
   *  ibCommission). pairFills apportions entry+exit shares onto the closed round trips. */
  commission?: number;
  /** Execution-order tiebreak within a same-second batch. */
  _seq?: number;
}

/** Result of Adapters.parse(): either ok with normalized trades, or an error. */
export interface ParseResult {
  ok: boolean;
  trades?: Trade[];
  platform?: string;
  label?: string;
  beta?: boolean;
  /** `'closed'` | `'fills'`. */
  kind?: string;
  detected?: string | null;
  error?: string;
  /** Roots whose PnL was estimated at $1/point (no known contract size) — surfaced as a warning (A113). */
  estimatedRoots?: string[];
  /** Fills skipped for an unparseable timestamp (fills-based adapters) — import-quality notice (A168). */
  skippedFills?: number;
  /** Lots left open at end-of-file (truncated export / open position) — import-quality notice (A174). */
  openLots?: number;
  /** The adapter's "upload X to unlock Y" sibling-export guidance, passed through to the preview. */
  upgradeHint?: string;
}

/** A platform CSV adapter (one per supported export format). */
export interface Adapter {
  id: string;
  label: string;
  kind: 'closed' | 'fills';
  beta: boolean;
  /** Minimum sniff score detect() will accept for THIS adapter (A178 strict gate) — a weaker
   *  partial match refuses instead of auto-claiming the file. Set to the adapter's full-signature
   *  sniff score so today's all-or-nothing sniffs behave identically. */
  minScore: number;
  /** Shown in the import preview when this format lacks fields a SIBLING export of the same
   *  platform provides (e.g. TradingView balance history → its order-history export adds hold
   *  times) — the "upload X to unlock Y" guidance. */
  upgradeHint?: string;
  sniff(text: string, rows: Row[]): number;
  toTrades(text: string, rows: Row[]): Trade[];
}

/** A parsed futures contract expiry (F40 / A137) — derived on READ from Trade.symbol by
 *  core.ts's expiryOf(), never persisted. `code` is the CME month letter (F–Z). */
export interface ContractExpiry {
  /** CME month code letter (F=Jan … Z=Dec). */
  code: string;
  /** Month number 1–12. */
  month: number;
  /** 4-digit expiry year. */
  year: number;
}

/** A detected-platform summary (Adapters.detect). */
export interface Detected {
  id: string;
  label: string;
  beta: boolean;
  kind: 'closed' | 'fills';
  score: number;
}

/** Per-symbol commission breakdown row (costModel().bySym entries). */
export interface SymCost {
  root: string;
  count: number;
  qty: number;
  rate: number;
  known: boolean;
  total: number;
  /** Trades priced with an ACTUAL CSV-provided commission instead of the modeled rate (A208). */
  actual: number;
}

/** Inputs to costModel() — the cost setup (A32). */
export interface CostInputs {
  broker?: string;
  platform?: number | string;
  feedCost?: number | string;
  stateRate?: number | string;
  /** A211: per-trade broker resolver (file-level overrides) — returns a broker key for trades
   *  whose source file carries one, undefined otherwise (→ the global `broker`). */
  brokerFor?: (t: Trade) => string | undefined;
}

/** costModel() output — commissions, subscriptions, tax, take-home over the active metrics. */
export interface CostModel {
  broker: string;
  platform: number;
  data: number;
  fixedMo: number;
  totalComm: number;
  months: number;
  fixedPeriod: number;
  gross: number;
  netPreTax: number;
  tEff: number;
  tax: number;
  afterTax: number;
  pfGP: number;
  pfGL: number;
  pf: number;
  n: number;
  contracts: number;
  bePer: number;
  bySym: SymCost[];
  /** A208: how many trades carry an ACTUAL CSV commission (used verbatim), and their $ total —
   *  the rest use the modeled tier rate. Surfaced in the cost UI so the mix is visible. */
  actualCommTrades: number;
  actualComm: number;
}

/** Persisted setup selections (Store meta key `setup`). */
export interface Setup {
  broker: string;
  feed: string;
  state: string;
  platform: string;
}

/** A per-day journal annotation (Store `journal`). */
export interface Annotation {
  text?: string;
  tags?: string[];
  /** data: image URLs (validated by SHOT_RE). */
  shots?: string[];
}

/** Per-trade metadata (Store `trademeta`) — like Annotation but with `note` instead of `text`. */
export interface TradeMeta {
  tags?: string[];
  note?: string;
  shots?: string[];
}

/** A persisted per-day journal record (the `journal` object store row written by saveJournal). */
export interface StoredJournal {
  date: string;
  text: string;
  tags: string[];
  shots: string[];
  updated: number;
}

/** A persisted per-trade metadata record (the `trademeta` object store row; `id` + normalized fields). */
export interface StoredTradeMeta {
  id: string;
  tags: string[];
  note: string;
  shots: string[];
  /** Epoch ms of the last write; absent on the empty default returned by getTradeMeta. */
  updated?: number;
}

/** Human-readable labels for the performance report header (report.ts buildReport). */
/** Report section toggles (A156). curve/calendar are preview-only (no text/Markdown form). */
export interface ReportSections {
  kpis: boolean;
  curve: boolean;
  calendar: boolean;
  cost: boolean;
  tax: boolean;
  advanced: boolean;
}

export interface ReportLabels {
  broker: string;
  feed: string;
  state: string;
  scope: string;
  stateRate: number;
  platform: number | string;
  generated: Date;
  /** User-configured report title/account + section toggles (A156) — the downloads must render
      exactly what the preview shows, so these thread into the text/Markdown/mailto payloads. */
  title?: string;
  account?: string;
  sections?: Partial<ReportSections>;
}

/** The live filter set driving the dashboard (App `filters` state / FilterBar). */
export interface FilterState {
  scope: string;
  from: string;
  to: string;
  root: string;
  side: string;
  session: string;
  tag: string;
  dows: number[];
  /** Hour-of-day buckets (0–23, from the trade timestamp HH) — A197; trades without a timestamp
   *  are excluded while an hour filter is active. */
  hours: number[];
}

/** The persisted payload of a saved filter (vanilla-compatible `f` shape; `symbol` holds root). */
export interface SavedFilterDef {
  from?: string;
  to?: string;
  symbol?: string;
  side?: string;
  session?: string;
  tag?: string;
  dows?: number[];
  hours?: number[];
}

/** A saved filter view ([{id,name,f}]) persisted to Store meta `savedFilters`. */
export interface SavedFilter {
  id: string;
  name: string;
  f: SavedFilterDef;
}

/** The cost setup as held in the Svelte app state (note `stateAbbr`/numeric `platform`, vs core Setup). */
export interface AppSetup {
  broker: string;
  feed: string;
  stateAbbr: string;
  platform: number;
}

/* ---- reference-data shapes (data/*.json, loaded by loadRefData) ---- */

/** manifest.json — file → content hash, for cache-busting `?v=` params. */
export interface RefDataManifest {
  schemaVersion?: number;
  files?: Record<string, string>;
}

/** One effective-dated fee period (F30): the values that applied to trades ON OR BEFORE `until`.
 *  Partial by design — a root/tier absent here falls through to the next-newer period (and
 *  finally the current values), so an entry only lists what a documented change actually moved. */
export interface FeeHistoryEntry {
  /** Last day (YYYY-MM-DD, inclusive) these values applied — i.e. the day before the change. */
  until: string;
  exchange: Record<string, number>;
  /** Citation for the documented change (F30 requires sourced history). */
  source?: string;
}

/** exchange-fees.json — per-root exchange/clearing/NFA $ per side + the micro-tier root set. */
export interface ExchangeFeesFile {
  schemaVersion?: number;
  exchange?: Record<string, number>;
  micro?: string[];
  /** Full-size roots the M-prefix tier heuristic would misprice as micro (e.g. MWE) — A171. */
  notMicro?: string[];
  fallback?: { micro: number; std: number };
  /** F30: effective-dated fee periods, oldest first (ascending `until`). */
  history?: FeeHistoryEntry[];
}

/** brokers.json — broker commission tiers + display order. */
export interface BrokersFile {
  schemaVersion?: number;
  brokers?: Record<string, Broker>;
  order?: string[];
}

/** feeds.json — per-broker feed groups; a string value aliases into `shared`. */
export interface FeedsFile {
  schemaVersion?: number;
  shared?: Record<string, FeedGroups>;
  brokerFeeds?: Record<string, FeedGroups | string>;
}

/** state-tax.json — per-state top rates + the Section-1256 blend model. */
export interface StateTaxFile {
  schemaVersion?: number;
  states?: StateRow[];
  model?: Partial<TaxModel>;
}

/* ---- economic-event calendar (econ-events.json, R14/R14a) ---- */

/** An event's market-impact level — the UI defaults to `high`-only (weekly EIA is `medium`). */
export type EconImpact = 'high' | 'medium' | 'low';

/** A category descriptor in econ-events.json's `types` map (one per event kind). All rows of a type
 *  inherit these defaults; a row's own `et` overrides `et` when a release shifted off its usual time. */
export interface EconEventType {
  /** Human label, e.g. `FOMC rate decision`. */
  label: string;
  impact: EconImpact;
  /** Default release time, ET, `HH:MM` (24h). Government releases are ET; dates are pinned to the ET
   *  calendar date (R14 open-question 1) so "CPI day" matches how traders talk. */
  et: string;
  /** Publishing agency host, for attribution (e.g. `federalreserve.gov`). */
  src: string;
}

/** One economic-event row (compact — a type key + a date; per-row `et` only when it deviates from
 *  the type default). The full record the UI consumes is the row joined with its `EconEventType`. */
export interface EconEventRow {
  /** ET calendar date, `YYYY-MM-DD`. */
  d: string;
  /** Type key into `EconEventsFile.types`. */
  t: string;
  /** Per-row release time, ET `HH:MM` — present ONLY when it deviates from the type's default `et`
   *  (e.g. a holiday-shifted EIA report). Absent ⇒ the type default. */
  et?: string;
  /** Optional label suffix for a row that needs disambiguating within its type (e.g. a GDP estimate
   *  `Advance`/`2nd`/`3rd`, or an EIA `(holiday)` note) — appended to the type label in the UI. */
  note?: string;
}

/** A resolved event for a given day — the row joined with its type's defaults (label/impact/src) and
 *  the effective `et` (row override ?? type default). The pure `eventsForDay`/`eventsForMonth`
 *  helpers return these so the render layer never re-joins. */
export interface EconEvent {
  /** ET calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Type key (`fomc`/`cpi`/`nfp`/`gdp`/`eiaCl`). */
  type: string;
  /** Display label (type label + any row `note`). */
  label: string;
  impact: EconImpact;
  /** Effective release time, ET `HH:MM`. */
  et: string;
  src: string;
}

/** econ-events.json — curated US-government economic-release calendar (R14a). Same ref-data posture
 *  as the other /data files: schemaVersion + manifest cache-bust. Two-field rows keep it compact
 *  (~tens of KB); the `types` map holds the shared per-kind defaults. */
export interface EconEventsFile {
  schemaVersion?: number;
  /** ISO date the dataset was last regenerated (build-econ-events.mjs). */
  updated?: string;
  /** Inclusive coverage window of the rows below. */
  range?: { from: string; to: string };
  /** Per-kind defaults, keyed by the row `t`. */
  types?: Record<string, EconEventType>;
  /** The event rows (unsorted-tolerant; the loader sorts by date). */
  events?: EconEventRow[];
}

/** A broker's per-side commission tiers. */
export interface Broker {
  name: string;
  /** The CURRENT per-side commission tiers — everything date-agnostic reads this unchanged. */
  comm: { micro: number; std: number };
  /** A227: a paper/sim broker — NOTHING real is charged, so rateFor() models $0 all-in (no
   *  commission AND no exchange/clearing/NFA fees) and Commission Compare excludes it (A226). */
  paper?: boolean;
  /** F30: prior commission periods, oldest first — each applies to trades ON OR BEFORE `until`.
   *  Absent (the norm — brokers rarely change and never archive rates) = `comm` for all dates. */
  rateHistory?: Array<{ until: string; comm: { micro: number; std: number }; source?: string }>;
}

/** A feed group: label → list of [label, $/mo] options. */
export type FeedGroups = Record<string, Array<[string, number]>>;

/** The Section-1256 federal blend model. */
export interface TaxModel {
  fedOrdinary: number;
  ltcg: number;
  ltcgWeight: number;
  ordinaryWeight: number;
}

/** A per-state row: [abbr, top-rate %, name]. */
export type StateRow = [string, number, string];

/** The Store / DemoStore persistence interface (A4 seam). */
/** An imported CSV's file record (F37 per-file provenance). Metadata only — the raw CSV text is
 *  stored separately (Store.getFileText) so listing the library never loads megabytes of text. */
export interface CsvFileRec {
  /** Content hash of the raw text (same FNV as tradeId) — a re-upload of the same file dedupes. */
  id: string;
  /** Original filename. */
  name: string;
  /** User rename (display label); absent = show `name`. */
  label?: string;
  /** Adapter id (e.g. 'tradingview'). */
  platform: string;
  /** Adapter display label at import time. */
  platformLabel: string;
  /** Raw text size in bytes (chars) — drives the 50 MB library budget. */
  size: number;
  /** Data rows in the file. */
  rows: number;
  /** Trades this file contributed at import (including ones other files already had). */
  tradeCount: number;
  /** Trades already present when this file was imported (overlap/dup count). */
  overlap: number;
  /** Coverage range (first/last trade date). */
  from: string;
  to: string;
  /** ISO import timestamp. */
  imported: string;
  /** Include this file's trades in the active dataset (the Library toggle). */
  included: boolean;
  /** A211: broker override for THIS file's trades — a user who switched brokers marks their old
   *  files ("this file is my Schwab era") and costModel prices those trades at that broker's
   *  rates. Absent (the norm) = the global setup broker. */
  broker?: string;
  /** Epoch ms of the last local write (F58) — the record-level LWW clock for the future sync layer.
   *  Stamped by Store on addFile/updateFile; absent on records predating F58. */
  updated?: number;
}

/** A delete-log entry (F58). Every removal path in the Store records one, keyed by the removed
 *  record's id, so a delete is distinguishable from "not synced yet": addTrades consults them to
 *  suppress resurrection of a user-deleted trade on re-import, and they are the delete half of
 *  record-level last-writer-wins for the future sync layer (F62/F63). */
export type TombstoneType = 'trade' | 'journal' | 'trademeta' | 'file';
export interface Tombstone {
  /** The removed record's key — trade/trademeta id, journal date (YYYY-MM-DD), or file id. */
  id: string;
  type: TombstoneType;
  /** Epoch ms of the deletion. */
  updated: number;
}

/** A named local workspace (F59) — a dataset backed by its own IndexedDB database. The registry
 *  `[{ id, name, dbName, createdAt }]` + the active-workspace pointer live in Store.local (sync,
 *  pre-paint). "Switch workspace" = open a different DB. When the cloud tier lands (F61+), a
 *  workspace's name travels ENCRYPTED as a record — never in the plaintext registry. */
export interface Workspace {
  /** Stable id — `'default'` for the migrated legacy workspace, a `crypto.randomUUID()` for new ones. */
  id: string;
  /** User-facing name. */
  name: string;
  /** The CONCRETE IndexedDB database name backing this workspace. The Default workspace keeps the
   *  legacy name (`blotterbook` / `blotterbookStaging`) so existing data is used in place with no
   *  copy/move; new workspaces get a suffixed name (`blotterbook:<id>`). */
  dbName: string;
  /** Epoch ms of creation. */
  createdAt: number;
}

/* ── Synced-workspaces E2E crypto core (F61a) ──────────────────────────────────────────────────
 *
 * Envelope-encryption shapes for the zero-knowledge cloud tier. The server only ever sees the
 * opaque, self-describing blobs below — never a key, a symbol, a P&L, or a note in the clear.
 * Implemented in `crypto.ts` (Web Crypto for AES-GCM/AES-KW/HKDF/HMAC; Argon2id via hash-wasm for
 * the passphrase KEK). All blobs are JSON/base64-serializable so F62 can ship them over the wire. */

/** Argon2id cost parameters for the passphrase KEK (F61a). Tuned for ~200–500 ms on a typical
 *  device; travels inside a WrappedIK so a device can reproduce the KEK to unwrap the IK. */
export interface Argon2Params {
  /** Memory cost in KiB (memory-hardness). */
  memKiB: number;
  /** Time cost (passes). */
  iterations: number;
  /** Lanes / degree of parallelism. */
  parallelism: number;
  /** Derived-key length in bytes (32 = 256-bit KEK). */
  hashLen: number;
}

/** How a KEK was derived — embedded verbatim into a WrappedIK so the blob is self-describing and a
 *  fresh device can rebuild the KEK (given the passkey PRF / passphrase / recovery-key secret) to
 *  unwrap the IK. Salts are base64. The recovery path needs no stored salt (the key is full-entropy). */
export type KekDescriptor =
  { method: 'prf'; hkdfSalt: string } | { method: 'passphrase'; argon2: Argon2Params & { salt: string } } | { method: 'recovery' };

/** A key-encryption key plus the metadata needed to reproduce it. `key` is a non-extractable AES-KW
 *  CryptoKey used only to wrap/unwrap the IK; `descriptor` is what gets persisted (never the KEK). */
export interface Kek {
  key: CryptoKey;
  descriptor: KekDescriptor;
}

/** The account identity key wrapped (AES-KW) under one unlock method's KEK. One per enrolled method
 *  (passkey PRF / passphrase / escrow recovery key). The only IK representation the server stores. */
export interface WrappedIK {
  /** Blob schema version. */
  v: 1;
  /** Which unlock method's KEK wrapped the IK (also selects the descriptor branch). */
  method: KekDescriptor['method'];
  /** Wrapping algorithm — always AES key wrap. */
  alg: 'AES-KW';
  /** Base64 of the AES-KW-wrapped IK bytes. */
  wrapped: string;
  /** HKDF salt (base64) for the PRF path — present iff `method === 'prf'`. */
  hkdfSalt?: string;
  /** Argon2id params + salt for the passphrase path — present iff `method === 'passphrase'`. */
  argon2?: Argon2Params & { salt: string };
}

/** A per-workspace data-encryption key wrapped (AES-KW) under the account IK. Minted when a
 *  workspace opts into sync; adding a workspace needs no new unlock ceremony. */
export interface WrappedDek {
  v: 1;
  alg: 'AES-KW';
  /** Base64 of the AES-KW-wrapped DEK bytes. */
  wrapped: string;
}

/** One AES-GCM-encrypted record (a trade / journal / meta row). Authenticated: a flipped byte or
 *  the wrong DEK makes decryptRecord throw. IV is fresh-random per record.
 *
 *  A308 — versioned envelope: `v:1` has NO additional-authenticated-data (legacy / already-synced prod
 *  ciphertext); `v:2` binds the index metadata (`workspaceId|type|blinded_id|updated|deleted`) as GCM
 *  AAD, so a server that can WRITE the index can't forge `deleted`/`updated`/`type` without the auth
 *  tag failing. Decrypt reconstructs the AAD from the wire row for a v2 record and passes NONE for a
 *  v1 record — mixed v1/v2 workspaces decrypt transparently, so the migration never strands data. */
export interface EncryptedRecord {
  v: 1 | 2;
  alg: 'AES-GCM';
  /** Base64 of the 12-byte random IV (never reused with the same DEK). */
  iv: string;
  /** Base64 of the ciphertext with the appended GCM auth tag. */
  ct: string;
}

export interface StoreLike {
  available(): boolean;
  init(): Promise<boolean>;
  /* ---- F59 named local workspaces (per-workspace IndexedDB + a Store.local registry) ---- */
  /** The active workspace entry — the DB every read/write below targets. */
  activeWorkspace(): Workspace;
  /** Every registered workspace (seeds a single Default on first call). */
  listWorkspaces(): Workspace[];
  /** Create a new local workspace backed by a fresh (suffixed) IndexedDB; returns the entry. */
  createWorkspace(name: string): Workspace;
  /** A298: adopt a workspace that already exists in the cloud under a SPECIFIC (server) id — creates a
   *  local registry entry + per-workspace DB keyed by that id, so a synced workspace registered on
   *  another device becomes reachable here. Idempotent: returns the existing entry if the id is
   *  already local. */
  adoptWorkspace(id: string, name: string): Workspace;
  /** Rename a workspace; returns the updated entry, or undefined if the id/name was rejected. */
  renameWorkspace(id: string, name: string): Workspace | undefined;
  /** Delete a workspace: drop its whole IndexedDB (deleteDatabase) AND remove the registry entry.
   *  Refuses to delete the last remaining workspace; deleting the active one switches to another.
   *  Returns the now-active workspace. */
  deleteWorkspace(id: string): Promise<Workspace>;
  /** Switch the active workspace: persist the choice and reset the cached connection so the next
   *  store call opens the newly-active DB. Returns the now-active entry. */
  setActiveWorkspace(id: string): Promise<Workspace>;
  tradeId(t: Trade): string;
  validShot(s: unknown): boolean;
  addTrades(trades: Trade[]): Promise<{ added: number; duplicate: number; total: number }>;
  /* ---- F37 per-file CSV provenance ---- */
  getFiles(): Promise<CsvFileRec[]>;
  /** Persist a file record + its raw text (text stored separately from the metadata row). */
  addFile(rec: CsvFileRec, text: string): Promise<unknown>;
  /** Patch mutable metadata (label, included, overlap). */
  updateFile(id: string, patch: Partial<CsvFileRec>): Promise<unknown>;
  /** Remove the file record + raw text, strip its id from every trade's fileIds, and DELETE trades
   *  whose provenance becomes empty (trades another file also contributed survive). */
  deleteFile(id: string): Promise<{ removedTrades: number }>;
  /** The stored raw CSV text (download-original / re-import), or undefined. */
  getFileText(id: string): Promise<string | undefined>;
  /** Total stored raw-CSV bytes (the 50 MB budget check). */
  filesBytes(): Promise<number>;
  getAllTrades(): Promise<Trade[]>;
  tradeCount(): Promise<number>;
  deleteTrade(id: string): Promise<unknown>;
  updateTrade(oldId: string, next: Trade, meta?: { tags?: string[]; note?: string; shots?: string[] }): Promise<{ id: string }>;
  saveJournal(date: string, rec: string | Annotation): Promise<unknown>;
  getJournal(date: string): Promise<Required<Annotation>>;
  journalDates(): Promise<Set<string>>;
  getAllJournal(): Promise<StoredJournal[]>;
  deleteJournal(date: string): Promise<unknown>;
  getAllMeta(): Promise<Array<{ key: string; value: unknown; updated?: number }>>;
  getTradeMeta(id: string): Promise<StoredTradeMeta>;
  saveTradeMeta(id: string, m: TradeMeta): Promise<unknown>;
  deleteTradeMeta(id: string): Promise<unknown>;
  allTradeMeta(): Promise<StoredTradeMeta[]>;
  /** All delete-log tombstones (F58) — read by the future sync layer (F62/F63) to propagate deletes;
   *  writes are internal (every removal path records one). */
  getTombstones(): Promise<Tombstone[]>;
  exportAll(): Promise<Record<string, unknown>>;
  importAll(data: Record<string, unknown>): Promise<{ added: number; dup: number }>;
  setMeta(key: string, value: unknown): Promise<unknown>;
  getMeta(key: string): Promise<unknown>;
  purge(): Promise<boolean>;
  local: {
    get(key: string, fallback?: unknown): unknown;
    set(key: string, val: unknown): boolean;
    remove(key: string): void;
  };
}
