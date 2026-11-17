<script>
export default { inheritAttrs: false };
</script>

<script setup>
import { TooltipProvider, TooltipRoot } from "reka-ui";

</script>

<template>
<TooltipProvider :delay-duration="300">
  <TooltipRoot v-bind="$attrs"><slot /></TooltipRoot>
</TooltipProvider>
</template>
