<script setup lang="ts">
import { CircleAlert, Copy, History, Sparkles } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'
import FileTag from '@/components/FileTag.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type { Message } from '@/composables/useProject'

export type Notice = { prompt: string; message: string; afterCount: number }

const props = defineProps<{
  initialDraft?: string
  /** True while HighLevel is not connected: drafting stays possible, building does not. */
  blocked?: boolean
  /** Ready-made app: no chat input, only a way to make an editable copy. */
  locked?: boolean
  messages: Message[]
  notices: Notice[]
  pendingPrompt: string | null
  streaming: boolean
  plan: string
  error: string
  building: { path: string; done: boolean }[]
  /** AI credits the last build used, and the balance after it. */
  lastCredits?: { charged: number; balance: number | null } | null
}>()
const emit = defineEmits<{ send: [prompt: string]; 'open-file': [path: string]; history: []; copy: [] }>()

const draft = ref(props.initialDraft ?? '')
const bottom = ref<HTMLElement | null>(null)

function submit() {
  const prompt = draft.value.trim()
  if (!prompt || props.streaming || props.blocked) return
  emit('send', prompt)
  draft.value = ''
}

type Item = { key: string; role: 'user' | 'assistant' | 'notice'; content: string; files: string[] }

/** Assistant messages are stored as "<plan>\n\nFiles: a, b"; split them back into prose and file chips. */
function toItem(key: string, role: Item['role'], content: string): Item {
  const m = role === 'assistant' ? content.match(/^([\s\S]*?)\n\nFiles: (.+)$/) : null
  return m ? { key, role, content: m[1]!.trim(), files: m[2]!.split(', ') } : { key, role, content, files: [] }
}

// Declined requests are shown in place but are never part of the stored history.
const items = computed<Item[]>(() => {
  const out: Item[] = []
  const addNotices = (count: number) =>
    props.notices.forEach((n, i) => {
      if (n.afterCount !== count) return
      out.push(toItem(`np${i}`, 'user', n.prompt), toItem(`nn${i}`, 'notice', n.message))
    })
  addNotices(0)
  props.messages.forEach((m, i) => {
    out.push(toItem(m.id, m.role, m.content))
    addNotices(i + 1)
  })
  if (props.pendingPrompt) out.push(toItem('pending', 'user', props.pendingPrompt))
  return out
})
const current = computed(() => props.building.find((b) => !b.done)?.path ?? null)

