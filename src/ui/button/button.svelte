<script lang="ts" module>
  // Button primitive (A128; realises the deferred CH36 button primitive). tailwind-variants (tv)
  // captures the repeated control idioms from the scoped CSS as named variants mapped to the design
  // tokens (via the @theme utilities — bg-accent/text-bg/border-line/…): `default` is the secondary
  // control (border + panel2 fill), `primary` the accent CTA, `destructive` the red action, plus
  // ghost/outline/link. `buttonVariants(...)` is exported so anchors / other elements can borrow the
  // same look without a wrapper. CSP-safe: utilities are a linked stylesheet, never inline style="".
  import { tv, type VariantProps } from 'tailwind-variants';

  export const buttonVariants = tv({
    base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border font-sans leading-none cursor-pointer select-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed',
    variants: {
      variant: {
        default: 'border-line bg-panel2 text-txt hover:border-hover-line',
        primary: 'border-accent bg-accent text-bg font-semibold hover:opacity-90',
        destructive: 'border-red bg-red text-bg font-semibold hover:opacity-90',
        outline: 'border-line bg-transparent text-txt hover:bg-panel2 hover:border-hover-line',
        ghost: 'border-transparent bg-transparent text-txt hover:bg-panel2',
        link: 'border-transparent bg-transparent text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'px-2.5 py-1 text-xs rounded',
        default: 'px-3.5 py-[7px] text-[13px]',
        lg: 'px-[22px] py-[11px] text-[15px] font-bold rounded-lg',
        icon: 'p-1.5 text-[13px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
  export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
</script>

<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { cn } from '$ui/utils';

  interface Props extends HTMLButtonAttributes {
    variant?: ButtonVariant;
    size?: ButtonSize;
    children?: Snippet;
  }

  let { variant = 'default', size = 'default', class: className, children, ...rest }: Props = $props();
</script>

<button class={cn(buttonVariants({ variant, size }), className)} {...rest}>
  {@render children?.()}
</button>
