<script setup lang="ts">
import { ArrowRight, CalendarDays, Check, Contact, CornerDownLeft, LoaderCircle, MessageSquare, Plug, Sparkles } from '@lucide/vue'
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppCard from '@/components/AppCard.vue'
import AppDetailsDialog from '@/components/AppDetailsDialog.vue'
import CopyAppDialog from '@/components/CopyAppDialog.vue'
import TopBar from '@/components/TopBar.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useApps, type App } from '@/composables/useApps'
import { useCreateApp } from '@/composables/useCreateApp'
import { useHl } from '@/composables/useHl'

// Starting points fill the composer with an existing prompt; the user reviews it and presses Build.
const starters = [
  { icon: Contact, label: 'Contact dashboard', text: 'Search contacts and see upcoming appointments', prompt: 'Build a contact dashboard with search and a list of upcoming appointments' },
  { icon: CalendarDays, label: 'Appointment manager', text: 'Upcoming events per calendar, grouped by day', prompt: 'Build an appointments view: a dropdown of my calendars and the upcoming events for the selected calendar, grouped by day' },
  { icon: MessageSquare, label: 'Conversation inbox', text: 'Conversations with unread counts and messages', prompt: "Build an inbox: conversations on the left with unread counts, and the selected conversation's messages on the right" },
]
const sources = ['Contacts', 'Conversations', 'Calendars']

const steps = ['Connect your HighLevel location', 'Describe what you want to build', 'Preview with live data']

const route = useRoute()
const router = useRouter()
const { hl, loaded, busy, error: hlError, connect } = useHl()
const { apps, error: appsError, settingUp } = useApps()
const creator = useCreateApp()

const prompt = ref('')
const error = ref(route.query.hl === 'error' ? 'HighLevel connection failed. Try again.' : '')
const copySource = ref<App | null>(null)

const readyMade = computed(() => apps.value.filter((a) => a.prebuilt).sort((a, b) => a.name.localeCompare(b.name)))

const composer = ref<HTMLElement | null>(null)
async function useStarter(text: string) {
  prompt.value = text
  await nextTick()
  composer.value?.querySelector('textarea')?.focus()
}

