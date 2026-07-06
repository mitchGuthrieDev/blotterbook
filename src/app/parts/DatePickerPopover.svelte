<script lang="ts">
  // F49: the Trade Editor's DATE cell editor — a minimal month-grid date picker inside the shared
  // Popover primitive, reusing the same weekday/grid-math idioms as the Calendar screen (monthCells +
  // DOW_LABEL from the pure-logic core, so the scaffolding can't drift between the two screens).
  // Editable cells only exist on manual/new rows (imported trades are immutable) — this component
  // doesn't know that; the caller (TradeEditor) only renders it when the field is editable.
  //
  // Keyboard path: the trigger is a real <button> (Space/Enter opens it, same as any Popover trigger).
  // Inside, every day is a real <button> — Tab reaches the grid, arrow keys move focus day-to-day
  // (onGridKey below), Enter/Space picks the focused day (native button activation), and Escape closes
  // the popover (bits-ui's built-in dismiss behavior — no extra wiring needed here).
  //
  // A246: the trigger + open/reset-on-open/close-on-select shell is the shared EditableCellPopover —
  // this component owns only the month-grid content.
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import EditableCellPopover from './EditableCellPopover.svelte';
  import { fmtDate, pad2, monthCells, DOW_LABEL, MONTH_NAMES } from '../../lib/core/core.ts';

  interface Props {
    /** 'YYYY-MM-DD', or '' for an unset manual row. */
    value: string;
    onchange: (v: string) => void;
    /** Trigger button classes — matches the plain-text cell button so the swap is visually inert. */
    class?: string;
  }
  let { value, onchange, class: className = '' }: Props = $props();

  const today = new Date();
  const todayKey = fmtDate(today);

  const parsed = $derived.by(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  });

  let viewYear = $state(today.getFullYear());
  let viewMonth = $state(today.getMonth()); // 0-based

  // Reseed the visible month to the cell's current date (or today, for an unset row) each time the
  // popover opens, so re-opening always starts on the relevant month rather than wherever it was left.
  function onOpen() {
    const base = parsed ?? today;
    viewYear = base.getFullYear();
    viewMonth = base.getMonth();
  }

  const daysInMonth = $derived(new Date(viewYear, viewMonth + 1, 0).getDate());
  const firstDow = $derived(new Date(viewYear, viewMonth, 1).getDay());
  // Sunday-first month scaffold — the SAME helper the Calendar screen's grid uses (core.ts).
  const cells = $derived(monthCells(firstDow, daysInMonth));
  const keyOf = (day: number) => `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`;

  function prevMonth() {
    if (viewMonth === 0) {
      viewMonth = 11;
      viewYear -= 1;
    } else viewMonth -= 1;
  }
  function nextMonth() {
    if (viewMonth === 11) {
      viewMonth = 0;
      viewYear += 1;
    } else viewMonth += 1;
  }
  function pick(day: number, close: () => void) {
    onchange(keyOf(day));
    close();
  }
  // Arrow-key grid navigation: move focus by 1 day (left/right) or 7 (up/down) within the same month
  // grid. Crossing a month boundary isn't handled here — Tab still reaches the prev/next buttons.
  // Enter is handled explicitly (not left to native <button> activation) so the pick is deterministic
  // across browsers rather than relying on Enter-triggers-click behavior for a bare type="button".
  function onGridKey(e: KeyboardEvent, index: number, day: number, close: () => void) {
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(day, close);
      return;
    }
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const d = deltas[e.key];
    if (d == null) return;
    e.preventDefault();
    const grid = (e.currentTarget as HTMLElement).closest('[data-testid="datepicker-grid"]');
    grid?.querySelector<HTMLButtonElement>(`[data-day-index="${index + d}"]`)?.focus();
  }
</script>

<EditableCellPopover label={value || '—'} class={className} contentClass="w-64" onopen={onOpen}>
  {#snippet content({ close })}
    <div class="flex items-center justify-between pb-2">
      <button
        type="button"
        class="relative grid size-6 place-items-center rounded hover:bg-accent pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
        aria-label="Previous month"
        onclick={prevMonth}
      >
        <ChevronLeft class="size-3.5" />
      </button>
      <span class="text-xs font-semibold">{MONTH_NAMES[viewMonth]} {viewYear}</span>
      <button
        type="button"
        class="relative grid size-6 place-items-center rounded hover:bg-accent pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
        aria-label="Next month"
        onclick={nextMonth}
      >
        <ChevronRight class="size-3.5" />
      </button>
    </div>
    <div class="grid grid-cols-7 gap-0.5" data-testid="datepicker-grid" role="grid">
      {#each DOW_LABEL as d (d)}<span class="pb-1 text-center text-[10px] text-muted-foreground">{d}</span>{/each}
      {#each cells as day, i (i)}
        {#if day}
          {@const key = keyOf(day)}
          <button
            type="button"
            data-day-index={i}
            data-testid="datepicker-day"
            aria-label={key}
            aria-current={key === todayKey ? 'date' : undefined}
            aria-pressed={key === value}
            onclick={() => pick(day, close)}
            onkeydown={e => onGridKey(e, i, day, close)}
            class={cn(
              'grid aspect-square place-items-center rounded text-xs hover:bg-accent',
              key === value && 'bg-primary text-primary-foreground hover:bg-primary/90',
              key === todayKey && key !== value && 'ring-1 ring-ring font-semibold'
            )}
          >
            {day}
          </button>
        {:else}
          <span></span>
        {/if}
      {/each}
    </div>
  {/snippet}
</EditableCellPopover>
