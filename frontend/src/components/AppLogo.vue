<script setup lang="ts">
import GenesisMark from '@/components/GenesisMark.vue'

defineProps<{ inverted?: boolean }>()
</script>

<template>
  <RouterLink to="/" class="flex items-center gap-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-md">
    <GenesisMark class="size-8 shrink-0 rounded-lg" :class="inverted ? 'ring-1 ring-white/20' : ''" />
    <span class="text-base font-semibold tracking-tight" :class="inverted ? 'text-white' : 'text-foreground'">Genesis</span>
  </RouterLink>
</template>
