// shadcn-svelte cn() helper (canonical $lib/utils). Merges conditional class lists (clsx) and
// de-conflicts overlapping Tailwind utilities (tailwind-merge).
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
