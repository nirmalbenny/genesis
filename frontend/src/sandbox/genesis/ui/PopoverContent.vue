<script>
export default { inheritAttrs: false };
</script>

<script setup>
import { PopoverContent, PopoverPortal } from "reka-ui";

</script>

<template>
<PopoverPortal>
  <PopoverContent v-bind="$attrs" class="popover" :side-offset="4"><slot /></PopoverContent>
</PopoverPortal>
</template>
