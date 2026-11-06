<script setup lang="ts">
import { Lock, X } from '@lucide/vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import { computed } from 'vue'
import FileTag from '@/components/FileTag.vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const props = defineProps<{
  files: Record<string, string>
  openTabs: string[]
  active: string | null
  readOnly: boolean
  building: string | null
  /** Ready-made app: always read-only, with its own explanation. */
  locked?: boolean
}>()
const emit = defineEmits<{
  'update:active': [path: string]
  close: [path: string]
  edit: [path: string, content: string]
}>()

const languages: Record<string, string> = { vue: 'html', js: 'javascript', ts: 'typescript', css: 'css', json: 'json' }
const language = computed(() => languages[props.active?.split('.').pop() ?? ''] ?? 'plaintext')
const value = computed(() => (props.active ? props.files[props.active] ?? '' : ''))
const lines = computed(() => value.value.split('\n').length)

// Editor surface is the design system's code-bg in every theme.
function defineTheme(monaco: { editor: { defineTheme: (name: string, theme: object) => void } }) {
  monaco.editor.defineTheme('genesis', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#17232f',
      'editorGutter.background': '#17232f',
      'editorLineNumber.foreground': '#8a8a90',
      'editor.lineHighlightBackground': '#1f2f3d',
    },
  })
}

function onChange(next: string | undefined) {
  // Monaco also fires on programmatic value changes (e.g. streaming); only forward real edits.
  if (props.readOnly || !props.active || next === undefined || next === props.files[props.active]) return
  emit('edit', props.active, next)
}
</script>

<template>
  <div class="flex h-full min-w-0 flex-col">
    <Tabs :model-value="active ?? ''" class="shrink-0" @update:model-value="emit('update:active', String($event))">
      <TabsList variant="line" class="h-10 w-full justify-start gap-0.5 overflow-x-auto rounded-none border-b border-border px-2 pb-0">
        <div
          v-for="p in openTabs"
          :key="p"
          class="flex h-8 items-center rounded-t-md pr-1"
          :class="p === active ? 'bg-code-bg text-code-ink' : 'text-muted-foreground hover:text-foreground'"
        >
          <TabsTrigger :value="p" class="h-8 flex-none gap-1.5 bg-transparent px-2.5 text-xs text-inherit shadow-none data-active:bg-transparent data-active:text-inherit">
            <FileTag :path="p" />{{ p.split('/').pop() }}
            <span v-if="p === building" class="size-1.5 rounded-full bg-signal-500" />
          </TabsTrigger>
          <Button variant="ghost" size="icon-xs" class="text-inherit hover:bg-white/10" :aria-label="`Close ${p}`" @click="emit('close', p)"><X /></Button>
        </div>
      </TabsList>
    </Tabs>
    <div v-if="readOnly" class="flex h-7 shrink-0 items-center gap-2 px-3 text-xs" :class="locked ? 'bg-muted text-ink-200' : 'bg-signal-100 text-signal-600'">
      <Lock class="size-3.5" /><span class="flex-1">{{ locked ? 'Ready-made app: make a copy to edit the code' : 'Read-only while this build runs' }}</span>
      <span v-if="active" class="font-mono text-[11px]">{{ lines }} lines</span>
    </div>
    <div class="min-h-0 flex-1 bg-code-bg">
      <VueMonacoEditor
        v-if="active"
        :value="value"
        :language="language"
        :path="active"
        theme="genesis"
        :options="{ readOnly, minimap: { enabled: false }, fontSize: 13, fontFamily: 'IBM Plex Mono, ui-monospace, Menlo, monospace', automaticLayout: true, scrollBeyondLastLine: false }"
        @before-mount="defineTheme"
        @change="onChange"
      />
      <p v-else class="p-4 text-sm text-code-muted">Select a file to view it.</p>
    </div>
  </div>
</template>
