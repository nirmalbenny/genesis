import { doc, onSnapshot } from 'firebase/firestore'
import { computed, ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { db } from '@/firebase'

export type Credits = { balance: number; reserved: number; granted: number; used: number }

/** Credits granted once the email is verified (keep in sync with functions/src/credits.ts). */
export const SIGNUP_CREDITS = 2500

/** Below this many available credits the top bar warns that the balance is running low. */
export const LOW_CREDITS = 300

// One shared store, kept live from users/{uid}.credits (written only by Cloud Functions).
const credits = ref<Credits | null>(null)
let stop: (() => void) | null = null
let subscribedUid: string | null = null

function subscribe(uid: string | undefined) {
  if (uid === subscribedUid) return
  stop?.()
  stop = null
  subscribedUid = uid ?? null
  credits.value = null
  if (!uid) return
  stop = onSnapshot(doc(db, 'users', uid), (s) => {
    const c = s.get('credits')
    credits.value = c ? { balance: c.balance ?? 0, reserved: c.reserved ?? 0, granted: c.granted ?? 0, used: c.used ?? 0 } : null
  })
}

export function useCredits() {
  const { user } = useAuth()
  watch(() => user.value?.uid, subscribe, { immediate: true })
  /** Credits that can start a new build (balance minus holds on builds in progress). */
  const available = computed(() => (credits.value ? Math.max(0, credits.value.balance - credits.value.reserved) : 0))
  return { credits, available }
}
