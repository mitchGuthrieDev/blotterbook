<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive, type WithoutChild } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		inset,
		...restProps
	}: WithoutChild<DropdownMenuPrimitive.GroupHeadingProps> & {
		inset?: boolean;
	} = $props();
</script>

<DropdownMenuPrimitive.GroupHeading
	bind:ref
	data-slot="dropdown-menu-label"
	data-inset={inset}
	class={cn("px-2 py-1.5 text-sm font-medium data-[inset]:pl-8", className)}
	{...restProps}
/>
