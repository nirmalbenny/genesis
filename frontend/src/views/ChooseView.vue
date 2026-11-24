<script setup lang="ts">
import { Check, Clock, ExternalLink, History, LoaderCircle, Sparkles } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppDetailsDialog, { type AppDetails } from '@/components/AppDetailsDialog.vue'
import GenesisMarkAnimated from '@/components/GenesisMarkAnimated.vue'
import TopBar from '@/components/TopBar.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useHl } from '@/composables/useHl'
import { screensOf, STEPS, useVersions, type Version } from '@/composables/useVersions'
import { guessCategory } from '@/lib/catalog'

const projectId = String(useRoute().params.id)
const router = useRouter()
const v = useVersions(projectId)
const { hl } = useHl()
/** Versions the customer has opened in this visit: a tick on the card guides them to try both. */
const previewed = ref(new Set<string>())
const MAX_SCREENS = 5

const saving = ref<Version | null>(null)
const busy = ref(false)
const saveError = ref('')
const stopping = ref(false)

const stepIndex = computed(() => STEPS.findIndex((s) => s.key === v.step.value))
const initial = computed<AppDetails | null>(() => saving.value && {
  name: v.name.value,
  description: (v.prompt.value || saving.value.summary).slice(0, 500),
  category: guessCategory(v.prompt.value),
})

// A version saved in another tab (from its preview): the app is ready to edit.
watch(v.state, (s) => { if (s === 'saved') router.replace(`/p/${projectId}`) })

/** Opens the version full-screen in a new tab, on live data, with "Save as app" in its top bar. */
function preview(version: Version) {
  previewed.value = new Set([...previewed.value, version.snapshotId])
  window.open(`/run/${projectId}?version=${version.snapshotId}`, '_blank', 'noopener')
}

