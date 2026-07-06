---
name: backlog-upkeep
description: Run Blotterbook's every-session backlog ritual — file new items in the exact schema, close done items per the donePolicy (strip prompt, move to backlog_archive.json), never touch recurring items, bump the top-level updated date, and keep the manifest/format clean. Use when asked to "file a backlog item", "mark A### done", "archive the done items", or during an end-of-session backlog sweep.
---

# Backlog upkeep

`static/data/backlog.json`'s own `donePolicy` field (quoted in full below) is the canonical rule;
this skill is the operating procedure around it, per `docs/skills-shortlist-a196.md` §2. The active
backlog is `static/data/backlog.json`; completed items live in `static/data/backlog_archive.json` —
**the admin panel merges both**, so ids must stay unique across the two files.

## The donePolicy (verbatim from backlog.json)

> When an item's status is set to `done`, delete its `prompt` field and keep only the `doneNote` —
> the doneNote is the shipped record of what was actually done, so the original prompt is redundant
> and only bloats this file (the admin backlog panel never renders done-item prompts anyway). Keep
> `prompt` on `open` and `guardrail` items, since those are still the actionable spec. Applies
> retroactively: a done item should never carry a prompt. RECURRING ITEMS: an item with
> `recurring: true` (e.g. R1 repo audit, CH16 staging→prod promotion) is a perpetual driver — NEVER
> set its status to done, set completedDate, or strip its prompt; it stays open across every run and
> its prompt leads with a RECURRING/REPEATABLE marker. Each run ships its output as new items, not by
> closing the recurring item. ARCHIVE (post-split): completed items now live in
> `data/backlog_archive.json`. When you set an item to `done` and strip its prompt, MOVE the item
> object out of backlog.json into backlog_archive.json (the admin panel merges both). Recurring items
> never move — they stay open in backlog.json.

## Item schema

```json
{
  "id": "A###",
  "title": "…",
  "category": "one of the categories[] list",
  "priority": "P1|P2|P3",
  "effort": "tiny|small|medium|large|ongoing",
  "status": "open|guardrail|done",
  "completedDate": null,
  "partial": false,
  "recurring": true,
  "prompt": "…",
  "doneNote": null
}
```

`recurring` is omitted entirely on non-recurring items (don't add `"recurring": false`). Prefixes in
use: `A` (general), `B`/`C`/`CH`/`F`/`L`/`R`/`S` (area-scoped — match the prefix of whatever's already
nearby, or `A` if none obviously fits).

## Procedure

1. **Filing a new item:** find the next free id for the chosen prefix by scanning the `id` field
   across **both** `backlog.json` and `backlog_archive.json` (not just one file) and taking
   highest-plus-one. Write a **self-contained prompt** — scope, constraints, and an explicit "done
   when" clause — good enough that a fresh agent with no other context could execute it; use nearby
   items as the quality bar, not a one-line stub. Append to `items[]`, `status: "open"`,
   `completedDate: null`, `doneNote: null`.
2. **Closing an item as done:** set `status: "done"`, `completedDate` to today (YYYY-MM-DD), write
   `doneNote` as the shipped record (what actually landed, file:line/behavior specifics — mirror the
   style of existing `doneNote`s), **delete the `prompt` key**, then **move the whole object** out of
   `items[]` in `backlog.json` into `items[]` in `backlog_archive.json`.
3. **Recurring items (`recurring: true`) are NEVER closed.** Don't set `done`, don't set
   `completedDate`, don't strip the prompt, don't move them. Each run's output becomes new filed
   items instead; the recurring item's prompt typically accumulates a dated "— RUN YYYY-MM-DD: …"
   note rather than being replaced.
4. **Partial work:** `"partial": true` with status still `open` (or `done` if the remaining scope was
   explicitly descoped elsewhere) — don't invent a third status value.
5. **Bump `"updated"`** at the top level of `backlog.json` to today's date whenever you touch the
   file.
6. **Verify + format:** `node scripts/build-manifest.mjs` and confirm `static/data/manifest.json`
   does NOT move (backlog.json/backlog_archive.json are not cache-busted assets — if the manifest
   changes, something else drifted); then `npx prettier --write static/data/backlog.json
   static/data/backlog_archive.json` (or `npm run format`) so the JSON stays diff-clean.
7. **Never hand-edit** `static/data/versions.json` or `static/data/changelog.json` from this skill —
   those are CH12 (automated) and the separate changelog ritual, respectively.

**Done when:** every filed/closed item is uniquely id'd across both files, done items carry a
`doneNote` and no `prompt` and live in `backlog_archive.json`, recurring items are untouched and
still open in `backlog.json`, `updated` is bumped, the manifest shows no movement, and both JSON
files are Prettier-clean.
