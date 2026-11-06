<script setup lang="ts">
import { Copy, Ellipsis, House, LayoutGrid, Pencil, Pin, PinOff } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import CopyAppDialog from '@/components/CopyAppDialog.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useApps, type App } from '@/composables/useApps'
import { useLaunchApp } from '@/composables/useLaunchApp'
import { categoryOf, iconOf } from '@/lib/catalog'

/** Navigation drawer, opened from the hamburger button in the top bar. */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const router = useRouter()
const { apps } = useApps()
const { launch, setPinned } = useLaunchApp()
const copySource = ref<App | null>(null)

const links = [
  { to: '/', label: 'Home', icon: House },
  { to: '/apps', label: 'Apps', icon: LayoutGrid },
]
const pinned = computed(() =>
  apps.value.filter((a) => a.pinnedAt !== null).sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0)),
)

const close = () => emit('update:open', false)
function launchPinned(app: App) {
  launch(app)
  close()
}
// Ready-made apps are locked, so "Edit" means editing a copy; your own apps open in the editor.
function edit(app: App) {
  if (app.prebuilt) {
    copySource.value = app
  } else {
    close()
    router.push(`/p/${app.id}`)
  }
}

const item = 'flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-ink-200 outline-none transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50'
const active = 'bg-sidebar-accent text-primary hover:bg-sidebar-accent'
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent side="left" class="w-72 gap-0 p-0 sm:max-w-72">
      <SheetHeader class="border-b border-border px-5 py-4">
        <SheetTitle as-child><AppLogo /></SheetTitle>
        <SheetDescription class="sr-only">Main navigation and pinned apps</SheetDescription>
      </SheetHeader>

      <nav class="grid gap-1 p-3" aria-label="Main">
        <RouterLink v-for="l in links" :key="l.to" :to="l.to" :class="item" :exact-active-class="active" @click="close">
          <component :is="l.icon" class="size-4" />{{ l.label }}
        </RouterLink>
      </nav>

      <section class="flex min-h-0 flex-1 flex-col" aria-labelledby="pinned-heading">
        <div class="flex items-center gap-2 px-6 pb-1.5 pt-2">
          <Pin class="size-3.5 text-muted-foreground" />
          <h2 id="pinned-heading" class="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Pinned apps</h2>
          <span class="h-px flex-1 bg-border" />
        </div>

        <p v-if="!pinned.length" class="mx-3 mt-1 rounded-lg border border-dashed border-border px-3 py-3 text-[13px] leading-5 text-muted-foreground">
          Pin apps from their <Ellipsis class="inline size-3.5 align-[-2px]" /> menu to launch them from here.
        </p>
        <ul v-else class="grid min-h-0 gap-0.5 overflow-y-auto px-3 pb-4">
          <li v-for="a in pinned" :key="a.id" class="group flex items-center rounded-md transition-colors hover:bg-secondary">
            <Button
              variant="ghost"
              class="h-auto min-w-0 flex-1 shrink cursor-pointer justify-start gap-3 px-3 py-2 text-left hover:bg-transparent"
              :aria-label="`Launch ${a.name}`"
              @click="launchPinned(a)"
            >
              <span class="grid size-7 shrink-0 place-items-center rounded-md" :class="categoryOf(a.category).tile">
                <component :is="iconOf(a.icon, a.category)" class="size-4" />
              </span>
              <span class="truncate text-sm font-medium text-foreground">{{ a.name }}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="mr-1 shrink-0 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                  :aria-label="`${a.name} actions`"
                >
                  <Ellipsis class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-48">
                <DropdownMenuItem @click="edit(a)">
                  <template v-if="a.prebuilt"><Copy class="size-4" /> Edit a copy</template>
                  <template v-else><Pencil class="size-4" /> Edit</template>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem @click="setPinned(a.id, false)"><PinOff class="size-4" /> Unpin</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        </ul>
      </section>
    </SheetContent>
  </Sheet>

  <CopyAppDialog :source="copySource" @close="copySource = null; close()" />
</template>
