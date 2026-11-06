import { doc, onSnapshot } from 'firebase/firestore'
import { ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { db, FUNCTIONS_BASE } from '@/firebase'
import { api, authHeader } from '@/lib/api'

export type HlInfo = {
  locationId: string
  locationName: string
  location?: { email: string | null; phone: string | null; timezone: string | null; owner: string | null }
}

// One shared store: every screen and the top-bar pill read the same connection state.
const hl = ref<HlInfo | null>(null)
const loaded = ref(false)
const busy = ref<'connecting' | 'disconnecting' | null>(null)
const error = ref('')

let stop: (() => void) | null = null
let subscribedUid: string | null = null

function subscribe(uid: string | undefined) {
  if (uid === subscribedUid) return
  stop?.()
  stop = null
  subscribedUid = uid ?? null
  hl.value = null
  loaded.value = false
  if (!uid) return
  stop = onSnapshot(doc(db, 'users', uid), (s) => {
    hl.value = s.get('hl') ?? null
    loaded.value = true
  })
}

async function connect() {
  busy.value = 'connecting'
  error.value = ''
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/hlAuthStart`, { method: 'POST', headers: await authHeader() })
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error?.message ?? 'Could not start HighLevel connection')
    window.location.href = json.url // leaves the app; busy stays set
  } catch (e) {
    error.value = (e as Error).message
    busy.value = null
  }
}

async function disconnect(): Promise<boolean> {
  busy.value = 'disconnecting'
  error.value = ''
  try {
    await api('POST', '/hl/disconnect')
    return true
  } catch (e) {
    error.value = (e as Error).message
    return false
  } finally {
    busy.value = null
  }
}

/** Live HighLevel connection state for the signed-in user, plus connect/disconnect actions. */
export function useHl() {
  const { user } = useAuth()
  watch(() => user.value?.uid, subscribe, { immediate: true })
  return { hl, loaded, busy, error, connect, disconnect }
}
