#!/usr/bin/env node
/* F59 — named local workspaces: the real Store's workspace registry (per-workspace IndexedDB naming +
   the Store.local registry). The registry logic is pure localStorage; the only IndexedDB touch here is
   indexedDB.deleteDatabase on delete. Node has neither, so we install tiny in-memory shims BEFORE
   importing store.ts (which reads them lazily, never at module load), then exercise:
     - first-boot migration seeds a single Default → the LEGACY db name, in place (no copy/move), idempotent
     - createWorkspace mints a fresh SUFFIXED db name; rename semantics; unknown-id rejection
     - setActiveWorkspace resolves to a DIFFERENT dataset (dbName) — "switch = open a different DB"
     - deleteWorkspace drops the whole IndexedDB (deleteDatabase called) + the registry entry; deleting
       the active one switches away; refuses to delete the last remaining workspace
   Runs with Node built-ins only. */
import assert from 'node:assert/strict';

let pass = 0;
const ok = (name, cond) => {
  assert.ok(cond, name);
  console.log('  ok  ' + name);
  pass++;
};

console.log('F59 — named local workspaces (Store registry + per-workspace IndexedDB naming)');

// In-memory localStorage shim (the registry lives here).
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: k => void mem.delete(k),
  clear: () => mem.clear(),
  key: i => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};
// indexedDB shim — only deleteDatabase is exercised by the registry ops (open() is never called here).
const deletedDbs = [];
globalThis.indexedDB = {
  deleteDatabase(name) {
    deletedDbs.push(name);
    const req = {};
    queueMicrotask(() => req.onsuccess && req.onsuccess());
    return req;
  },
};

// Import AFTER the shims are in place (store.ts reads localStorage/indexedDB lazily, not at load).
const { Store } = await import('../src/lib/core/store.ts');

// ── first-boot migration: seed a single Default → the legacy DB name, in place ──
{
  const reg = Store.listWorkspaces();
  ok('seeds exactly one workspace on first call', Array.isArray(reg) && reg.length === 1);
  ok('the seeded workspace is Default', reg[0].name === 'Default' && reg[0].id === 'default');
  ok('Default maps to the LEGACY db name (data used in place, no copy)', reg[0].dbName === 'blotterbook');
  ok('createdAt is a number', typeof reg[0].createdAt === 'number');
  ok('active workspace is Default', Store.activeWorkspace().id === 'default');
  // idempotency: a second resolution neither duplicates nor re-seeds.
  const reg2 = Store.listWorkspaces();
  ok('migration is idempotent (still one workspace)', reg2.length === 1 && reg2[0].id === 'default');
}

// ── createWorkspace: fresh suffixed DB name; the roster grows ──
let created;
{
  created = Store.createWorkspace('  Scalps  ');
  ok('createWorkspace trims the name', created.name === 'Scalps');
  ok('new workspace gets a fresh suffixed db name', created.dbName === `blotterbook:${created.id}` && created.id !== 'default');
  ok('new db name differs from Default (isolated dataset)', created.dbName !== 'blotterbook');
  ok('roster now has two workspaces', Store.listWorkspaces().length === 2);
  const blank = Store.createWorkspace('   ');
  ok('a blank name falls back to a default label', blank.name === 'Workspace');
  ok('two distinct ids are minted', blank.id !== created.id);
  await Store.deleteWorkspace(blank.id); // clean up the label-probe workspace → back to Default + Scalps
  ok('roster back to two after cleanup', Store.listWorkspaces().length === 2);
}

// ── rename semantics ──
{
  const upd = Store.renameWorkspace(created.id, 'Scalps v2');
  ok('renameWorkspace returns the updated entry', upd && upd.name === 'Scalps v2');
  ok('rename persists to the registry', Store.listWorkspaces().find(w => w.id === created.id).name === 'Scalps v2');
  ok('renaming an unknown id returns undefined', Store.renameWorkspace('nope', 'x') === undefined);
  ok('an empty rename is rejected (returns undefined)', Store.renameWorkspace(created.id, '   ') === undefined);
}

// ── setActiveWorkspace: switch resolves to a DIFFERENT dataset (dbName) ──
{
  const beforeDb = Store.activeWorkspace().dbName;
  const now = await Store.setActiveWorkspace(created.id);
  ok('setActiveWorkspace returns the target', now.id === created.id);
  ok('active workspace switched', Store.activeWorkspace().id === created.id);
  ok('the active dataset (dbName) is now different', Store.activeWorkspace().dbName !== beforeDb);
  const stay = await Store.setActiveWorkspace('unknown-id');
  ok('switching to an unknown id is a no-op', stay.id === created.id && Store.activeWorkspace().id === created.id);
}

// ── deleteWorkspace: drops the IndexedDB + the registry entry; refuses the last one ──
{
  // Delete the ACTIVE (created) workspace → the store switches back to Default and deletes its DB.
  const activeDb = Store.activeWorkspace().dbName;
  const nowActive = await Store.deleteWorkspace(created.id);
  ok('deleting the active workspace switches away (to Default)', nowActive.id === 'default' && Store.activeWorkspace().id === 'default');
  ok('the deleted workspace is gone from the registry', !Store.listWorkspaces().some(w => w.id === created.id));
  ok('deleteDatabase dropped the whole per-workspace IndexedDB', deletedDbs.includes(activeDb));
  ok('registry back to a single workspace', Store.listWorkspaces().length === 1);
  // Refuse to delete the last remaining workspace.
  await assert.rejects(() => Store.deleteWorkspace('default'), /last workspace/i);
  ok('refuses to delete the last remaining workspace', Store.listWorkspaces().length === 1);
}

// ── a dangling active pointer self-repairs to the first workspace ──
{
  localStorage.setItem('bb:activeWorkspace', JSON.stringify('ghost'));
  ok('a dangling active id repairs to the first workspace', Store.activeWorkspace().id === 'default');
  ok('the active pointer is rewritten', JSON.parse(localStorage.getItem('bb:activeWorkspace')) === 'default');
}

console.log(`\n${pass} passed, 0 failed`);
