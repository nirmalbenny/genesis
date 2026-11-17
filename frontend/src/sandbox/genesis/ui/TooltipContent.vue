<script>
export default { inheritAttrs: false };
</script>

<script setup>
import { TooltipContent, TooltipPortal } from "reka-ui";

</script>

<template>
<TooltipPortal>
  <TooltipContent v-bind="$attrs" class="tooltip" :side-offset="4"><slot /></TooltipContent>
</TooltipPortal>
</template>
