// Select barrel (A128). shadcn-svelte composition over bits-ui. Import as a namespace:
//   import * as Select from '$ui/select';
//   <Select.Root type="single" bind:value>
//     <Select.Trigger><Select.Value placeholder="…" /></Select.Trigger>
//     <Select.Content><Select.Item value="x" label="X" /></Select.Content>
//   </Select.Root>
import { Select as SelectPrimitive } from 'bits-ui';
import Trigger from './select-trigger.svelte';
import Content from './select-content.svelte';
import Item from './select-item.svelte';

const Root = SelectPrimitive.Root;
const Value = SelectPrimitive.Value;
const Group = SelectPrimitive.Group;

export { Root, Value, Group, Trigger, Content, Item };
