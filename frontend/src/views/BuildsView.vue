<script setup lang="ts">
import { ChevronRight, Columns2, LoaderCircle } from '@lucide/vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import TopBar from '@/components/TopBar.vue'
import { Button } from '@/components/ui/button'
import { useActiveBuilds } from '@/composables/useActiveBuilds'
import { OUTCOMES, opens, useBuildHistory, type BuildRecord } from '@/composables/useBuildHistory'
import { timeAgo } from '@/lib/time'

/**
 * Builds: what waits for the customer (versions to choose), what is building now, and the builds that finished
 * (one row each, kept current by the server: a saved version shows its app, an unsaved one expires).
 */
const router = useRouter()
const { items: active } = useActiveBuilds()
const { waiting, recent, hasMore, loaded, loadMore } = useBuildHistory()
const building = computed(() => active.value.filter((b) => b.state === 'building'))

const TONES = {
  ok: 'bg-ok-100 text-ok-500',
  warn: 'bg-warn-100 text-warn-500',
  danger: 'bg-danger-100 text-destructive',
  muted: 'bg-muted text-muted-foreground',
}
const outcome = (r: BuildRecord) => OUTCOMES[r.outcome as keyof typeof OUTCOMES] ?? OUTCOMES.updated
const versionsText = (v: string[]) => (v.length > 1 ? `Choose between ${v.slice(0, -1).join(', ')} and ${v.at(-1)}` : `${v[0] ?? 'Your app'} is ready to save`)
const detail = (r: BuildRecord) => [timeAgo(r.endedAt), r.credits !== null ? `${r.credits.toLocaleString()} credits` : ''].filter(Boolean).join(' · ')

// Versions to choose: from the history, plus any draft ready without a record (built before the history existed).
const choices = computed(() => [
  ...waiting.value.map((r) => ({ key: r.id, name: r.appName, text: `${versionsText(r.versions)} · ${timeAgo(r.endedAt)}`, href: r.href })),
  ...active.value
    .filter((b) => b.state === 'ready' && !waiting.value.some((r) => r.projectId === b.projectId))
    .map((b) => ({ key: b.projectId, name: b.name, text: 'Your versions are ready', href: b.href })),
])

const heading = 'mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground'
const list = 'overflow-hidden rounded-xl border border-border bg-card'
const row = 'flex w-full items-center gap-3 px-4 py-3.5 text-left'
const link = 'outline-none transition-colors hover:bg-secondary/60 focus-visible:bg-secondary'
</script>

<template>
  <div class="min-h-screen bg-background">
    <TopBar />
    <main class="mx-auto w-full max-w-[760px] px-4 pb-16 pt-10 sm:px-6">
      <h1 class="text-[28px] font-bold tracking-tight">Builds</h1>
      <p class="mt-1 text-[15px] text-ink-200">What's waiting for you, what's building now, and what finished.</p>

      <!-- Versions to choose: the customer's next step, first -->
      <section v-if="choices.length" class="mt-8" aria-labelledby="waiting-heading">
        <h2 id="waiting-heading" :class="heading">Waiting for you</h2>
        <ul :class="list">
          <li v-for="c in choices" :key="c.key" class="border-b border-border last:border-0">
            <div :class="row">
              <Columns2 class="size-4 shrink-0 text-primary" aria-hidden="true" />
              <span class="grid min-w-0 flex-1">
                <span class="truncate text-sm font-semibold">{{ c.name }}</span>
                <span class="truncate text-xs text-muted-foreground">{{ c.text }}</span>
              </span>
              <Button size="sm" @click="router.push(c.href)">Choose</Button>
            </div>
          </li>
        </ul>
      </section>

      <section class="mt-8" aria-labelledby="building-heading">
        <h2 id="building-heading" :class="heading">Building now</h2>
        <p v-if="!building.length" class="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">Nothing is building right now.</p>
        <ul v-else :class="list">
          <li v-for="b in building" :key="b.projectId" class="border-b border-border last:border-0">
            <button type="button" :class="[row, link]" @click="router.push(b.href)">
              <LoaderCircle class="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ b.name }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">Building…</span>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </section>

      <section class="mt-8" aria-labelledby="recent-heading">
        <h2 id="recent-heading" :class="heading">Recent</h2>
        <p v-if="loaded && !recent.length" class="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">Finished builds will appear here.</p>
        <ul v-else-if="recent.length" :class="list">
          <li v-for="r in recent" :key="r.id" class="border-b border-border last:border-0">
            <component
              :is="opens(r) ? 'button' : 'div'"
              :type="opens(r) ? 'button' : undefined"
              :class="[row, opens(r) && link]"
              @click="opens(r) && router.push(r.href)"
            >
              <span class="grid min-w-0 flex-1 gap-0.5">
                <span class="flex min-w-0 items-center gap-2">
                  <span class="truncate text-sm font-semibold">{{ r.appName }}</span>
                  <span class="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold" :class="TONES[outcome(r).tone]">{{ outcome(r).label }}</span>
                </span>
                <span class="truncate text-[13px] text-ink-200">{{ r.request }}</span>
                <span class="text-xs text-muted-foreground">{{ detail(r) }}</span>
              </span>
              <ChevronRight v-if="opens(r)" class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </component>
          </li>
        </ul>
        <div v-if="hasMore" class="mt-3 text-center">
          <Button variant="outline" size="sm" @click="loadMore">Load more</Button>
        </div>
      </section>
    </main>
  </div>
</template>