function startBuild() {
  const text = prompt.value.trim()
  if (!text) return
  creator.fromPrompt(text)
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <TopBar />

    <main class="mx-auto w-full max-w-[1040px] px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      <div class="mx-auto mb-6 grid max-w-[760px] gap-2 empty:hidden">
        <Alert v-if="route.query.hl === 'connected' && !error" class="border-0 bg-ok-100">
          <Check class="size-4 text-ok-500" /><AlertDescription class="text-foreground">HighLevel connected. You're ready to build.</AlertDescription>
        </Alert>
        <Alert v-if="error || hlError || appsError" variant="destructive" class="border-0 bg-danger-100"><AlertDescription class="text-foreground">{{ error || hlError || appsError }}</AlertDescription></Alert>
      </div>

      <p v-if="!loaded" class="text-center text-sm text-muted-foreground">Loading…</p>

      <!-- Not connected: compact get-started -->
      <section v-else-if="!hl" class="mx-auto max-w-[760px] rounded-xl border border-border bg-card p-6 sm:p-8">
        <span class="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Plug class="size-5" /></span>
        <h1 class="mt-4 text-2xl font-bold tracking-tight sm:text-[28px]">Make your HighLevel data work harder.</h1>
        <p class="mt-2 max-w-xl text-[15px] leading-6 text-ink-200">
          Turn your HighLevel data into custom dashboards, applications, and tools designed around the way you work.
        </p>
        <Button class="mt-5 h-10 px-5" :disabled="busy !== null" @click="connect()">{{ busy === 'connecting' ? 'Redirecting…' : 'Connect HighLevel' }}</Button>
        <ol class="mt-6 grid gap-3 border-t border-border pt-5 sm:grid-cols-3">
          <li v-for="(title, i) in steps" :key="title" class="flex items-center gap-3">
            <span class="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold text-ink-200">{{ i + 1 }}</span>
            <span class="text-[13px] font-medium leading-5">{{ title }}</span>
          </li>
        </ol>
      </section>

      <!-- Connected: prompt-first workspace -->
      <section v-else class="mx-auto max-w-[760px]">
        <h1 class="text-center text-[28px] font-bold leading-9 tracking-tight sm:text-[32px]">What would you like to build?</h1>
        <p class="mt-1.5 text-center text-[15px] text-ink-200">Create custom apps using your HighLevel data.</p>

        <div
          ref="composer"
          class="mt-7 rounded-xl border border-input bg-card shadow-[0_1px_2px_rgba(33,51,67,0.05)] transition-[border-color,box-shadow] focus-within:border-primary focus-within:shadow-[0_0_0_4px_rgba(255,92,53,0.12)]"
        >
          <label for="composer" class="sr-only">Describe the app you want to build</label>
          <div class="relative">
          <Sparkles class="pointer-events-none absolute left-4 top-[19px] size-4 text-primary/70" aria-hidden="true" />
          <Textarea
            id="composer"
            v-model="prompt"
            rows="3"
            placeholder="Describe what you want to build. For example, create a daily appointment dashboard with customer details..."
            class="min-h-[104px] resize-none border-0 bg-transparent pl-11 pr-4 pt-4 text-[15px] leading-6 shadow-none focus-visible:ring-0"
            @keydown.meta.enter.prevent="startBuild"
            @keydown.ctrl.enter.prevent="startBuild"
          />
          </div>
          <div class="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
            <span class="text-xs text-muted-foreground">Using live data:</span>
            <span v-for="d in sources" :key="d" class="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-ink-200">{{ d }}</span>
            <span class="hidden truncate text-xs text-muted-foreground sm:inline">from <span class="font-medium text-ink-200">{{ hl.locationName }}</span></span>
            <span class="flex-1" />
            <span class="hidden items-center gap-0.5 text-xs text-muted-foreground sm:inline-flex">⌘<CornerDownLeft class="size-3" /></span>
            <Button class="h-9 px-4" :disabled="!prompt.trim()" @click="startBuild"><Sparkles class="size-4" />Build</Button>
          </div>
        </div>

        <div class="mt-5">
          <p class="mb-2 text-xs font-medium text-muted-foreground">Or start from an example</p>
          <div class="grid gap-2.5 sm:grid-cols-3">
            <Button
              v-for="t in starters"
              :key="t.label"
              variant="outline"
              class="group h-full shrink cursor-pointer items-start justify-start gap-3 whitespace-normal rounded-lg border-border bg-card p-3 text-left font-normal transition-[background-color,border-color] duration-150 hover:border-primary/35 hover:bg-secondary/60 active:not-aria-[haspopup]:translate-y-0"
              :aria-label="`Use the ${t.label} example prompt`"
              @click="useStarter(t.prompt)"
            >
              <span class="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-primary"><component :is="t.icon" class="size-4" /></span>
              <span class="min-w-0 flex-1">
                <span class="block text-[13px] font-semibold leading-5">{{ t.label }}</span>
                <span class="block text-xs leading-4 text-muted-foreground">{{ t.text }}</span>
              </span>
              <ArrowRight
                class="mt-1 size-4 shrink-0 -translate-x-1 text-primary opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>
      </section>

      <!-- Ready-made apps -->
      <section v-if="loaded && (settingUp || readyMade.length)" class="mt-12 border-t border-border pt-8">
        <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold tracking-tight">Ready-made apps</h2>
            <p class="mt-0.5 text-[13px] text-muted-foreground">Built for HighLevel and ready to use. Open one as it is, or make a copy to change it.</p>
          </div>
          <Button variant="ghost" size="sm" class="-mr-2 text-primary hover:text-primary" @click="router.push('/apps')">
            View all apps<ArrowRight class="size-4" />
          </Button>
        </div>
        <!-- First sign-in: the apps are still being added. Show them together once ready, not one by one. -->
        <div v-if="settingUp" role="status" aria-live="polite">
          <p class="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle class="size-4 animate-spin text-primary" aria-hidden="true" />Setting up your account. Your ready-made apps will appear here in a moment.
          </p>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            <div v-for="i in 6" :key="i" class="h-[186px] animate-pulse rounded-xl border border-border bg-card p-4">
              <div class="flex gap-3"><div class="size-10 rounded-lg bg-muted" /><div class="grid flex-1 content-start gap-2 pt-1"><div class="h-3.5 w-2/3 rounded bg-muted" /><div class="h-3 w-1/3 rounded bg-muted" /></div></div>
              <div class="mt-5 grid gap-2"><div class="h-3 rounded bg-muted" /><div class="h-3 w-4/5 rounded bg-muted" /></div>
            </div>
          </div>
        </div>
        <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AppCard
            v-for="a in readyMade"
            :key="a.id"
            :app="a"
            :removable="false"
            :show-kind="false"
            @edit="router.push(`/p/${a.id}`)"
            @copy="copySource = a"
          />
        </div>
      </section>
    </main>

    <CopyAppDialog :source="copySource" @close="copySource = null" />
    <AppDetailsDialog
      :initial="creator.initial.value"
      title="Name your app"
      :subtitle="`Genesis starts building as soon as you create it, on ${hl?.locationName}.`"
      submit-label="Create and build"
      :busy="creator.busy.value"
      :error="creator.error.value"
      @submit="creator.create"
      @close="creator.initial.value = null"
    />
  </div>
</template>
