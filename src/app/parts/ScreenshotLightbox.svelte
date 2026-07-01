<script lang="ts">
  // Shared screenshot lightbox (A152) — ONE Dialog for the Calendar day-detail and Trade Editor
  // thumbnails. The parent owns the `shot` state (the clicked thumbnail's data URI) and clears it
  // via `onclose` when the dialog dismisses.
  import * as Dialog from '$lib/components/ui/dialog';

  let { shot, onclose }: { shot: string | null; onclose: () => void } = $props();
</script>

<Dialog.Root
  open={shot !== null}
  onOpenChange={o => {
    if (!o) onclose();
  }}
>
  <Dialog.Content class="max-w-3xl p-2">
    {#if shot}
      <img src={shot} alt="Enlarged screenshot" class="mx-auto max-h-[80vh] w-auto rounded-md" />
    {/if}
  </Dialog.Content>
</Dialog.Root>
