// A179 — header flavor text: a curated list of short, friendly, trading-desk-flavored phrases.
// Data-only module so copy edits never touch components. One phrase is picked pseudo-randomly per
// page load (pickFlavor) and shown in the topbar; it must stay short enough not to shift layout.
export const FLAVOR_PHRASES = [
  'markets open somewhere',
  'the journal never lies',
  'risk first, size second',
  'process over outcome',
  'plan the trade, trade the plan',
  'discipline > dopamine',
  'small losses, long career',
  'review beats regret',
  'edge is earned daily',
  'flat is a position too',
  'respect the stop',
  'one good trade at a time',
  'consistency compounds',
  'the tape pays attention',
  'journal it or it never happened',
  'losses are tuition',
  'patience is a strategy',
  'trade less, see more',
  'your equity curve is watching',
  'green Mondays start on Sunday',
  'expectancy, not adrenaline',
  'size like you mean to survive',
  'let the winners do the talking',
  'every fill has a story',
] as const;

/** One phrase per page load — pseudo-random, no persistence, no layout dependence. */
export function pickFlavor(list: readonly string[] = FLAVOR_PHRASES): string {
  return list[Math.floor(Math.random() * list.length)] ?? '';
}
