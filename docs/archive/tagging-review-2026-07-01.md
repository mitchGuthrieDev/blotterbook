# Tagging review — what tagging means in Blotterbook (R17)

**Decision record, 2026-07-01.** Closes backlog **R17** ("Review: purpose of the 'Tagged trades'
Overview stat + what tagging means"). R17 predates the CH16 cutover; both of its premises have
drifted — this review re-grounds the questions in the current app and decides them.

## Where the premises drifted

- **The "Tagged trades" Overview stat no longer exists.** It lived in the old vanilla Manage-data
  → Overview section, which the CH16 cutover replaced with the CSV Library screen. There is no
  stat to re-label; the live question is whether anything should replace it.
- **"Surfaced in the dashboard Tag filter" briefly stopped being true** — the CH16 cutover dropped
  the tag-filter UI while keeping the plumbing. A159 restored it (Dashboard → Filters → Tag), and
  A130/A153 made the tag form canonical (trimmed, lowercased, markup-stripped, deduped) across
  every write path, live and restored. The mechanics are now solid; this review is about meaning.

## What tagging is today (current state)

Two scopes, one canonical form:

| Scope | Written from | Stored in | Read back by |
| --- | --- | --- | --- |
| **Per-trade tags** | Trade Editor (+ tag popover, bulk tag), Blotter detail drawer (A149) | `trademeta` (keyed by trade id) | Blotter Tags column + search, Trade Editor, Dashboard **Tag filter** (A159), saved filter views |
| **Per-day journal tags** | Calendar day rail | `journal` (keyed by date) | The same day rail only — **write-mostly** |

## Decisions

1. **What tagging MEANS: the user's own review vocabulary, at two deliberate scopes.**
   *Trade tags* label the **analysis unit** — setups, mistakes, strategies, execution quality
   (`breakout`, `fomo`, `news`). They exist to be filtered and aggregated: "how does my P&L look
   on `fomo` trades?" *Day tags* label **context** — market regime, session character, life
   context (`cpi-day`, `choppy`, `tired`). They exist to be seen while reviewing a day. This split
   is already how the storage is shaped; we adopt it as the intended model rather than merging the
   scopes. **No enforced taxonomy** — free-form labels canonicalized by `cleanTag` are the right
   weight for a local-first journal; the app's job is to make the user's own vocabulary cheap to
   apply and useful to read back, not to impose one.

2. **The "Tagged trades" Overview stat does NOT return.** A bare count ("214 of 512 trades
   tagged") answers a question nobody asks and earns no screen space. What made tags worth
   counting was always the aggregation behind them — so the stat's replacement is a real
   **Analytics "By tag" breakdown** (P&L, win rate, trade count per tag, plus an *untagged*
   bucket), matching the existing By-symbol/By-weekday modules. Tag *coverage* appears there as a
   one-line nudge (the untagged bucket IS the coverage stat, in actionable form). Filed as
   **A165**.

3. **Day tags must stop being write-only.** Today a day tag can be entered and re-read only in
   the same rail — that's below the utility bar. Rather than delete them (they fit the
   context-labeling model above), surface them where days are scanned: chips in the Calendar
   day-detail rail already exist; add them to the month grid's day tooltip/cell affordance and the
   Dashboard day drill-in. Small, contained. Filed as **A166**.

4. **Applying tags should be autocomplete-cheap.** The canonical form (A153) makes prefix
   suggestion trivial and typo-safe; every tag input (Trade Editor, Blotter drawer, bulk tag,
   Calendar) should suggest from the existing vocabulary (`dash.tags` / journal tags) so the
   vocabulary converges instead of fragmenting. Filed as **A167** (P3 polish).

## Not doing (considered)

- **Merging day tags into trade tags** — different objects being labeled; merging loses the
  context/analysis distinction that gives each scope its purpose.
- **Predefined tag taxonomies / tag categories (setup: / mistake: prefixes)** — heavier than the
  product wants; nothing prevents a user adopting prefixes as personal convention, and the By-tag
  breakdown will reflect whatever vocabulary they use.
- **Resurrecting an Overview/summary stat anywhere outside Analytics** — rejected per decision 2.

## Done-when check (R17)

A written decision on the stat's meaning (it stays retired; its actionable successor is the
By-tag breakdown) and tagging's intended purpose (two-scope review vocabulary) exists — this
document — with concrete next steps filed as **A165 / A166 / A167**.