async function save(details: AppDetails) {
  if (!saving.value) return
  busy.value = true
  saveError.value = ''
  try {
    await v.save(saving.value.snapshotId, details)
    await router.push(`/p/${projectId}`)
  } catch (e) {
    saveError.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function stop() {
  stopping.value = true
  await v.stop().catch(() => { stopping.value = false })
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <TopBar />
    <main class="mx-auto w-full max-w-[960px] px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      <p v-if="v.state.value === 'loading'" class="text-center text-sm text-muted-foreground">Loading…</p>

      <!-- Building: one app being made, no counts and no code -->
      <section v-else-if="v.state.value === 'building'" class="mx-auto grid max-w-md justify-items-center text-center" role="status" aria-live="polite">
        <GenesisMarkAnimated class="size-24 rounded-[22px] shadow-[0_12px_32px_rgba(33,51,67,0.18)]" />
        <h1 class="mt-6 text-2xl font-bold tracking-tight">Building your app</h1>
        <p class="mt-1.5 text-[15px] text-ink-200">This takes a few minutes. You can leave this page: your app will be waiting on the home page.</p>
        <ol class="mt-6 grid w-full gap-2 text-left">
          <li
            v-for="(s, i) in STEPS"
            :key="s.key"
            class="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm"
            :class="i > stepIndex && 'text-muted-foreground'"
          >
            <Check v-if="i < stepIndex" class="size-4 text-ok-500" aria-hidden="true" />
            <LoaderCircle v-else-if="i === stepIndex" class="size-4 animate-spin text-primary" aria-hidden="true" />
            <span v-else class="size-4 rounded-full border border-border" aria-hidden="true" />
            <span :class="i === stepIndex && 'font-medium'">{{ s.label }}</span>
          </li>
        </ol>
        <Button variant="ghost" class="mt-4" :disabled="stopping" @click="stop">{{ stopping ? 'Stopping…' : 'Stop' }}</Button>
      </section>

      <!-- Ready: the versions to choose from -->
      <section v-else-if="v.state.value === 'ready'">
        <div class="mx-auto max-w-[640px] text-center">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles class="size-3.5" aria-hidden="true" />{{ v.versions.value.length > 1 ? 'Two versions ready' : 'Your app is ready' }}
          </span>
          <h1 class="mt-3 text-[28px] font-bold leading-9 tracking-tight sm:text-[32px]">
            {{ v.versions.value.length > 1 ? 'Pick the version that fits how you work' : 'Try your app, then keep it' }}
          </h1>
          <p class="mt-2 text-[15px] leading-6 text-ink-200">
            {{ v.versions.value.length > 1 ? 'Both versions do what you asked for, laid out differently.' : 'It does what you asked for.' }}
            Each one runs on your live <span class="font-medium text-foreground">{{ hl?.locationName ?? 'HighLevel' }}</span> data, so try them with the records you work with every day.
          </p>
          <p v-if="v.prompt.value" class="mx-auto mt-4 line-clamp-2 max-w-[560px] rounded-lg border border-border bg-card px-4 py-2.5 text-left text-[13px] leading-5 text-ink-200">
            <span class="font-semibold text-foreground">You asked for:</span> {{ v.prompt.value }}
          </p>
        </div>

        <ol class="mx-auto mt-6 flex max-w-[640px] flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-ink-200" aria-label="How it works">
          <li v-for="(step, i) in ['Try each version', 'Keep the one you like', 'Edit it any time']" :key="step" class="flex items-center gap-2">
            <span class="grid size-5 place-items-center rounded-full bg-ink-100 text-[11px] font-bold text-white">{{ i + 1 }}</span>{{ step }}
          </li>
        </ol>

        <div class="mt-7 grid gap-4" :class="v.versions.value.length > 1 && 'md:grid-cols-2'">
          <article
            v-for="(version, i) in v.versions.value"
            :key="version.snapshotId"
            class="flex flex-col rounded-xl border bg-card shadow-[0_1px_2px_rgba(33,51,67,0.05)] transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-[0_8px_24px_rgba(33,51,67,0.08)]"
            :class="previewed.has(version.snapshotId) ? 'border-primary/40' : 'border-border'"
            :aria-labelledby="`version-${i}`"
          >
            <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <span class="flex min-w-0 items-center gap-2">
                <span class="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Option {{ 'AB'[i] ?? i + 1 }}</span>
                <span v-if="version.style" class="truncate rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-ink-200">{{ version.style }}</span>
              </span>
              <span v-if="previewed.has(version.snapshotId)" class="inline-flex items-center gap-1 text-xs font-medium text-ok-500">
                <Check class="size-3.5" aria-hidden="true" />Tried
              </span>
            </div>
            <div class="flex flex-1 flex-col px-5 pb-5 pt-4">
              <h2 :id="`version-${i}`" class="text-xl font-semibold tracking-tight">{{ version.title }}</h2>
              <p class="mt-1.5 text-[14px] leading-6 text-ink-200">{{ version.summary }}</p>

              <div v-if="screensOf(version.files).length" class="mt-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">What's inside</p>
                <ul class="mt-2 flex flex-wrap gap-1.5">
                  <li v-for="screen in screensOf(version.files).slice(0, MAX_SCREENS)" :key="screen" class="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-ink-200">{{ screen }}</li>
                  <li v-if="screensOf(version.files).length > MAX_SCREENS" class="px-1 py-0.5 text-xs text-muted-foreground">+{{ screensOf(version.files).length - MAX_SCREENS }} more</li>
                </ul>
              </div>

              <div class="mt-auto flex flex-wrap items-center gap-2 pt-5">
                <Button variant="outline" :aria-label="`Try ${version.title} on live data (opens in a new tab)`" @click="preview(version)">
                  <ExternalLink class="size-4" />Try it on live data
                </Button>
                <Button @click="saving = version"><Check class="size-4" />Keep this version</Button>
                <span v-if="version.credits !== null" class="ml-auto text-xs text-muted-foreground">{{ version.credits.toLocaleString() }} credits if kept</span>
              </div>
            </div>
          </article>
        </div>

        <ul class="mx-auto mt-6 grid max-w-[640px] gap-2 text-[13px] text-ink-200 sm:grid-cols-3">
          <li class="flex items-start gap-2"><Sparkles class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />You only pay for the version you keep.</li>
          <li class="flex items-start gap-2"><Clock class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />Not ready? They wait here for 7 days.</li>
          <li class="flex items-start gap-2"><History class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />The other version stays in your app's History.</li>
        </ul>
      </section>

      <!-- Built with problems: it becomes an app, opened in the editor with Fix with AI -->
      <section v-else-if="v.state.value === 'open'" class="mx-auto max-w-lg text-center">
        <h1 class="text-2xl font-bold tracking-tight">Your app needs a fix</h1>
        <p class="mt-2 text-[15px] text-ink-200">{{ v.message.value }}</p>
        <Button class="mt-5" @click="router.push(`/p/${projectId}`)">Open the app</Button>
      </section>

      <section v-else-if="v.state.value === 'failed'" class="mx-auto max-w-lg">
        <Alert variant="destructive" class="border-0 bg-danger-100">
          <AlertDescription class="text-foreground">{{ v.message.value || 'This build was stopped.' }}</AlertDescription>
        </Alert>
        <div class="mt-4 text-center"><Button variant="outline" @click="router.push('/')">Back to home</Button></div>
      </section>
    </main>

    <AppDetailsDialog
      :initial="initial"
      :title="saving ? `Keep ${saving.title}` : 'Keep this version'"
      subtitle="Give your app a name. You can rename it, and change anything in it, after you keep it."
      submit-label="Keep and open app"
      :busy="busy"
      :error="saveError"
      @submit="save"
      @close="saving = null"
    />
  </div>
</template>
