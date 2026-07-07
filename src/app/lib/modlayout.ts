// A271 — dashboard module SIZE model + layout persistence migration. Pure + node-testable (imported by
// dashtabs.svelte.ts for persistence and Dashboard.svelte for render), so the migration + size math has
// one home and stays framework-agnostic.
//
// Modules gain a Small / Medium / Large size on a 12-track grid (sm = span 2, six-per-row; md = span 6,
// half-width; lg = span 12, full-width). The persisted layout migrates from the v1 `string[]` (order
// only) to a versioned `{ v: 2, mods: { key, size }[] }` — LOSSLESSLY: a v1 array upgrades with
// `defaultSizeFor` (paired/half-width modules → md, the rest → lg), which reproduces TODAY's exact
// visual layout so no existing dashboard shifts on upgrade.

export type ModSize = 'sm' | 'md' | 'lg';
export type ModEntry = { key: string; size: ModSize };
export type ModLayout = { v: 2; mods: ModEntry[] };

/** Every module key the dashboard knows (mirrors Dashboard.svelte's MODULES — the source of the labels). */
export const MODULE_KEYS = ['perf', 'cal', 'cost', 'adv', 'term', 'compare', 'blotter', 'today', 'ddstatus', 'streak'] as const;
/** The default layout (order) shown on a fresh dashboard. */
export const DEFAULT_MODULE_KEYS: string[] = ['perf', 'cal', 'cost', 'adv', 'term'];
/** Half-width modules today (lg:col-span-1 in the old 2-col grid) → default to Medium (span 6). The rest
 *  (perf / compare / blotter) were full-width → Large (span 12). */
export const PAIRED_MODULE_KEYS = new Set(['cal', 'cost', 'adv', 'term', 'today', 'ddstatus', 'streak']);

const SIZES: ModSize[] = ['sm', 'md', 'lg'];
const isKnownKey = (k: unknown): k is string => typeof k === 'string' && (MODULE_KEYS as readonly string[]).includes(k);
const isSize = (s: unknown): s is ModSize => typeof s === 'string' && (SIZES as string[]).includes(s);

/** Default size that PRESERVES today's visual layout on upgrade: paired (half-width) → md, others → lg. */
export const defaultSizeFor = (key: string): ModSize => (PAIRED_MODULE_KEYS.has(key) ? 'md' : 'lg');

/** 12-track grid span per size — sm six-per-row, md half, lg full. */
export const spanFor = (size: ModSize): number => (size === 'sm' ? 2 : size === 'md' ? 6 : 12);

/** Which sizes a module supports. The current dashboard modules are rich (tables/charts), so they
 *  support Medium ↔ Large (half ↔ full width; the two states that render well) — a span-2 "Small"
 *  would cram their content. `sm` stays in the model (grid + migration understand it) for future
 *  glanceable KPI-card modules + the carousel group; no current module opts into it yet. */
export const supportedSizes = (_key: string): ModSize[] => ['md', 'lg'];

/** Validate a stored size for a key, else fall back to the layout-preserving default. */
export const clampSize = (key: string, size: unknown): ModSize =>
  isSize(size) && supportedSizes(key).includes(size) ? size : defaultSizeFor(key);

/** Lossless read-time migration. `null`/`undefined` → undefined (= the default layout). A v1 `string[]`
 *  (order only) upgrades with `defaultSizeFor`. A `{ v: 2, mods }` object passes through, dropping
 *  unknown keys and clamping unsupported sizes. Anything else → undefined (treat as default). */
export function migrateLayout(stored: unknown): ModLayout | undefined {
  if (stored == null) return undefined;
  if (Array.isArray(stored)) {
    return { v: 2, mods: stored.filter(isKnownKey).map(k => ({ key: k, size: defaultSizeFor(k) })) };
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
export const defaultLayout = (): ModLayout => ({ v: 2, mods: DEFAULT_MODULE_KEYS.map(k => ({ key: k, size: defaultSizeFor(k) })) });

/** Order-only key list (for consumers that only care about order, e.g. workspace templates). */
export const keysOf = (mods: ModEntry[] | undefined): string[] => (mods ?? []).map(m => m.key);

/** Drop unknown keys + clamp sizes on an in-memory ModEntry[] (the render-time guard, ex-`validKeys`). */
export const validLayout = (mods: ModEntry[] | undefined): ModEntry[] =>
  (mods ?? DEFAULT_MODULE_KEYS.map(k => ({ key: k, size: defaultSizeFor(k) })))
    .filter(m => isKnownKey(m?.key))
    .map(m => ({ key: m.key, size: clampSize(m.key, m.size) }));
