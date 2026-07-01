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
  /** Within-file ordinal (2nd+ occurrence of an identical time|symbol|side|pnl) so genuinely
   *  distinct same-second trades aren't collapsed by the dedupe key (A114). Unset ⇒ 0 (first/unique). */
  dup?: number;
  /** PnL was derived from price × a FALLBACK point value ($1/point) because the root has no known
   *  contract size — the figure is a guess and is surfaced to the user (A113). */
  pvEstimated?: boolean;
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
}

/** A platform CSV adapter (one per supported export format). */
export interface Adapter {
  id: string;
  label: string;
  kind: 'closed' | 'fills';
  beta: boolean;
  sniff(text: string, rows: Row[]): number;
  toTrades(text: string, rows: Row[]): Trade[];
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
}

/** Inputs to costModel() — the cost setup (A32). */
export interface CostInputs {
  broker?: string;
  platform?: number | string;
  feedCost?: number | string;
  stateRate?: number | string;
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
}

/** The persisted filter payload of a saved view (vanilla-compatible `f` shape; `symbol` holds root). */
export interface SavedFilterDef {
  from?: string;
  to?: string;
  symbol?: string;
  side?: string;
  session?: string;
  tag?: string;
  dows?: number[];
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

/** exchange-fees.json — per-root exchange/clearing/NFA $ per side + the micro-tier root set. */
export interface ExchangeFeesFile {
  schemaVersion?: number;
  exchange?: Record<string, number>;
  micro?: string[];
  fallback?: { micro: number; std: number };
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

/** A broker's per-side commission tiers. */
export interface Broker {
  name: string;
  comm: { micro: number; std: number };
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
export interface StoreLike {
  available(): boolean;
  init(): Promise<boolean>;
  tradeId(t: Trade): string;
  validShot(s: unknown): boolean;
  addTrades(trades: Trade[]): Promise<{ added: number; duplicate: number; total: number }>;
  getAllTrades(): Promise<Trade[]>;
  tradeCount(): Promise<number>;
  deleteTrade(id: string): Promise<unknown>;
  updateTrade(oldId: string, next: Trade, meta?: { tags?: string[]; note?: string; shots?: string[] }): Promise<{ id: string }>;
  saveJournal(date: string, rec: string | Annotation): Promise<unknown>;
  getJournal(date: string): Promise<Required<Annotation>>;
  journalDates(): Promise<Set<string>>;
  getAllJournal(): Promise<StoredJournal[]>;
  deleteJournal(date: string): Promise<unknown>;
  getAllMeta(): Promise<Array<{ key: string; value: unknown }>>;
  getTradeMeta(id: string): Promise<StoredTradeMeta>;
  saveTradeMeta(id: string, m: TradeMeta): Promise<unknown>;
  deleteTradeMeta(id: string): Promise<unknown>;
  allTradeMeta(): Promise<StoredTradeMeta[]>;
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
