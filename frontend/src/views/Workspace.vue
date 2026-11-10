<script setup lang="ts">
import { CircleAlert, Code, ExternalLink, Eye } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel, { type Notice } from '@/components/ChatPanel.vue'
import CopyAppDialog from '@/components/CopyAppDialog.vue'
import EditorPanel from '@/components/EditorPanel.vue'
import FileTree from '@/components/FileTree.vue'
import PreviewPanel from '@/components/PreviewPanel.vue'
import SnapshotSheet from '@/components/SnapshotSheet.vue'
import TopBar from '@/components/TopBar.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGeneration } from '@/composables/useGeneration'
import { useHl } from '@/composables/useHl'
import { useProject } from '@/composables/useProject'
import { api } from '@/lib/api'

const route = useRoute()
const router = useRouter()
const projectId = String(route.params.id)
// A prompt from the dashboard is sent automatically ("Create app"); without autostart it only pre-fills the composer.
const startPrompt = typeof route.query.prompt === 'string' ? route.query.prompt : ''
const autostart = route.query.autostart === '1' && !!startPrompt
const initialDraft = autostart ? '' : startPrompt
const panel = 'min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card'
const center = ref<'preview' | 'code'>('preview')
const mobileChat = ref(false)
// Phones show one pane at a time: chat, preview or code. Desktop always shows chat and the centre tabs.
const mobileTab = computed({
  get: () => (mobileChat.value ? 'chat' : center.value),
  set: (v: string) => {
    mobileChat.value = v === 'chat'
    if (v !== 'chat') center.value = v as 'preview' | 'code'
  },
})
const project = useProject(projectId)
const hlState = useHl()
const preview = ref<InstanceType<typeof PreviewPanel> | null>(null)
const snapshotsOpen = ref(false)
const copyOpen = ref(false)
const locked = computed(() => project.kind.value === 'prebuilt')
const ready = ref(false)

const openTabs = ref<string[]>([])
const active = ref<string | null>(null)
const saveError = ref('')
const pendingPrompt = ref<string | null>(null)
const notices = ref<Notice[]>([])

async function send(prompt: string) {
  pendingPrompt.value = prompt
  await gen.start(projectId, prompt)
  // Declined requests are kept only in this view (never stored), so they don't affect later prompts.
  if (gen.declined.value) {
    notices.value.push({ prompt, message: gen.declined.value, afterCount: project.messages.value.length })
  }
  pendingPrompt.value = null
}

/** Opens a file tab. `reveal` switches to the Code view; streaming opens tabs quietly so the preview's build overlay stays visible. */
function open(path: string, reveal = true) {
  if (!openTabs.value.includes(path)) openTabs.value.push(path)
  active.value = path
  if (!reveal) return
  center.value = 'code'
  mobileChat.value = false
}

function close(path: string) {
  openTabs.value = openTabs.value.filter((p) => p !== path)
  if (active.value === path) active.value = openTabs.value[openTabs.value.length - 1] ?? null
}

/** Re-syncs with the server and drops tabs for files that no longer exist. */
async function resync() {
  await project.loadFiles()
  openTabs.value = openTabs.value.filter((p) => p in project.files)
  if (!active.value || !(active.value in project.files)) active.value = openTabs.value[0] ?? null
  await preview.value?.refresh()
}

const gen = useGeneration({
  onFileStart: (path) => {
    project.files[path] = ''
    open(path, false)
  },
  onToken: (path, text) => {
    project.files[path] = (project.files[path] ?? '') + text
  },
  onFinished: resync,
})

// Manual edits: update locally, save after a short pause, then refresh the preview.
const timers = new Map<string, ReturnType<typeof setTimeout>>()
function edit(path: string, content: string) {
  project.files[path] = content
  clearTimeout(timers.get(path))
  timers.set(path, setTimeout(async () => {
    try {
      await api('PUT', `/projects/${projectId}/files`, { path, content })
      saveError.value = ''
      await preview.value?.refresh()
    } catch (e) {
      saveError.value = `Could not save ${path}: ${(e as Error).message}`
    }
  }, 800))
}

const paths = computed(() => Object.keys(project.files))
const currentFile = computed(() => gen.building.value.find((b) => !b.done)?.path ?? null)

onMounted(async () => {
  await project.init()
  if (project.files['src/App.vue'] !== undefined) {
    openTabs.value.push('src/App.vue') // preselect without leaving the preview tab
    active.value = 'src/App.vue'
  }
  ready.value = true
  if (autostart) {
    await router.replace({ path: route.path }) // drop the query so a refresh does not send it again
    send(startPrompt)
  }
})
</script>

