// A271 — module SIZE model + layout-persistence migration. Pure + node-testable (imported by
// dashtabs.svelte.ts + Dashboard.svelte for the dashboard, and by App.svelte + Analytics.svelte for
// the analytics screen), so the migration + size math has one home and stays framework-agnostic.
//
// Modules gain a Small / Medium / Large size on a 12-track grid (sm = span 2, six-per-row; md = span 6,
// half-width; lg = span 12, full-width). A screen's persisted layout migrates from the v1 `string[]`
// (order only) to a versioned `{ v: 2, mods: { key, size }[] }` — LOSSLESSLY: a v1 array upgrades with
// the screen's `defaultSizeFor`, which reproduces that screen's TODAY visual layout so no existing
// dashboard/analytics layout shifts on upgrade.
//
// A271 slice (2026-07-07): the size model is per-screen — each screen supplies its own module domain
// (known keys, default layout, default-size + supported-sizes rules) via a LayoutSpec, and gets a bound
// LayoutKit of migrate/validate helpers from `makeLayoutKit`. The Dashboard exports below are the
// original A271 API, now implemented over the shared factory (behavior unchanged); Analytics adds a
// second spec/kit at the bottom.

export type ModSize = 'sm' | 'md' | 'lg';
export type ModEntry = { key: string; size: ModSize };
export type ModLayout = { v: 2; mods: ModEntry[] };

const SIZES: ModSize[] = ['sm', 'md', 'lg'];
const isSize = (s: unknown): s is ModSize => typeof s === 'string' && (SIZES as string[]).includes(s);

/** 12-track grid span per size — sm six-per-row, md half, lg full. */
export const spanFor = (size: ModSize): number => (size === 'sm' ? 2 : size === 'md' ? 6 : 12);

/** Order-only key list (for consumers that only care about order, e.g. workspace templates). */
export const keysOf = (mods: ModEntry[] | undefined): string[] => (mods ?? []).map(m => m.key);

/** A per-screen module domain: known keys, the default (fresh) layout order, the layout-preserving
 *  default size for a key, and which sizes each key supports. */
export type LayoutSpec = {
  keys: readonly string[];
  defaultKeys: string[];
  defaultSizeFor: (key: string) => ModSize;
  supportedSizes: (key: string) => ModSize[];
};

/** The migrate/validate helpers a screen needs, bound to one LayoutSpec. */
export type LayoutKit = {
  defaultSizeFor: (key: string) => ModSize;
  supportedSizes: (key: string) => ModSize[];
  clampSize: (key: string, size: unknown) => ModSize;
  migrateLayout: (stored: unknown) => ModLayout | undefined;
  defaultLayout: () => ModLayout;
  validLayout: (mods: ModEntry[] | undefined) => ModEntry[];
};

/** Bind the pure migration + size math to a screen's module domain. */
export function makeLayoutKit(spec: LayoutSpec): LayoutKit {
  const isKnownKey = (k: unknown): k is string => typeof k === 'string' && spec.keys.includes(k);

  /** Validate a stored size for a key, else fall back to the layout-preserving default. */
  const clampSize = (key: string, size: unknown): ModSize =>
    isSize(size) && spec.supportedSizes(key).includes(size) ? size : spec.defaultSizeFor(key);

  /** Lossless read-time migration. `null`/`undefined` → undefined (= the default layout). A v1
   *  `string[]` (order only) upgrades with `defaultSizeFor`. A `{ v: 2, mods }` object passes through,
   *  dropping unknown keys and clamping unsupported sizes. Anything else → undefined (treat as default). */
  function migrateLayout(stored: unknown): ModLayout | undefined {
    if (stored == null) return undefined;
    if (Array.isArray(stored)) {
      return { v: 2, mods: stored.filter(isKnownKey).map(k => ({ key: k, size: spec.defaultSizeFor(k) })) };
    }
    if (typeof stored === 'object' && (stored as { v?: unknown }).v === 2 && Array.isArray((stored as { mods?: unknown }).mods)) {
      const mods = (stored as { mods: unknown[] }).mods
        .filter((e): e is { key: string; size?: unknown } => !!e && typeof e === 'object' && isKnownKey((e as { key?: unknown }).key))
        .map(e => ({ key: e.key, size: clampSize(e.key, (e as { size?: unknown }).size) }));
      return { v: 2, mods };
    }
    return undefined;
  }

  /** Build the default layout (all default modules at their layout-preserving default size). */
  const defaultLayout = (): ModLayout => ({ v: 2, mods: spec.defaultKeys.map(k => ({ key: k, size: spec.defaultSizeFor(k) })) });

  /** Drop unknown keys + clamp sizes on an in-memory ModEntry[] (the render-time guard, ex-`validKeys`). */
  const validLayout = (mods: ModEntry[] | undefined): ModEntry[] =>
    (mods ?? spec.defaultKeys.map(k => ({ key: k, size: spec.defaultSizeFor(k) })))
      .filter(m => isKnownKey(m?.key))
      .map(m => ({ key: m.key, size: clampSize(m.key, m.size) }));

  return { defaultSizeFor: spec.defaultSizeFor, supportedSizes: spec.supportedSizes, clampSize, migrateLayout, defaultLayout, validLayout };
}

