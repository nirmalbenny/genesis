import { collection, limit, onSnapshot, orderBy, query, where, type QueryDocumentSnapshot } from 'firebase/firestore'
import { onUnmounted, ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { db } from '@/firebase'

/**
 * The build history (users/{uid}/builds, one record per build, kept current by the server): variant builds waiting
 * for the customer to choose, and the builds that finished, newest first, a page at a time.
 */

export type BuildOutcome = 'updated' | 'partial' | 'failed' | 'stopped' | 'ready' | 'saved' | 'expired'
export type BuildRecord = {
  id: string; projectId: string; mode: 'single' | 'variants'; appName: string; request: string
  outcome: BuildOutcome; href: string; credits: number | null; versions: string[]; endedAt: number
}

/** How each outcome reads on the page (text, not just a color). */
export const OUTCOMES: Record<Exclude<BuildOutcome, 'ready'>, { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  updated: { label: 'Updated', tone: 'ok' },
  saved: { label: 'Saved', tone: 'ok' },
  partial: { label: 'Needs a fix', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },
}

const PAGE = 20

const toRecord = (d: QueryDocumentSnapshot): BuildRecord => ({
  id: d.id,
  projectId: d.get('projectId') ?? '',
  mode: d.get('mode') === 'variants' ? 'variants' : 'single',
  appName: d.get('appName') ?? 'Your app',
  request: d.get('request') ?? '',
  outcome: d.get('outcome'),
  href: d.get('href') ?? '/',
  credits: typeof d.get('credits') === 'number' ? d.get('credits') : null,
  versions: d.get('versions') ?? [],
  endedAt: d.get('endedAt', { serverTimestamps: 'estimate' })?.toMillis() ?? Date.now(),
})

/** A row leads somewhere only when its app still exists (failed, stopped and expired variant builds have none). */
export const opens = (r: BuildRecord): boolean => r.href !== '/'

export function useBuildHistory() {
  const { user } = useAuth()
  const waiting = ref<BuildRecord[]>([])
  const recent = ref<BuildRecord[]>([])
  const size = ref(PAGE)
  const hasMore = ref(false)
  const loaded = ref(false)
  const stops: (() => void)[] = []

  function subscribe() {
    stops.splice(0).forEach((s) => s())
    const uid = user.value?.uid
    if (!uid) return
    const builds = collection(db, 'users', uid, 'builds')
    // Few at a time, so sorted here (no index needed).
    stops.push(onSnapshot(query(builds, where('outcome', '==', 'ready')), (s) => {
      waiting.value = s.docs.map(toRecord).sort((a, b) => b.endedAt - a.endedAt)
    }))
    stops.push(onSnapshot(query(builds, orderBy('endedAt', 'desc'), limit(size.value)), (s) => {
      // Waiting builds have their own section; the rest is the history.
      recent.value = s.docs.map(toRecord).filter((r) => r.outcome !== 'ready')
      hasMore.value = s.size === size.value
      loaded.value = true
    }, () => { loaded.value = true }))
  }

  watch([() => user.value?.uid, size], subscribe, { immediate: true })
  onUnmounted(() => stops.forEach((s) => s()))

  const loadMore = () => { size.value += PAGE }
  return { waiting, recent, hasMore, loaded, loadMore }
}
