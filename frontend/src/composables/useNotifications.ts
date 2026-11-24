import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { computed, ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { db } from '@/firebase'
import { api } from '@/lib/api'

/**
 * Build notifications (users/{uid}/notifications, written by the server when a build ends). One shared listener:
 * the panel lists them, the build history shows them as finished builds, and one that arrives while a page is open
 * is also shown as a toast.
 */

export type NotificationKind = 'build_done' | 'build_partial' | 'build_failed' | 'versions_ready'
export type AppNotification = {
  id: string; kind: NotificationKind; title: string; body: string; href: string; read: boolean; createdAt: number
}

const LIMIT = 50
const TOAST_MS = 10_000

const items = ref<AppNotification[]>([])
const toasts = ref<AppNotification[]>([])
let stop: (() => void) | null = null
let subscribedUid: string | null = null
let first = true

/** A notification new to this page: shown as a toast unless the customer is already looking at what it points to. */
export function shouldToast(n: AppNotification, currentPath: string): boolean {
  return !n.read && n.href !== currentPath
}

function toast(n: AppNotification) {
  toasts.value = [n, ...toasts.value.filter((t) => t.id !== n.id)].slice(0, 3)
  setTimeout(() => dismiss(n.id), TOAST_MS)
}

export function dismiss(id: string) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

function subscribe(uid: string | undefined) {
  if (uid === subscribedUid) return
  stop?.()
  stop = null
  subscribedUid = uid ?? null
  items.value = []
  toasts.value = []
  first = true
  if (!uid) return
  stop = onSnapshot(query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'), limit(LIMIT)), (s) => {
    items.value = s.docs.map((d) => ({
      id: d.id,
      kind: d.get('kind'),
      title: d.get('title') ?? '',
      body: d.get('body') ?? '',
      href: d.get('href') ?? '/',
      read: d.get('read') === true,
      createdAt: d.get('createdAt', { serverTimestamps: 'estimate' })?.toMillis() ?? Date.now(),
    }))
    // The first snapshot is the history; only notifications added after it are news.
    if (!first) {
      for (const c of s.docChanges()) {
        const n = items.value.find((i) => i.id === c.doc.id)
        if (c.type === 'added' && n && shouldToast(n, window.location.pathname)) toast(n)
      }
    }
    first = false
  }, () => { items.value = [] })
}

export function useNotifications() {
  const { user } = useAuth()
  watch(() => user.value?.uid, subscribe, { immediate: true })
  const unread = computed(() => items.value.filter((n) => !n.read).length)

  /** Marks notifications read (all unread ones without ids). Shown as read at once; the server confirms. */
  async function markRead(ids?: string[]) {
    const set = new Set(ids ?? items.value.filter((n) => !n.read).map((n) => n.id))
    if (!set.size) return
    items.value = items.value.map((n) => (set.has(n.id) ? { ...n, read: true } : n))
    await api('POST', '/notifications/read', ids ? { ids } : {}).catch(() => {})
  }

  return { items, unread, toasts, markRead, dismiss }
}
