<script setup lang="ts">
import { Database, Eye, EyeOff, History, ShieldCheck, Sparkles } from '@lucide/vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import AuthIllustration from '@/components/AuthIllustration.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const props = defineProps<{
  title: string
  subtitle: string
  submitLabel: string
  altText: string
  altLink: string
  altLabel: string
  action: (email: string, password: string) => Promise<unknown>
}>()

const router = useRouter()
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const busy = ref(false)

const benefits = [
  { icon: Sparkles, title: 'Describe what you need', text: 'Start with a prompt. Genesis builds the app.' },
  { icon: Database, title: 'Powered by your real data', text: 'Build with your connected HighLevel data.' },
  { icon: History, title: 'Experiment with confidence', text: 'Restore previous versions whenever you need.' },
]

const messages: Record<string, string> = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
}

async function submit() {
  error.value = ''
  busy.value = true
  try {
    await props.action(email.value, password.value)
    await router.push('/')
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    error.value = messages[code] ?? 'Something went wrong. Try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="grid min-h-screen lg:grid-cols-[54fr_46fr]">
    <!-- Product storytelling (desktop) -->
    <aside
      class="relative hidden overflow-hidden bg-[radial-gradient(36rem_24rem_at_0%_0%,rgba(255,92,53,0.16),transparent_65%),linear-gradient(160deg,#213343,#0f1a24)] px-12 py-10 text-white lg:block xl:px-16"
    >
     <div class="mx-auto flex h-full w-full max-w-[560px] flex-col">
      <AppLogo inverted />

      <div class="my-auto w-full max-w-[540px] py-8">
        <span class="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/75">
          <span class="size-1.5 rounded-full bg-primary" />Your HighLevel data, reimagined
        </span>
        <h2 class="mt-5 max-w-[500px] text-[42px] font-bold leading-[1.1] tracking-[-0.02em] xl:text-[46px]">
          Build apps from your <span class="text-[#ff8f73]">HighLevel data.</span>
        </h2>
        <p class="mt-4 max-w-[480px] text-[15px] leading-6 text-white/65">
          Your data already has value. Tell Genesis what your team needs, and turn it into custom apps, dashboards and workflows.
        </p>

        <AuthIllustration class="mt-8" />

        <ul class="mt-8 grid gap-4">
          <li v-for="b in benefits" :key="b.title" class="flex items-center gap-3.5">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-[#ff8f73] ring-1 ring-white/10">
              <component :is="b.icon" class="size-[18px]" />
            </span>
            <span class="min-w-0">
              <span class="block text-sm font-semibold leading-5">{{ b.title }}</span>
              <span class="block text-[13px] leading-5 text-white/55">{{ b.text }}</span>
            </span>
          </li>
        </ul>
      </div>

      <p class="flex items-center gap-1.5 text-[11px] text-white/40">
        <ShieldCheck class="size-3.5" />Read-only HighLevel access · Tokens stay on the server · 6 ready-made apps included
      </p>
     </div>
    </aside>

    <!-- Authentication -->
    <section class="flex min-h-screen flex-col bg-card px-6 py-8 sm:px-10 lg:min-h-0">
      <div class="lg:hidden">
        <AppLogo />
      </div>

      <div class="mx-auto mt-10 w-full max-w-[372px] pb-8 md:my-auto md:py-8">
        <!-- Condensed storytelling (mobile and tablet) -->
        <div class="mb-8 lg:hidden">
          <span class="inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-200">
            <span class="size-1.5 rounded-full bg-primary" />Your HighLevel data, reimagined
          </span>
          <p class="mt-3 text-[22px] font-bold leading-7 tracking-tight">Build apps from your <span class="text-primary">HighLevel data.</span></p>
          <div class="mt-5 hidden rounded-2xl bg-ink-100 p-2 md:block">
            <AuthIllustration class="border-0 bg-transparent p-2" />
          </div>
        </div>

        <h1 class="text-[28px] font-bold leading-9 tracking-[-0.01em]">{{ title }}</h1>
        <p class="mt-1.5 text-[15px] leading-6 text-muted-foreground">{{ subtitle }}</p>

        <form class="mt-8 grid gap-5" @submit.prevent="submit">
          <Alert v-if="error" variant="destructive" class="border-0 bg-danger-100"><AlertDescription class="text-foreground">{{ error }}</AlertDescription></Alert>
          <div class="grid gap-2">
            <Label for="email">Work email</Label>
            <Input id="email" v-model="email" type="email" placeholder="you@company.com" autocomplete="email" class="h-11 rounded-lg px-3.5 text-[15px] focus-visible:border-primary focus-visible:ring-primary/20" required />
          </div>
          <div class="grid gap-2">
            <Label for="password">Password</Label>
            <div class="relative">
              <Input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="At least 6 characters"
                :autocomplete="submitLabel === 'Sign in' ? 'current-password' : 'new-password'"
                minlength="6"
                class="h-11 rounded-lg px-3.5 pr-11 text-[15px] focus-visible:border-primary focus-visible:ring-primary/20"
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                <EyeOff v-if="showPassword" class="size-4" /><Eye v-else class="size-4" />
              </Button>
            </div>
          </div>
          <Button type="submit" class="mt-1 h-11 w-full rounded-lg text-[15px] font-semibold" :disabled="busy">{{ busy ? 'Please wait…' : submitLabel }}</Button>
        </form>

        <p class="mt-6 text-center text-sm text-muted-foreground">
          {{ altText }} <RouterLink :to="altLink" class="font-semibold text-primary underline-offset-4 hover:underline">{{ altLabel }}</RouterLink>
        </p>
      </div>
    </section>
  </main>
</template>
