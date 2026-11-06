<script setup lang="ts">
import { ref, watch } from 'vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api } from '@/lib/api'

type Snapshot = { id: string; reason: 'generation' | 'restore' | 'template' | 'copy'; summary: string | null; fileCount: number; createdAt: number | null }

const props = defineProps<{ projectId: string; open: boolean; busy: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean]; restored: [] }>()

const snapshots = ref<Snapshot[]>([])
const error = ref('')
const restoring = ref<string | null>(null)

async function load() {
  error.value = ''
  try {
    snapshots.value = (await api<{ snapshots: Snapshot[] }>('GET', `/projects/${props.projectId}/snapshots`)).snapshots
  } catch (e) {
    error.value = (e as Error).message
  }
}

// Restore is non-destructive (it records a new snapshot), so there is no confirm step.
async function restore(s: Snapshot) {
  restoring.value = s.id
  error.value = ''
  try {
    await api('POST', `/projects/${props.projectId}/snapshots/${s.id}/restore`)
    emit('restored')
    emit('update:open', false)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    restoring.value = null
  }
}

const title = (s: Snapshot) => s.summary ?? (s.reason === 'restore' ? 'Restored an earlier snapshot' : 'Build')
const when = (t: number | null) =>
  t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

watch(() => props.open, (o) => { if (o) load() })
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent class="w-full overflow-y-auto sm:max-w-[400px]">
      <SheetHeader>
        <SheetTitle>History</SheetTitle>
        <SheetDescription>Each build is a snapshot. Restoring creates a new snapshot, so you can always undo.</SheetDescription>
      </SheetHeader>
      <div class="px-4 pb-4">
        <Alert v-if="error" variant="destructive" class="mb-3 border-0 bg-danger-100"><AlertDescription class="text-foreground">{{ error }}</AlertDescription></Alert>
        <p v-if="!snapshots.length && !error" class="text-sm text-muted-foreground">No snapshots yet. Your first build creates one.</p>

        <ol v-if="snapshots.length" class="relative grid gap-3 pl-5">
          <span class="absolute bottom-2 left-[5px] top-2 w-px bg-border" />
          <li v-for="(s, i) in snapshots" :key="s.id" class="group relative rounded-md border border-transparent p-2.5 -ml-1.5 pl-3.5 focus-within:border-border hover:border-border">
            <span
              class="absolute -left-[13px] top-[18px] rounded-full border-[1.5px]"
              :class="i === 0 ? 'size-[11px] -left-[14px] border-signal-500 bg-signal-500 shadow-[0_0_0_3px_var(--card)]' : 'size-[9px] border-input bg-card'"
            />
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-[13px] font-medium leading-[18px]">{{ title(s) }}</span>
              <Badge v-if="i === 0" variant="secondary" class="h-5 px-1.5 text-[11px]">Current</Badge>
            </div>
            <p class="text-xs leading-4 text-muted-foreground">{{ when(s.createdAt) }} · <span class="font-mono">#{{ snapshots.length - i }}</span> · {{ s.fileCount }} files</p>
            <div v-if="i > 0" class="mt-2 hidden gap-1.5 group-focus-within:flex group-hover:flex">
              <Button size="sm" variant="secondary" :disabled="busy || restoring !== null" @click="restore(s)">
                {{ restoring === s.id ? 'Restoring…' : 'Restore' }}
              </Button>
            </div>
          </li>
        </ol>
      </div>
    </SheetContent>
  </Sheet>
</template>
