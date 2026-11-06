import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { onUnmounted, ref } from 'vue'
import type { CatalogApp } from '@/components/AppCard.vue'
import { useAuth } from '@/composables/useAuth'
import { db } from '@/firebase'
import { api } from '@/lib/api'
import type { Category } from '@/lib/catalog'

export type App = CatalogApp & { category: Category }

let bootstrapped = false

/** Live list of the user's apps (ready-made and their own). Seeds ready-made apps once per session. */
export function useApps() {
  const { user } = useAuth()
  const apps = ref<App[]>([])
  const loaded = ref(false)
  const error = ref('')

  if (!bootstrapped) {
    bootstrapped = true
    // The server makes this a no-op once the user has the current set of ready-made apps.
    api('POST', '/bootstrap').catch(() => {
      bootstrapped = false
      error.value = 'Could not load the ready-made apps.'
    })
  }

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
      loaded.value = true
    },
    () => { error.value = 'Could not load apps.' },
  )
  onUnmounted(stop)

  return { apps, loaded, error }
}
