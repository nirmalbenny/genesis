import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { onUnmounted, reactive, ref } from 'vue'
import { db } from '@/firebase'
import { api } from '@/lib/api'
import type { Category } from '@/lib/catalog'

export type Message = { id: string; role: 'user' | 'assistant'; content: string }

export function useProject(projectId: string) {
  const name = ref('')
  const kind = ref<'user' | 'prebuilt'>('user')
  const description = ref('')
  const category = ref<Category>('other')
  const files = reactive<Record<string, string>>({})
  const messages = ref<Message[]>([])
  const loadError = ref('')

  /** Replaces local files with the server's copy (drops stale or half-streamed entries). */
  async function loadFiles() {
    const { files: list } = await api<{ files: { path: string; content: string }[] }>(
      'GET', `/projects/${projectId}/files?content=true`,
    )
    for (const k of Object.keys(files)) delete files[k]
    for (const f of list) files[f.path] = f.content
  }

  async function init() {
    try {
      const p = await api<{ name: string; description?: string; category?: Category; kind?: 'user' | 'prebuilt' }>('GET', `/projects/${projectId}`)
      name.value = p.name
      description.value = p.description ?? ''
      category.value = p.category ?? 'other'
      kind.value = p.kind ?? 'user'
      await loadFiles()
    } catch (e) {
      loadError.value = (e as Error).message
    }
  }

  const stop = onSnapshot(
    query(collection(db, 'projects', projectId, 'messages'), orderBy('createdAt', 'asc')),
    (s) => {
      messages.value = s.docs.map((d) => ({ id: d.id, role: d.get('role'), content: d.get('content') }))
    },
    () => { loadError.value = 'Could not load chat history.' },
  )
  onUnmounted(stop)

  return { name, kind, description, category, files, messages, loadError, loadFiles, init }
}
