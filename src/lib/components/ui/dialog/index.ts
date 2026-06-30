import { Dialog as DialogPrimitive } from 'bits-ui';

const Root = DialogPrimitive.Root;
const Trigger = DialogPrimitive.Trigger;
const Portal = DialogPrimitive.Portal;

import Overlay from './dialog-overlay.svelte';
import Content from './dialog-content.svelte';
import Title from './dialog-title.svelte';
import Description from './dialog-description.svelte';
import Header from './dialog-header.svelte';
import Footer from './dialog-footer.svelte';
import Close from './dialog-close.svelte';

export {
  Root,
  Trigger,
  Portal,
  Close,
  Overlay,
  Content,
  Title,
  Description,
  Header,
  Footer,
  //
  Root as Dialog,
  Trigger as DialogTrigger,
  Portal as DialogPortal,
  Close as DialogClose,
  Overlay as DialogOverlay,
  Content as DialogContent,
  Title as DialogTitle,
  Description as DialogDescription,
  Header as DialogHeader,
  Footer as DialogFooter,
};