// ── Dashboard domain (the original A271 API — bound to the dashboard spec). ──────────────────────
/** Every module key the dashboard knows (mirrors Dashboard.svelte's MODULES — the source of the labels). */
export const MODULE_KEYS = ['perf', 'cal', 'cost', 'adv', 'term', 'compare', 'blotter', 'today', 'ddstatus', 'streak'] as const;
/** The default layout (order) shown on a fresh dashboard. */
export const DEFAULT_MODULE_KEYS: string[] = ['perf', 'cal', 'cost', 'adv', 'term'];
/** Half-width modules today (lg:col-span-1 in the old 2-col grid) → default to Medium (span 6). The rest
 *  (perf / compare / blotter) were full-width → Large (span 12). */
export const PAIRED_MODULE_KEYS = new Set(['cal', 'cost', 'adv', 'term', 'today', 'ddstatus', 'streak']);

/** Default size that PRESERVES today's visual layout on upgrade: paired (half-width) → md, others → lg. */
export const defaultSizeFor = (key: string): ModSize => (PAIRED_MODULE_KEYS.has(key) ? 'md' : 'lg');

/** Which sizes a module supports. The current dashboard modules are rich (tables/charts), so they
 *  support Medium ↔ Large (half ↔ full width; the two states that render well) — a span-2 "Small"
 *  would cram their content. `sm` stays in the model (grid + migration understand it) for future
 *  glanceable KPI-card modules + the carousel group; no current module opts into it yet. */
export const supportedSizes = (_key: string): ModSize[] => ['md', 'lg'];

const DASH_SPEC: LayoutSpec = { keys: MODULE_KEYS, defaultKeys: DEFAULT_MODULE_KEYS, defaultSizeFor, supportedSizes };
const dashKit = makeLayoutKit(DASH_SPEC);
export const clampSize = dashKit.clampSize;
export const migrateLayout = dashKit.migrateLayout;
export const defaultLayout = dashKit.defaultLayout;
export const validLayout = dashKit.validLayout;

// ── Analytics domain (A271 slice — the Analytics screen's module grid). ──────────────────────────
/** Every module key the Analytics screen knows (mirrors Analytics.svelte's ANALYTICS_LABEL). */
export const ANALYTICS_MODULE_KEYS = ['dist', 'dd', 'ls', 'hour', 'wday', 'sym', 'tag', 'stats'] as const;
/** The default layout (order) shown on the Analytics screen — the full curated set, no hide/add. */
export const ANALYTICS_DEFAULT_KEYS: string[] = ['dist', 'dd', 'ls', 'hour', 'wday', 'sym', 'tag', 'stats'];
/** Full-width Analytics modules today (lg:col-span-2) → default to Large (span 12). The rest — the
 *  paired half-width drawdown / long-short / by-hour / by-weekday cards — default to Medium (span 6),
 *  reproducing today's exact 2-column layout on upgrade. */
export const ANALYTICS_FULL_KEYS = new Set(['dist', 'sym', 'tag', 'stats']);
export const analyticsDefaultSizeFor = (key: string): ModSize => (ANALYTICS_FULL_KEYS.has(key) ? 'lg' : 'md');

/** The Analytics kit — same md ↔ lg discrete states as the dashboard (rich tables/charts skip Small). */
export const analyticsKit = makeLayoutKit({
  keys: ANALYTICS_MODULE_KEYS,
  defaultKeys: ANALYTICS_DEFAULT_KEYS,
  defaultSizeFor: analyticsDefaultSizeFor,
  supportedSizes: () => ['md', 'lg'],
});
