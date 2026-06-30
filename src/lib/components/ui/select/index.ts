import { Select as SelectPrimitive } from 'bits-ui';

import Trigger from './select-trigger.svelte';
import Content from './select-content.svelte';
import Item from './select-item.svelte';
import Group from './select-group.svelte';
import Label from './select-label.svelte';
import ScrollUpButton from './select-scroll-up-button.svelte';
import ScrollDownButton from './select-scroll-down-button.svelte';

const Root = SelectPrimitive.Root;
const Value = SelectPrimitive.Value;

export {
  Root,
  Value,
  Trigger,
  Content,
  Item,
  Group,
  Label,
  ScrollUpButton,
  ScrollDownButton,
  //
  Root as Select,
  Value as SelectValue,
  Trigger as SelectTrigger,
  Content as SelectContent,
  Item as SelectItem,
  Group as SelectGroup,
  Label as SelectLabel,
  ScrollUpButton as SelectScrollUpButton,
  ScrollDownButton as SelectScrollDownButton,
};
