<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ path: string }>()
const tags: Record<string, string> = { vue: 'VU', js: 'JS', ts: 'TS', css: 'CS', json: '{}' }
const tag = computed(() => tags[props.path.split('.').pop() ?? ''] ?? '··')
</script>

<template>
  <span class="rounded-[3px] bg-bg-300 px-[3px] py-px font-mono text-[9px] font-semibold leading-3 text-ink-200">{{ tag }}</span>
</template>
