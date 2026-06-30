<script lang="ts">
	import { Select as SelectPrimitive, type WithoutChildren } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		value,
		label,
		children: childrenProp,
		...restProps
	}: WithoutChildren<SelectPrimitive.ItemProps> & {
		children?: SelectPrimitive.ItemProps["children"];
	} = $props();
</script>

<SelectPrimitive.Item
	bind:ref
	{value}
	data-slot="select-item"
	class={cn(
		"focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className
	)}
	{...restProps}
>
	{#snippet children({ selected, highlighted })}
		<span class="absolute right-2 flex size-3.5 items-center justify-center">
			{#if selected}
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="size-4"
				>
					<path d="M20 6 9 17l-5-5" />
				</svg>
			{/if}
		</span>
		{#if childrenProp}{@render childrenProp({ selected, highlighted })}{:else}{label ?? value}{/if}
	{/snippet}
</SelectPrimitive.Item>