<template>
  <div class="flex h-screen flex-col bg-background">
    <TopBar :crumb="project.name.value">
      <template #actions>
        <Button size="sm" variant="outline" class="h-7 gap-1.5 border-white/25 bg-white/10 text-xs text-white hover:bg-white/20 hover:text-white" as-child>
          <a :href="`/run/${projectId}`" target="_blank" rel="noopener"><ExternalLink class="size-3.5" />Open in new tab</a>
        </Button>
      </template>
      <template #status>
        <Badge v-if="locked" variant="secondary" class="border-transparent bg-white/15 text-white">Ready-made</Badge>
        <Badge v-if="gen.streaming.value" variant="secondary" class="border-transparent bg-signal-100 text-signal-600">
          <span class="size-[7px] rounded-full bg-signal-500" />Building<template v-if="currentFile"> · {{ currentFile.split('/').pop() }}</template>
        </Badge>
      </template>
    </TopBar>

    <div v-if="hlState.loaded.value && !hlState.hl.value" class="flex items-center gap-3 bg-warn-100 px-4 py-2 text-[13px]">
      <CircleAlert class="size-4 shrink-0 text-warn-500" />
      <p class="flex-1"><b class="font-semibold">Preview needs HighLevel.</b> Connect a location to build and load real contacts here.</p>
      <Button size="sm" :disabled="hlState.busy.value !== null" @click="hlState.connect()">Connect HighLevel</Button>
    </div>
    <Alert v-if="hlState.error.value" variant="destructive" class="rounded-none border-0 bg-danger-100"><AlertDescription class="text-foreground">{{ hlState.error.value }}</AlertDescription></Alert>
    <Alert v-if="project.loadError.value" variant="destructive" class="rounded-none border-0 bg-danger-100"><AlertDescription class="text-foreground">{{ project.loadError.value }}</AlertDescription></Alert>
    <Alert v-if="saveError" variant="destructive" class="rounded-none border-0 bg-danger-100"><AlertDescription class="text-foreground">{{ saveError }}</AlertDescription></Alert>

    <Tabs v-model="mobileTab" class="shrink-0 border-b border-border lg:hidden">
      <TabsList variant="line" class="w-full">
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="code">Code</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
    </Tabs>

    <div class="grid min-h-0 flex-1 gap-2 p-2 max-lg:overflow-y-auto lg:grid-cols-[340px_minmax(0,1fr)_220px]">
      <section :class="[panel, mobileChat ? 'flex max-lg:min-h-[70vh]' : 'hidden lg:flex']">
        <ChatPanel
          :initial-draft="initialDraft"
          :blocked="hlState.loaded.value && !hlState.hl.value"
          :messages="project.messages.value"
          :notices="notices"
          :pending-prompt="pendingPrompt"
          :streaming="gen.streaming.value"
          :plan="gen.plan.value"
          :error="gen.error.value"
          :building="gen.building.value"
          :last-credits="gen.lastCredits.value"
          :locked="locked"
          @send="send"
          @copy="copyOpen = true"
          @open-file="open"
          @history="snapshotsOpen = true"
        />
      </section>

      <section :class="[panel, mobileChat ? 'hidden lg:flex' : 'flex max-lg:min-h-[70vh]']">
        <Tabs v-model="center" class="shrink-0 border-b border-border">
          <TabsList variant="line" class="h-10 justify-start px-2">
            <TabsTrigger value="preview"><Eye class="size-4" />Preview</TabsTrigger>
            <TabsTrigger value="code"><Code class="size-4" />Code</TabsTrigger>
          </TabsList>
        </Tabs>
        <PreviewPanel
          v-if="ready"
          v-show="center === 'preview'"
          ref="preview"
          class="min-h-0 flex-1"
          :project-id="projectId"
          :files="project.files"
          :connected="!!hlState.hl.value"
          :location-name="hlState.hl.value?.locationName ?? null"
          :building="gen.streaming.value"
          :building-file="currentFile"
          :files-done="gen.building.value.filter((b) => b.done).length"
          @connect="hlState.connect()"
          @show-code="center = 'code'; mobileChat = false"
        />
        <EditorPanel
          v-show="center === 'code'"
          class="min-h-0 flex-1"
          :files="project.files"
          :open-tabs="openTabs"
          :active="active"
          :read-only="gen.streaming.value || locked"
          :locked="locked"
          :building="currentFile"
          @update:active="active = $event"
          @close="close"
          @edit="edit"
        />
      </section>

      <section :class="[panel, center === 'code' && !mobileChat ? 'flex max-lg:h-56' : 'hidden lg:flex']">
        <FileTree :paths="paths" :active="active" :building="currentFile" @select="open" />
      </section>
    </div>

    <SnapshotSheet v-model:open="snapshotsOpen" :project-id="projectId" :busy="gen.streaming.value || locked" @restored="resync" />
    <CopyAppDialog
      :source="copyOpen ? { id: projectId, name: project.name.value, description: project.description.value, category: project.category.value } : null"
      @close="copyOpen = false"
    />
  </div>
</template>