watch(() => [items.value.length, props.plan, props.building.length], async () => {
  await nextTick()
  bottom.value?.scrollIntoView({ block: 'end' })
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <Button variant="secondary" size="sm" class="h-7 gap-1.5 text-primary"><Sparkles class="size-3.5" />Build</Button>
      <Button variant="ghost" size="sm" class="h-7 gap-1.5 text-ink-200" @click="emit('history')"><History class="size-3.5" />History</Button>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <div class="flex flex-col gap-4 p-4">
        <div v-if="locked" class="grid gap-2 rounded-lg border border-border bg-muted p-4 text-sm leading-[22px]">
          <p class="font-semibold">This is a ready-made app</p>
          <p class="text-ink-200">It stays exactly as shipped so it always works. Make a copy to change it with chat or by editing the code. The original won't change.</p>
        </div>
        <p v-else-if="!items.length && !streaming" class="text-sm text-muted-foreground">
          Describe the app you want. Genesis builds it file by file and runs it on your HighLevel data.
        </p>

        <template v-for="m in items" :key="m.key">
          <div v-if="m.role === 'user'" class="max-w-[88%] self-end whitespace-pre-wrap rounded-xl bg-muted px-3 py-2.5 text-sm leading-[22px]">{{ m.content }}</div>

          <div v-else-if="m.role === 'notice'" class="flex gap-2 rounded-md bg-danger-100 px-3 py-2 text-[13px] leading-5">
            <CircleAlert class="mt-0.5 size-4 shrink-0 text-danger-500" />
            <div><p class="font-medium">Can't build this</p><p class="text-ink-200">{{ m.content }}</p></div>
          </div>

          <div v-else class="grid gap-2">
            <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span class="grid size-4 place-items-center rounded-[4px] bg-ink-100"><i class="size-1.5 rotate-45 rounded-[1px] bg-[#4ade80]" /></span>Genesis
            </div>
            <p class="whitespace-pre-wrap text-sm leading-[22px]">{{ m.content }}</p>
            <div v-if="m.files.length" class="flex flex-wrap gap-1.5">
              <Button v-for="f in m.files" :key="f" variant="secondary" size="xs" class="gap-1.5 font-mono text-[11px]" @click="emit('open-file', f)">
                <FileTag :path="f" />{{ f.split('/').pop() }}
              </Button>
            </div>
          </div>
        </template>

        <div v-if="streaming" class="grid gap-2">
          <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span class="grid size-4 place-items-center rounded-[4px] bg-ink-100"><i class="size-1.5 rotate-45 rounded-[1px] bg-[#4ade80]" /></span>Genesis
          </div>
          <p class="text-sm leading-[22px]">
            <span class="whitespace-pre-wrap">{{ plan || 'Reading your app and planning the change' }}</span>
            <span class="ml-px inline-block h-[15px] w-[7px] align-[-2px] bg-signal-500" />
          </p>
          <div v-if="building.length" class="flex flex-wrap gap-1.5">
            <Badge
              v-for="b in building"
              :key="b.path"
              variant="secondary"
              class="gap-1.5 font-mono text-[11px]"
              :class="!b.done && 'border-signal-500'"
            >
              <FileTag :path="b.path" />{{ b.path.split('/').pop() }}
              <span class="text-muted-foreground">{{ b.done ? 'done' : 'building' }}</span>
            </Badge>
          </div>
        </div>

        <div v-if="error" class="flex gap-2 rounded-md bg-warn-100 px-3 py-2 text-[13px] leading-5">
          <CircleAlert class="mt-0.5 size-4 shrink-0 text-warn-500" /><p>{{ error }}</p>
        </div>
        <p v-if="!streaming && lastCredits" class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles class="size-3.5 text-primary" aria-hidden="true" />
          Used {{ lastCredits.charged.toLocaleString() }} AI credits<template v-if="lastCredits.balance !== null"> · {{ lastCredits.balance.toLocaleString() }} left</template>
        </p>
        <div ref="bottom" />
      </div>
    </ScrollArea>

    <div v-if="locked" class="shrink-0 border-t border-border p-3">
      <Button class="w-full" @click="emit('copy')"><Copy class="size-4" />Make a copy to edit</Button>
    </div>
    <form v-else class="shrink-0 border-t border-border p-3" @submit.prevent="submit">
      <div v-if="streaming" class="mb-2 rounded-md bg-signal-100 px-3 py-1.5 text-xs text-signal-600">
        Building<template v-if="current"> · {{ current }}</template>
      </div>
      <div class="rounded-xl border bg-card px-2.5 pb-2 pt-1.5" :class="streaming ? 'border-signal-500' : 'border-input'">
        <Textarea
          v-model="draft"
          rows="2"
          placeholder="Describe a change…"
          :disabled="streaming"
          class="min-h-[44px] resize-none border-0 bg-transparent p-0 text-sm leading-[22px] shadow-none focus-visible:ring-0"
          @keydown.meta.enter.prevent="submit"
          @keydown.ctrl.enter.prevent="submit"
        />
        <div class="mt-1 flex items-center justify-between gap-2">
          <div class="flex gap-1">
            <Badge v-for="a in ['Contacts', 'Conversations', 'Calendars']" :key="a" variant="secondary" class="h-5 border-transparent bg-data-100 px-1.5 text-[11px] text-data-500">{{ a }}</Badge>
          </div>
          <Button type="submit" size="sm" :disabled="streaming || blocked || !draft.trim()">
            Build <span class="font-mono text-[11px] opacity-70">⌘↵</span>
          </Button>
        </div>
      </div>
    </form>
  </div>
</template>
