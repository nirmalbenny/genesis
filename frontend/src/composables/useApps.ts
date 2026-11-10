import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { computed, onUnmounted, ref, type Ref } from 'vue'
import type { CatalogApp } from '@/components/AppCard.vue'
import { useAuth } from '@/composables/useAuth'
import { db } from '@/firebase'
import { api } from '@/lib/api'
import type { Category } from '@/lib/catalog'

export type App = CatalogApp & { category: Category }

// Account setup (ready-made apps + signup credits) runs once per signed-in user, shared by every component.
let setupUid: string | null = null
const setupRunning = ref(false)
/** Whether the user had no ready-made apps when the list first loaded: a first sign-in, still being set up. */
const firstSetup = ref<boolean | null>(null)

function runSetup(uid: string, error: Ref<string>) {
  if (setupUid === uid) return
  setupUid = uid
  firstSetup.value = null
  setupRunning.value = true
  // The server makes this a no-op once the user has the current ready-made apps and the signup credits.
  api('POST', '/bootstrap')
    .catch(() => {
      setupUid = null // the next page that needs the apps tries again
      error.value = 'Could not load the ready-made apps.'
    })
    .finally(() => (setupRunning.value = false))
}

/** Live list of the user's apps (ready-made and their own). Seeds ready-made apps once per session. */
export function useApps() {
  const { user } = useAuth()
  const apps = ref<App[]>([])
  const loaded = ref(false)
  const error = ref('')
  /** True while a first-time setup is adding the ready-made apps; show a placeholder, not a partial list. */
  const settingUp = computed(() => setupRunning.value && firstSetup.value === true)

  runSetup(user.value!.uid, error)

  const stop = onSnapshot(
    query(collection(db, 'projects'), where('ownerId', '==', user.value!.uid), where('deletedAt', '==', null)),
    (s) => {
      apps.value = s.docs.map((d) => ({
        id: d.id,
        name: d.get('name'),
        description: d.get('description') ?? '',
        category: d.get('category') ?? 'other',
        icon: d.get('icon') ?? null,
        updatedAt: d.get('updatedAt')?.toMillis() ?? 0,
        // 'estimate' gives a just-pinned app a local time while the server timestamp is pending.
        pinnedAt: d.get('pinnedAt', { serverTimestamps: 'estimate' })?.toMillis() ?? null,
        prebuilt: d.get('kind') === 'prebuilt',
      }))
      firstSetup.value ??= !apps.value.some((a) => a.prebuilt)
      loaded.value = true
    },
    () => { error.value = 'Could not load apps.' },
  )
  onUnmounted(stop)

  return { apps, loaded, error, settingUp }
}
