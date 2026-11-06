<script setup lang="ts">
import { Code } from '@lucide/vue'
import { Button } from '@/components/ui/button'

/** Covers the preview while a build streams: an app wireframe assembling itself plus live progress. */
defineProps<{ file: string | null; filesDone: number }>()
defineEmits<{ 'show-code': [] }>()
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

      <p class="mt-5 flex items-center gap-2 text-sm font-semibold">
        <span class="relative grid size-2.5 place-items-center">
          <span class="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
          <span class="relative size-2 rounded-full bg-primary" />
        </span>
        Building your app
      </p>
      <p class="mt-1 text-[13px] text-muted-foreground">
        <template v-if="file">Writing <span class="font-mono text-ink-200">{{ file.split('/').pop() }}</span></template>
        <template v-else>Planning the changes</template>
        <template v-if="filesDone"> · {{ filesDone }} {{ filesDone === 1 ? 'file' : 'files' }} done</template>
      </p>
      <p class="mt-3 text-xs text-muted-foreground">The preview updates with live data as soon as the build finishes.</p>
      <Button variant="outline" size="sm" class="mt-4" @click="$emit('show-code')"><Code class="size-4" />Watch the code</Button>
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
