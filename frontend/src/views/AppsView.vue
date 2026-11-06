<script setup lang="ts">
import { ArrowDownWideNarrow, ChevronDown, Plus, Search, SlidersHorizontal } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppCard from '@/components/AppCard.vue'
import AppDetailsDialog, { type AppDetails } from '@/components/AppDetailsDialog.vue'
import CopyAppDialog from '@/components/CopyAppDialog.vue'
import TopBar from '@/components/TopBar.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useApps, type App } from '@/composables/useApps'
import { useCreateApp } from '@/composables/useCreateApp'
import { useHl } from '@/composables/useHl'
import { api } from '@/lib/api'
import { CATEGORIES, type Category } from '@/lib/catalog'

const ORDERS = [
  { key: 'recent', label: 'Recently edited' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'category', label: 'Category' },
] as const
type Order = (typeof ORDERS)[number]['key']

const router = useRouter()
const { hl } = useHl()
const { apps, loaded, error: loadError } = useApps()
const creator = useCreateApp()
const error = ref('')

const search = ref('')
const scope = ref<'all' | 'ready' | 'mine'>('all')
const category = ref<Category | 'all'>('all')
const order = ref<Order>('recent')

const toDelete = ref<App | null>(null)
const copySource = ref<App | null>(null)
const detailsTarget = ref<App | null>(null)
const savingDetails = ref(false)
const detailsError = ref('')

const userApps = computed(() => apps.value.filter((a) => !a.prebuilt))
const scopeCounts = computed(() => ({ all: apps.value.length, ready: apps.value.length - userApps.value.length, mine: userApps.value.length }))
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = apps.value.filter(
    (a) =>
      (scope.value === 'all' || (scope.value === 'ready') === a.prebuilt) &&
      (category.value === 'all' || a.category === category.value) &&
      (!q || `${a.name} ${a.description}`.toLowerCase().includes(q)),
  )
  const rank = (c: string) => CATEGORIES.findIndex((x) => x.key === c)
  return [...list].sort((x, y) =>
    order.value === 'name' ? x.name.localeCompare(y.name)
      : order.value === 'category' ? rank(x.category) - rank(y.category) || x.name.localeCompare(y.name)
        : y.updatedAt - x.updatedAt,
  )
})
const filtersActive = computed(() => !!search.value.trim() || scope.value !== 'all' || category.value !== 'all')
function resetFilters() {
  search.value = ''
  scope.value = 'all'
  category.value = 'all'
}

async function saveDetails(details: AppDetails) {
  const a = detailsTarget.value
  if (!a) return
  savingDetails.value = true
  detailsError.value = ''
  try {
    await api('PATCH', `/projects/${a.id}`, details)
    detailsTarget.value = null
  } catch (e) {
    detailsError.value = (e as Error).message
  } finally {
    savingDetails.value = false
  }
}

