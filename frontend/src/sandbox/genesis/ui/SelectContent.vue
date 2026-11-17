<script>
export default { inheritAttrs: false };
</script>

<script setup>
import { SelectContent, SelectPortal, SelectViewport } from "reka-ui";

</script>

<template>
<SelectPortal>
  <SelectContent v-bind="$attrs" class="menu" position="popper" :side-offset="4" style="min-width: var(--reka-select-trigger-width)">
    <SelectViewport><slot /></SelectViewport>
  </SelectContent>
</SelectPortal>
</template>
