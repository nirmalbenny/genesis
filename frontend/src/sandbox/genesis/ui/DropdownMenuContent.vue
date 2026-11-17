<script>
export default { inheritAttrs: false };
</script>

<script setup>
import { DropdownMenuContent, DropdownMenuPortal } from "reka-ui";

</script>

<template>
<DropdownMenuPortal>
  <DropdownMenuContent v-bind="$attrs" class="menu" :side-offset="4" align="end"><slot /></DropdownMenuContent>
</DropdownMenuPortal>
</template>
