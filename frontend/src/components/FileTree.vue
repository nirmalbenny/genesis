<script setup lang="ts">
import { computed } from 'vue'
import FileTag from '@/components/FileTag.vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{ paths: string[]; active: string | null; building: string | null }>()
defineEmits<{ select: [path: string] }>()

// Flat rendering: folder rows are derived from path prefixes and indented by depth.
const rows = computed(() => {
  const out: { key: string; label: string; depth: number; path: string | null }[] = []
  const seen = new Set<string>()
  for (const path of [...props.paths].sort()) {
    const parts = path.split('/')
    parts.slice(0, -1).forEach((_, i) => {
      const dir = parts.slice(0, i + 1).join('/')
      if (!seen.has(dir)) {
        seen.add(dir)
        out.push({ key: `d:${dir}`, label: parts[i]!, depth: i, path: null })
      }
    })
    out.push({ key: path, label: parts[parts.length - 1]!, depth: parts.length - 1, path })
  }
  return out
})
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-col">
    <div class="flex h-10 shrink-0 items-center border-b border-border px-3 text-sm font-semibold">Files</div>
    <ul class="min-h-0 flex-1 overflow-y-auto p-2 text-[13px]">
      <li v-for="r in rows" :key="r.key">
        <Button
          v-if="r.path"
          variant="ghost"
          size="sm"
          class="h-7 w-full justify-start gap-1.5 px-2 font-normal"
          :class="r.path === active && 'bg-muted text-foreground'"
          :style="{ paddingLeft: `${8 + r.depth * 12}px` }"
          @click="$emit('select', r.path)"
        >
          <FileTag :path="r.path" />
          <span class="truncate">{{ r.label }}</span>
          <span v-if="r.path === building" class="ml-auto size-1.5 rounded-full bg-signal-500" />
        </Button>
        <div v-else class="flex h-7 items-center px-2 text-muted-foreground" :style="{ paddingLeft: `${8 + r.depth * 12}px` }">{{ r.label }}/</div>
      </li>
    </ul>
  </div>
</template>
