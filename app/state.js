'use strict';
/* Blotterbook app · state — shared mutable cross-module application state.

   In the classic-script era (the former monolithic app.js, later the
   core→…→main script split) these lived as bare `let` globals on the one
   shared window scope, reassigned freely from any file. Under native ES
   modules an imported binding is READ-ONLY — a module can read `import { X }`
   but cannot do `X = …` — so every value that is reassigned from more than one
   module lives here on a single shared object instead. Read and write through
   `state.X` (e.g. `state.TRADES = all`, `if (!state.METRICS_ALL) return`).

   Values that are NOT reassigned across modules stay in their owning module:
   the const objects FILTERS / curveSel (only their PROPERTIES mutate — render.js)
   and module-local lets like APP_FLAGS / DAY_EDIT / jSaveTimer (data.js),
   EXPORT_CUR (export.js). Those are plain `export`s, not state members. */

export const state = {
  // dataset + derived metrics (render.js / data.js / datamanager.js)
  TRADES: [], // working trade list (already merged/persisted)
  METRICS_ALL: null, // compute() result over the filtered base set
  SCOPE: 'all', // 'all' | 'month'
  calYear: undefined, // calendar cursor (year)
  calMonth: undefined, // calendar cursor (0-based month)
  selectedDate: null, // 'YYYY-MM-DD' highlighted from the calendar / curve
  JOURNAL_DATES: new Set(), // dates carrying a saved note (calendar/curve dots)
  TRADE_META: new Map(), // trade id -> { id, tags:[], note, shots:[] }
  DEMO_MODE: false, // demo data is in-memory; suppresses ALL persistence

  // CSV staging (data.js / main.js)
  PENDING: null, // { ctx, rawText, name, result } staged but not committed
  FILE_CTX: 'landing', // which file-input context is active

  // saved filters (data.js / datamanager.js)
  SAVED_FILTERS: [],

  // staging landing flow (data.js / main.js)
  STAGING_DATA_READY: false,

  // data-manager UI (datamanager.js / main.js)
  DM_SEARCH: '', // trades-table search query
  DM_EDIT: null, // active per-trade editor state
};
