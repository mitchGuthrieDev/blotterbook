// Dashboard tabs state factory (A135; promoted to all surfaces — CH16). Extracted from App.svelte
// (A224 — the Svelte adoption survey's dead-context + monolith findings): multiple named dashboards,
// each with its own module layout, persisted to the Store.local seam (staging-namespaced keys) so
// hide/reorder/re-add survives a reload. A .svelte.ts module so the factory can own runes (mirrors
// createDashboard/createPagination — factory fn returning a runes-backed object with getters).
import type { StoreLike } from '../../lib/core/types.ts';
import { emit } from '../../lib/core/core.ts';

export type DashTab = { id: string; name: string };

export function createDashTabs(store: StoreLike, opts: { isStaging: boolean }) {
  const { isStaging } = opts;
  // Dashboard module layout, persisted to the Store.local seam (staging-namespaced) so hide/reorder/
  // re-add survives a reload — parity with the app/demo workspace layout.
  const MOD_KEY = isStaging ? 'bb:staging:dashModules' : 'bb:dashModules';
  // The 'main' tab maps to the legacy MOD_KEY so an existing layout carries over; other tabs persist
  // under suffixed keys. The key is per-surface namespaced like MOD_KEY/WS_KEY; on demo the in-memory
  // DemoStore.local means tab edits work but never persist (by construction).
  const TABS_KEY = isStaging ? 'bb:staging:dashTabs' : 'bb:dashTabs';
  const persistedTabs = store.local.get(TABS_KEY, null) as { tabs: DashTab[]; active: string } | null;
  let dashTabs = $state<DashTab[]>(persistedTabs?.tabs?.length ? persistedTabs.tabs : [{ id: 'main', name: 'Main' }]);
  let activeDashTab = $state<string>(
    persistedTabs?.active && (persistedTabs.tabs ?? []).some(t => t.id === persistedTabs.active) ? persistedTabs.active : 'main'
  );
  const modKeyFor = (tabId: string) => (tabId === 'main' ? MOD_KEY : `${MOD_KEY}:${tabId}`);
  function persistTabs() {
    store.local.set(TABS_KEY, { tabs: $state.snapshot(dashTabs), active: activeDashTab });
  }
  // A186/A189: module-layout edits STAGE in memory and persist only on an explicit Save — the tab
  // shows a dirty asterisk meanwhile. Unsaved edits survive tab SWITCHES (in-memory drafts) but are
  // deliberately discarded on reload (the persisted layout is the saved one).
  let dirtyTabs = $state<string[]>([]);
  const draftLayouts: Record<string, string[] | undefined> = {};
  const markDirty = (id: string) => {
    if (!dirtyTabs.includes(id)) dirtyTabs = [...dirtyTabs, id];
  };
  const clearDirty = (id: string) => (dirtyTabs = dirtyTabs.filter(t => t !== id));

  // svelte-ignore state_referenced_locally — initial read only; selectDashTab reassigns on switch.
  let dashModules = $state<string[] | undefined>((store.local.get(modKeyFor(activeDashTab)) as string[] | null) ?? undefined);

  function selectDashTab(id: string) {
    if (id === activeDashTab) return;
    if (dirtyTabs.includes(activeDashTab)) draftLayouts[activeDashTab] = dashModules ? [...dashModules] : undefined;
    activeDashTab = id;
    dashModules = dirtyTabs.includes(id)
      ? draftLayouts[id] && [...(draftLayouts[id] as string[])]
      : ((store.local.get(modKeyFor(id)) as string[] | null) ?? undefined);
    persistTabs();
  }
  // Drag-reorder (A186; A192): DashTabs commits the FINAL order once, on drop — one persist per
  // completed drag. Ignore an order that isn't a permutation of the current tabs (stale drop).
  function reorderDashTabs(ids: string[]) {
    if (ids.length !== dashTabs.length) return;
    const byId = new Map(dashTabs.map(t => [t.id, t]));
    const next = ids.map(id => byId.get(id)).filter((t): t is DashTab => !!t);
    if (next.length !== dashTabs.length) return;
    dashTabs = next;
    persistTabs();
  }
  // Persist the ACTIVE tab's staged layout (the DashTabs Save button; clears the asterisk).
  function saveTabLayout() {
    if (dashModules) store.local.set(modKeyFor(activeDashTab), $state.snapshot(dashModules));
    else store.local.remove(modKeyFor(activeDashTab));
    delete draftLayouts[activeDashTab];
    clearDirty(activeDashTab);
  }
  function createDashTab() {
    // A198: no naming prompt — create immediately as "New tab N" (lowest unused N);
    // the DashTabs menu → Rename covers the real name afterward.
    let n = 1;
    const names = new Set(dashTabs.map(t => t.name));
    while (names.has(`New tab ${n}`)) n++;
    const name = `New tab ${n}`;
    const id = Date.now().toString(36) + dashTabs.length;
    dashTabs = [...dashTabs, { id, name }];
    selectDashTab(id); // persists tabs + active
    emit('tab:created', { name }); // A188 — activity-log line
  }
  function renameDashTab(id: string) {
    const cur = dashTabs.find(t => t.id === id);
    const name = typeof prompt === 'function' ? prompt('Rename tab', cur?.name ?? '') : null;
    if (!name || !name.trim()) return;
    dashTabs = dashTabs.map(t => (t.id === id ? { ...t, name: name.trim() } : t));
    persistTabs();
  }
  function moveDashTab(id: string, dir: -1 | 1) {
    const i = dashTabs.findIndex(t => t.id === id),
      j = i + dir;
    if (i < 0 || j < 0 || j >= dashTabs.length) return;
    const next = [...dashTabs];
    [next[i], next[j]] = [next[j], next[i]];
    dashTabs = next;
    persistTabs();
  }
  function deleteDashTab(id: string) {
    if (dashTabs.length === 1) return;
    if (typeof confirm === 'function' && !confirm('Delete this dashboard tab? Its module layout is removed.')) return;
    store.local.remove(modKeyFor(id));
    delete draftLayouts[id];
    clearDirty(id);
    dashTabs = dashTabs.filter(t => t.id !== id);
    if (activeDashTab === id) selectDashTab(dashTabs[0].id);
    else persistTabs();
  }
  // A186: layout changes STAGE (dirty asterisk) — saveTabLayout() persists them.
  function saveModules(order: string[]) {
    dashModules = order;
    markDirty(activeDashTab);
  }
  // Reset the layout to the default (all modules shown, default order) — staged like any edit.
  function revertModules() {
    dashModules = undefined;
    markDirty(activeDashTab);
  }

  return {
    get dashTabs() {
      return dashTabs;
    },
    get activeDashTab() {
      return activeDashTab;
    },
    get dirtyTabs() {
      return dirtyTabs;
    },
    get dashModules() {
      return dashModules;
    },
    selectDashTab,
    reorderDashTabs,
    saveTabLayout,
    createDashTab,
    renameDashTab,
    moveDashTab,
    deleteDashTab,
    saveModules,
    revertModules,
  };
}

export type DashTabsState = ReturnType<typeof createDashTabs>;
