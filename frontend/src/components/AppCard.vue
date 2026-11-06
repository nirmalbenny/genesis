<script setup lang="ts">
import { CircleCheck, Code, Copy, Ellipsis, PenLine, Pencil, Pin, PinOff, Trash2 } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLaunchApp } from '@/composables/useLaunchApp'
import { categoryOf, iconOf } from '@/lib/catalog'

export type CatalogApp = {
  id: string
  name: string
  description: string
  category: string
  icon: string | null
  prebuilt: boolean
  updatedAt: number
  /** When the app was pinned to the sidebar; null when it is not pinned. */
  pinnedAt: number | null
}

/** Clicking the card launches the app; editing is only reachable from the ⋯ menu. */
/** `showKind`: hide the Ready-made / Your app badge where every card shares it (e.g. a ready-made-only list). */
const props = withDefaults(defineProps<{ app: CatalogApp; removable?: boolean; showKind?: boolean }>(), { removable: true, showKind: true })
defineEmits<{ edit: []; copy: []; remove: []; details: [] }>()

const category = computed(() => categoryOf(props.app.category))
const icon = computed(() => iconOf(props.app.icon, props.app.category))
const { launch: launchApp, setPinned } = useLaunchApp()
const launch = () => launchApp(props.app)
const togglePin = () => setPinned(props.app.id, props.app.pinnedAt === null)

const edited = computed(() => {
  const ms = props.app.updatedAt
  if (!ms) return 'Just created'
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return 'Edited just now'
  if (mins < 60) return `Edited ${mins} min ago`
  if (mins < 1440) return `Edited ${Math.round(mins / 60)} h ago`
  return `Edited ${new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
})
</script>

<template>
  <article
    class="group flex h-full cursor-pointer flex-col rounded-xl border border-border bg-card p-4 outline-none transition-[border-color,background-color,box-shadow] duration-150 hover:border-line-200/60 hover:bg-[#fcfdfe] hover:shadow-[0_4px_14px_rgba(33,51,67,0.06)] focus-visible:ring-3 focus-visible:ring-ring/50"
    tabindex="0"
    role="link"
    :aria-label="`Launch ${app.name}`"
    @click="launch"
    @keydown.enter.self="launch"
  >
    <div class="flex items-start gap-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-lg" :class="category.tile">
        <component :is="icon" class="size-5" />
      </span>
      <div class="min-w-0 pt-0.5">
        <h3 class="truncate text-[15px] font-semibold leading-5">{{ app.name }}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ category.label }}</p>
      </div>
    </div>
    <p class="mt-3 line-clamp-2 min-h-10 text-[13px] leading-5 text-ink-200">{{ app.description || 'No description yet.' }}</p>

    <div v-if="showKind" class="mt-3 flex flex-wrap gap-1.5">
      <span
        class="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
        :class="app.prebuilt ? 'border-ok-500/30 bg-ok-100 text-ok-500' : 'border-primary/25 bg-secondary text-primary'"
      >{{ app.prebuilt ? 'Ready-made' : 'Your app' }}</span>
    </div>

    <div class="min-h-4 flex-1" aria-hidden="true" />
    <div class="flex items-center gap-2 border-t border-border pt-3">
      <span class="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-muted-foreground">
        <template v-if="app.prebuilt"><CircleCheck class="size-3.5 shrink-0 text-ok-500" />Ready to use</template>
        <template v-else>{{ edited }}</template>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" aria-label="App actions" @click.stop>
            <Ellipsis class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-52">
          <template v-if="app.prebuilt">
            <DropdownMenuItem @click.stop="$emit('copy')"><Copy class="size-4" /> Edit a copy</DropdownMenuItem>
            <DropdownMenuItem @click.stop="$emit('edit')"><Code class="size-4" /> View code</DropdownMenuItem>
          </template>
          <template v-else>
            <DropdownMenuItem @click.stop="$emit('edit')"><Pencil class="size-4" /> Edit</DropdownMenuItem>
            <DropdownMenuItem @click.stop="$emit('details')"><PenLine class="size-4" /> Edit details</DropdownMenuItem>
            <DropdownMenuItem @click.stop="$emit('copy')"><Copy class="size-4" /> Duplicate</DropdownMenuItem>
          </template>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click.stop="togglePin">
            <template v-if="app.pinnedAt === null"><Pin class="size-4" /> Pin to sidebar</template>
            <template v-else><PinOff class="size-4" /> Unpin from sidebar</template>
          </DropdownMenuItem>
          <template v-if="removable">
            <DropdownMenuSeparator />
            <DropdownMenuItem class="text-destructive focus:text-destructive" @click.stop="$emit('remove')"><Trash2 class="size-4" /> Delete…</DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" class="h-8 px-4" @click.stop="launch">Open</Button>
    </div>
  </article>
</template>
