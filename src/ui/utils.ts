// Shared design-system helper (A128). `cn()` merges conditional class lists (clsx) and de-conflicts
// overlapping Tailwind utilities (tailwind-merge) so a caller's `class` prop can override a
// component's defaults predictably. Used by the shadcn-svelte primitives in this directory and by
// any component composing Tailwind utilities. Client-only, no telemetry/egress (A28).
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
