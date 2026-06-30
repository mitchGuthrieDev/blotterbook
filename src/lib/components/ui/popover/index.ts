import { Popover as PopoverPrimitive } from 'bits-ui';

const Root = PopoverPrimitive.Root;
const Trigger = PopoverPrimitive.Trigger;
const Close = PopoverPrimitive.Close;

import Content from './popover-content.svelte';

export {
  Root,
  Trigger,
  Close,
  Content,
  //
  Root as Popover,
  Trigger as PopoverTrigger,
  Content as PopoverContent,
  Close as PopoverClose,
};
