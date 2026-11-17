<script>
export default { inheritAttrs: false };
</script>

<script setup>
import { DialogClose, DialogContent, DialogOverlay, DialogPortal } from "reka-ui";

defineProps({ side: { type: String, default: "right" } }); // right | left
</script>

<template>
<DialogPortal>
  <DialogOverlay class="overlay" />
  <DialogContent v-bind="$attrs" :class="['dialog', 'sheet', side === 'left' && 'left']">
    <slot />
    <DialogClose class="btn ghost icon sm dialog-close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></DialogClose>
  </DialogContent>
</DialogPortal>
</template>
