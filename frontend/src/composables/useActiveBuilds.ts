import { doc, onSnapshot } from 'firebase/firestore'
import { computed, ref, watch } from 'vue'
import { useApps, type App, type Draft } from '@/composables/useApps'
import { useAuth } from '@/composables/useAuth'
import { db } from '@/firebase'

/**
 * Builds in progress, shown in the top bar on every page: running builds (users/{uid}.activeBuilds, the server's
 * build slots) and variant builds whose versions wait to be chosen (drafts). A single build opens its workspace; a
 * variant build opens the page with its versions (docs/plans/build-variants.md).
 */

export type Running = { generationId: string; projectId: string; startedAt: number; exclusive: boolean }
export type ActiveBuild = { projectId: string; name: string; href: string; state: 'building' | 'ready' }

// The server drops a slot after 10 minutes (BUILD_SLOT_TTL_MS): an older one is a build that crashed.
const SLOT_TTL_MS = 10 * 60_000

/** What the top bar lists (pure): building first, then versions ready to choose; newest first within each. */
export function activeBuilds(running: Running[], drafts: Draft[], apps: App[], now: number): ActiveBuild[] {
  const live = running.filter((r) => now - r.startedAt < SLOT_TTL_MS)
  const draftIds = new Set(drafts.map((d) => d.id))
  const items: (ActiveBuild & { at: number })[] = [
    ...drafts.map((d) => {
      const slot = live.find((r) => r.projectId === d.id)
      return { projectId: d.id, name: d.name, href: `/choose/${d.id}`, state: slot ? 'building' as const : 'ready' as const, at: slot?.startedAt ?? d.updatedAt }
    }),
    ...live.filter((r) => !draftIds.has(r.projectId)).map((r) => ({
      projectId: r.projectId,
      name: apps.find((a) => a.id === r.projectId)?.name ?? 'Your app',
      href: `/p/${r.projectId}`,
      state: 'building' as const,
      at: r.startedAt,
    })),
  ]
  return items
    .sort((a, b) => (a.state === b.state ? b.at - a.at : a.state === 'building' ? -1 : 1))
    .map(({ at: _at, ...item }) => item)
}

// One shared listener on the user document, as useCredits keeps one.
const running = ref<Running[]>([])
let stop: (() => void) | null = null
let subscribedUid: string | null = null

function subscribe(uid: string | undefined) {
  if (uid === subscribedUid) return
  stop?.()
  stop = null
  subscribedUid = uid ?? null
  running.value = []
  if (!uid) return
  stop = onSnapshot(doc(db, 'users', uid), (s) => {
    const slots = (s.get('activeBuilds') ?? {}) as Record<string, { projectId: string; startedAt: number; exclusive?: boolean }>
    running.value = Object.entries(slots).map(([generationId, v]) => ({
      generationId, projectId: v.projectId, startedAt: v.startedAt, exclusive: v.exclusive === true,
    }))
  })
}

export function useActiveBuilds() {
  const { user } = useAuth()
  watch(() => user.value?.uid, subscribe, { immediate: true })
  const { apps, drafts } = useApps()
  // Re-evaluated when the lists change; a slot past its TTL drops out at the next change.
  const items = computed(() => activeBuilds(running.value, drafts.value, apps.value, Date.now()))
  const building = computed(() => items.value.filter((i) => i.state === 'building').length)
  return { items, building }
}
