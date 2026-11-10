<script setup lang="ts">
import { MailCheck } from '@lucide/vue'
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/composables/useAuth'
import { SIGNUP_CREDITS } from '@/composables/useCredits'

// Signed in but not verified: the only page available until the email link is clicked.
const router = useRouter()
const { user, emailVerified, resendVerification, refreshVerification, signOut } = useAuth()
const state = ref<'idle' | 'checking' | 'not-yet' | 'sending' | 'sent'>('idle')
const error = ref('')

// useAuth also re-checks on tab focus; whichever notices first lets the user in.
watch(emailVerified, (v) => v && router.replace('/'), { immediate: true })

async function check() {
  state.value = 'checking'
  error.value = ''
  try {
    state.value = (await refreshVerification()) ? 'idle' : 'not-yet'
  } catch (e) {
    state.value = 'idle'
    error.value = (e as Error).message
  }
}

async function resend() {
  state.value = 'sending'
  error.value = ''
  try {
    await resendVerification()
    state.value = 'sent'
  } catch (e) {
    state.value = 'idle'
    error.value = (e as { code?: string }).code === 'auth/too-many-requests'
      ? 'Too many emails sent. Wait a few minutes, then try again.'
      : (e as Error).message
  }
}

async function switchAccount() {
  await signOut()
  await router.replace('/signin')
}
</script>

<template>
  <main class="flex min-h-screen flex-col bg-background px-6 py-8">
    <AppLogo />
    <section class="mx-auto my-auto w-full max-w-[420px] rounded-xl border border-border bg-card p-8 text-center" aria-labelledby="verify-heading">
      <span class="mx-auto grid size-12 place-items-center rounded-xl bg-secondary text-primary"><MailCheck class="size-6" /></span>
      <h1 id="verify-heading" class="mt-5 text-[22px] font-bold leading-7 tracking-tight">Verify your email</h1>
      <p class="mt-2 text-[15px] leading-6 text-muted-foreground">
        We sent a link to <span class="font-medium text-foreground">{{ user?.email }}</span>.
        Click it to start using Genesis and unlock {{ SIGNUP_CREDITS.toLocaleString() }} free AI credits.
      </p>
      <p v-if="state === 'not-yet'" class="mt-3 text-sm text-ink-200">We can't see the verification yet. Check your inbox and spam folder.</p>
      <p v-if="state === 'sent'" class="mt-3 text-sm text-ink-200">A new link is on its way.</p>
      <p v-if="error" class="mt-3 text-sm text-destructive">{{ error }}</p>

      <div class="mt-6 grid gap-2">
        <Button class="h-11 rounded-lg text-[15px] font-semibold" :disabled="state === 'checking'" @click="check">
          {{ state === 'checking' ? 'Checking…' : "I've verified" }}
        </Button>
        <Button variant="outline" class="h-11 rounded-lg text-[15px]" :disabled="state === 'sending'" @click="resend">
          {{ state === 'sending' ? 'Sending…' : 'Resend email' }}
        </Button>
      </div>
      <button type="button" class="mt-5 text-sm font-semibold text-primary underline-offset-4 hover:underline" @click="switchAccount">
        Use a different account
      </button>
    </section>
  </main>
</template>