async function confirmDelete() {
  const p = toDelete.value
  if (!p) return
  try {
    await api('DELETE', `/projects/${p.id}`)
  } catch (e) {
    error.value = (e as Error).message
  }
  toDelete.value = null
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <TopBar />
    <div class="flex">

      <main class="mx-auto grid w-full min-w-0 max-w-[1180px] content-start gap-5 px-6 pb-20 pt-8">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-2xl font-bold tracking-tight">Apps</h1>
            <p class="text-sm text-muted-foreground">Your custom-built tools, all in one place.</p>
          </div>
          <Button v-if="hl" @click="creator.blank()"><Plus class="size-4" />New app</Button>
        </div>

        <Alert v-if="error || loadError" variant="destructive" class="border-0 bg-danger-100"><AlertDescription class="text-foreground">{{ error || loadError }}</AlertDescription></Alert>

        <div class="grid gap-3 rounded-2xl border border-border bg-card p-3.5">
          <div class="flex flex-wrap items-center gap-3">
            <span class="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-200">
              <SlidersHorizontal class="size-3.5" />Filters
            </span>
            <span class="hidden text-[13px] text-muted-foreground md:inline">Search the catalog, then narrow by type or category.</span>
            <span class="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" class="h-8 gap-1.5 text-[13px] font-normal">
                  <ArrowDownWideNarrow class="size-3.5 text-muted-foreground" />Order by
                  <span class="font-semibold">{{ ORDERS.find((o) => o.key === order)?.label }}</span>
                  <ChevronDown class="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup v-model="order">
                  <DropdownMenuRadioItem v-for="o in ORDERS" :key="o.key" :value="o.key">{{ o.label }}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <span class="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground" aria-live="polite">{{ shown.length }} of {{ apps.length }} shown</span>
          </div>

          <div class="relative">
            <Search class="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input v-model="search" type="search" placeholder="Search apps…" aria-label="Search apps" class="h-11 rounded-xl pl-11 text-[15px]" />
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button
              v-for="s in ([['all', 'All apps'], ['ready', 'Ready-made'], ['mine', 'Your apps']] as const)"
              :key="s[0]"
              size="sm"
              :variant="scope === s[0] ? 'default' : 'outline'"
              class="h-9"
              :aria-pressed="scope === s[0]"
              @click="scope = s[0]"
            >
              {{ s[1] }}<span class="text-xs opacity-70">{{ scopeCounts[s[0]] }}</span>
            </Button>
            <span class="mx-1 hidden h-6 w-px bg-border sm:block" />
            <Button size="sm" class="h-9" :variant="category === 'all' ? 'default' : 'outline'" :aria-pressed="category === 'all'" @click="category = 'all'">All categories</Button>
            <Button
              v-for="c in CATEGORIES"
              :key="c.key"
              size="sm"
              class="h-9"
              :variant="category === c.key ? 'default' : 'outline'"
              :aria-pressed="category === c.key"
              @click="category = c.key"
            >
              <component :is="c.icon" class="size-3.5" />{{ c.label }}
            </Button>
          </div>
        </div>

        <p v-if="!userApps.length && scope === 'mine'" class="text-sm text-muted-foreground">
          You haven't built an app yet. <RouterLink to="/" class="font-medium text-primary hover:underline">Describe one</RouterLink>, or open a ready-made app and make a copy.
        </p>
        <div v-if="shown.length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AppCard
            v-for="a in shown"
            :key="a.id"
            :app="a"
            @edit="router.push(`/p/${a.id}`)"
            @copy="copySource = a"
            @remove="toDelete = a"
            @details="detailsError = ''; detailsTarget = a"
          />
        </div>
        <div v-else-if="filtersActive" class="grid justify-items-center gap-2 rounded-2xl border border-dashed border-border py-12 text-center">
          <p class="text-sm font-semibold">No apps match these filters</p>
          <Button variant="outline" size="sm" @click="resetFilters">Clear filters</Button>
        </div>
        <p v-if="!loaded" class="text-sm text-muted-foreground">Loading apps…</p>
      </main>
    </div>

    <CopyAppDialog :source="copySource" @close="copySource = null" />

    <AppDetailsDialog
      :initial="creator.initial.value"
      title="New app"
      :subtitle="`An empty app on ${hl?.locationName}. You'll describe what to build in the chat.`"
      submit-label="Create app"
      :busy="creator.busy.value"
      :error="creator.error.value"
      @submit="creator.create"
      @close="creator.initial.value = null"
    />

    <AppDetailsDialog
      :initial="detailsTarget ? { name: detailsTarget.name, description: detailsTarget.description, category: detailsTarget.category } : null"
      title="Edit details"
      subtitle="Change how this app appears in your catalog. Its code is not affected."
      submit-label="Save"
      :busy="savingDetails"
      :error="detailsError"
      @submit="saveDetails"
      @close="detailsTarget = null"
    />

    <Dialog :open="!!toDelete" @update:open="(o) => { if (!o) toDelete = null }">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{{ toDelete?.name }}”?</DialogTitle>
          <DialogDescription>{{ toDelete?.prebuilt ? "The ready-made app is removed from your list and won't be added back." : 'The app is removed from your list.' }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" @click="toDelete = null">Cancel</Button>
          <Button variant="destructive" @click="confirmDelete">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
