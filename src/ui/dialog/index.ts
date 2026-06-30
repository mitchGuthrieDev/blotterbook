// Dialog barrel (A128). shadcn-svelte composition over bits-ui: the primitive Root/Close/Title/
// Trigger/Description plus the styled Overlay/Content wrappers. Import as a namespace:
//   import * as Dialog from '$ui/dialog';  →  <Dialog.Root> <Dialog.Content> …
import { Dialog as DialogPrimitive } from 'bits-ui';
import Overlay from './dialog-overlay.svelte';
import Content from './dialog-content.svelte';

const Root = DialogPrimitive.Root;
const Close = DialogPrimitive.Close;
const Title = DialogPrimitive.Title;
const Trigger = DialogPrimitive.Trigger;
const Description = DialogPrimitive.Description;

export {
  Root,
  Close,
  Title,
  Trigger,
  Description,
  Overlay,
  Content,
  //
  Root as Dialog,
  Close as DialogClose,
  Title as DialogTitle,
  Trigger as DialogTrigger,
  Description as DialogDescription,
  Overlay as DialogOverlay,
  Content as DialogContent,
};
