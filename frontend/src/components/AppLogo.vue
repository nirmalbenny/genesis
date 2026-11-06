<script setup lang="ts">
defineProps<{ inverted?: boolean }>()
</script>

<template>
  <RouterLink to="/" class="flex items-center gap-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-md">
    <span class="grid size-6 place-items-center rounded-md" :class="inverted ? 'bg-white/10 ring-1 ring-white/20' : 'bg-ink-100'">
      <i class="size-2 rotate-45 rounded-[2px] bg-[#4ade80]" />
    </span>
    <span class="text-[15px] font-semibold tracking-tight" :class="inverted ? 'text-white' : 'text-foreground'">Genesis</span>
  </RouterLink>
</template>
