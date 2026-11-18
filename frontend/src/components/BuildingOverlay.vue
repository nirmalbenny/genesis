<script setup lang="ts">
import { Check, Code, LoaderCircle } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'

/**
 * Covers the preview while a build streams: an app wireframe assembling itself, the build's three steps, the first
 * sentence of Claude's plan (it fills in as Claude writes it), what is happening now and the files written so far.
 */
const props = defineProps<{
  file: string | null
  /** Files of this build in the order they started, with whether each is finished. */
  files: { path: string; done: boolean }[]
  reading?: string[]
  starting?: boolean
  /** Claude's plan as it streams (shown in the chat too). */
  plan?: string
}>()
defineEmits<{ 'show-code': [] }>()

const STEPS = ['Planning', 'Writing files', 'Starting your app'] as const
/** 0 planning (and reading), 1 writing, 2 starting the new version. */
const step = computed(() => (props.starting ? 2 : props.file || props.files.length ? 1 : 0))
const filesDone = computed(() => props.files.filter((f) => f.done).length)

/** The plan's first sentence, or what has streamed of it so far. */
const planLine = computed(() => {
  const text = (props.plan ?? '').trim().replace(/\s+/g, ' ')
  const first = /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text
  return first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first
})

/** The last four files (the one being written last), and how many came before them. */
const SHOWN = 4
const shownFiles = computed(() => props.files.slice(-SHOWN))
const earlier = computed(() => Math.max(0, props.files.length - SHOWN))
const short = (path: string) => path.replace(/^src\//, '')
</script>

<template>
  <div class="absolute inset-0 z-10 grid place-items-center bg-background/90 p-6 backdrop-blur-[2px]" role="status" aria-live="polite">
    <div class="grid w-full max-w-sm justify-items-center text-center">
      <!-- Wireframe of an app being assembled, piece by piece -->
      <div class="wire w-full max-w-[300px] rounded-xl border border-border bg-card p-3 shadow-[0_8px_24px_rgba(33,51,67,0.08)]" aria-hidden="true">
        <div class="flex items-center gap-1.5 border-b border-border pb-2">
          <i class="size-2 rounded-full bg-primary/70" /><i class="size-2 rounded-full bg-primary/40" /><i class="size-2 rounded-full bg-primary/20" />
          <i class="piece p1 ml-2 h-2 w-24 rounded bg-bg-300" />
        </div>
        <div class="mt-2.5 grid grid-cols-[56px_1fr] gap-2.5">
          <div class="grid content-start gap-1.5">
            <i class="piece p2 h-2 rounded bg-bg-300" /><i class="piece p2 h-2 w-4/5 rounded bg-muted" /><i class="piece p2 h-2 w-3/5 rounded bg-muted" />
          </div>
          <div class="grid gap-2">
            <div class="grid grid-cols-3 gap-1.5">
              <i class="piece p3 h-9 rounded-md border border-border bg-muted" />
              <i class="piece p4 h-9 rounded-md border border-border bg-muted" />
              <i class="piece p5 h-9 rounded-md border border-border bg-secondary" />
            </div>
            <div class="piece p6 flex h-14 items-end gap-1 rounded-md border border-border p-1.5">
              <i v-for="h in [40, 65, 50, 80, 60, 95]" :key="h" class="bar flex-1 rounded-sm bg-primary/60" :style="{ height: `${h}%` }" />
            </div>
          </div>
        </div>
      </div>

      <!-- The build's three steps: done ones ticked, the current one pulsing. -->
      <ol class="mt-5 flex items-center gap-2 text-xs" aria-label="Build steps">
        <li v-for="(label, i) in STEPS" :key="label" class="flex items-center gap-2">
          <span v-if="i > 0" class="h-px w-5" :class="i <= step ? 'bg-primary/50' : 'bg-border'" aria-hidden="true" />
          <span class="flex items-center gap-1.5" :class="i === step ? 'font-semibold text-foreground' : i < step ? 'text-ink-200' : 'text-muted-foreground'" :aria-current="i === step ? 'step' : undefined">
            <span class="grid size-4 place-items-center rounded-full" :class="i < step ? 'bg-ok-100 text-ok-500' : i === step ? 'bg-secondary' : 'bg-muted'" aria-hidden="true">
              <Check v-if="i < step" class="size-3" />
              <i v-else class="size-1.5 rounded-full" :class="i === step ? 'animate-pulse bg-primary' : 'bg-line-200'" />
            </span>
            {{ label }}
          </span>
        </li>
      </ol>

      <p class="mt-4 text-sm font-semibold">
        {{ starting ? 'Starting your app' : 'Building your app' }}
      </p>
      <p v-if="planLine && !starting" class="mt-1.5 line-clamp-2 max-w-[340px] text-[13px] leading-5 text-ink-200">{{ planLine }}</p>
      <p class="mt-1.5 text-[13px] text-muted-foreground">
        <template v-if="starting">Loading the new version with live data</template>
        <template v-else-if="file">Writing <span class="font-mono text-ink-200">{{ file.split('/').pop() }}</span></template>
        <template v-else-if="reading?.length">Reading <span class="font-mono text-ink-200">{{ reading.map((p) => p.split('/').pop()).join(', ') }}</span></template>
        <template v-else>Planning the changes</template>
        <template v-if="filesDone && !starting"> · {{ filesDone }} {{ filesDone === 1 ? 'file' : 'files' }} done</template>
      </p>

      <!-- The files written so far: finished ones ticked, the one being written with a spinner. -->
      <ul v-if="files.length && !starting" class="mt-3 grid w-full max-w-[300px] gap-1 rounded-lg border border-border bg-card px-3 py-2 text-left" aria-label="Files">
        <li v-if="earlier" class="text-[11px] text-muted-foreground">+{{ earlier }} more</li>
        <li v-for="f in shownFiles" :key="f.path" class="flex min-w-0 items-center gap-2 text-xs">
          <Check v-if="f.done" class="size-3.5 shrink-0 text-ok-500" aria-label="Done" />
          <LoaderCircle v-else class="size-3.5 shrink-0 animate-spin text-primary" aria-label="Writing" />
          <span class="truncate font-mono" :class="f.done ? 'text-ink-200' : 'text-foreground'">{{ short(f.path) }}</span>
        </li>
      </ul>
      <p v-if="!starting" class="mt-3 text-xs text-muted-foreground">The preview updates with live data as soon as the build finishes.</p>
      <Button v-if="!starting" variant="outline" size="sm" class="mt-4" @click="$emit('show-code')"><Code class="size-4" />Watch the code</Button>
    </div>
  </div>
</template>

<style scoped>
/* Pieces pop in one after another, hold, then reset: a loop of the app taking shape. */
.piece {
  animation: assemble 3.6s ease-in-out infinite;
  transform-origin: center;
}
.p1 { animation-delay: 0s; }
.p2 { animation-delay: 0.25s; }
.p3 { animation-delay: 0.5s; }
.p4 { animation-delay: 0.7s; }
.p5 { animation-delay: 0.9s; }
.p6 { animation-delay: 1.15s; }
.bar {
  animation: grow 3.6s ease-in-out infinite;
  animation-delay: 1.3s;
  transform-origin: bottom;
}
@keyframes assemble {
  0%, 8% { opacity: 0; transform: scale(0.92); }
  18%, 82% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1); }
}
@keyframes grow {
  0%, 10% { transform: scaleY(0); }
  25%, 82% { transform: scaleY(1); }
  100% { transform: scaleY(1); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .piece, .bar { animation: none; }
}
</style>
