// Shared table pagination for the paged trade tables (Blotter + Trade Editor) — ONE definition of
// the page-size set, the clamp-on-shrink effect, and the page slice (A157; the two screens carried
// byte-identical copies). A .svelte.ts module so the factory can own runes; call it during
// component init (it registers a $effect).

export const PAGE_SIZES = [25, 50, 100, Infinity];

export interface Pager {
  pageSize: number;
  page: number;
  readonly totalPages: number;
  /** 1-based index of the first row on the page (0 when the list is empty). */
  readonly start: number;
  /** 1-based index of the last row on the page. */
  readonly end: number;
  prev(): void;
  next(): void;
}

export function createPagination<T>(getItems: () => T[]): Pager & { readonly paged: T[] } {
  let pageSize = $state<number>(50);
  let page = $state(0);
  const totalPages = $derived(Math.max(1, Math.ceil(getItems().length / pageSize)));
  $effect(() => {
    if (page > totalPages - 1) page = totalPages - 1; // clamp when the list shrinks / page size grows
  });
  const paged = $derived(pageSize === Infinity ? getItems() : getItems().slice(page * pageSize, page * pageSize + pageSize));
  const start = $derived(getItems().length ? page * pageSize + 1 : 0);
  const end = $derived(pageSize === Infinity ? getItems().length : Math.min(getItems().length, (page + 1) * pageSize));
  return {
    get pageSize() {
      return pageSize;
    },
    set pageSize(v: number) {
      pageSize = v;
    },
    get page() {
      return page;
    },
    set page(v: number) {
      page = v;
    },
    get totalPages() {
      return totalPages;
    },
    get paged() {
      return paged;
    },
    get start() {
      return start;
    },
    get end() {
      return end;
    },
    prev() {
      page = Math.max(0, page - 1);
    },
    next() {
      page = Math.min(totalPages - 1, page + 1);
    },
  };
}
