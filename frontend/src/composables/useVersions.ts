import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { onUnmounted, ref } from 'vue'
import type { AppDetails } from '@/components/AppDetailsDialog.vue'
import { db } from '@/firebase'
import { api } from '@/lib/api'

/**
 * A variant build (docs/plans/build-variants.md): several versions of a new app are built in the background and two
 * are offered. The server keeps building if the page closes; this follows its progress from Firestore and saves the
 * version the customer picks. Nothing here knows how versions were chosen: the server never sends it.
 */

export const VARIANTS_ENABLED = import.meta.env.VITE_VARIANTS === 'on'

/** `credits`: what keeping this version costs (the customer pays only for the one they keep). */
export type Version = { snapshotId: string; title: string; summary: string; style: string; files: string[]; credits: number | null }

/** What a version is made of, for the customer: its components as words (src/components/AgendaList.vue → "Agenda list"). */
export function screensOf(files: string[]): string[] {
  return files
    .filter((f) => /^src\/components\/.+\.vue$/.test(f))
    .map((f) => f.split('/').pop()!.replace(/\.vue$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(' ')
      // Acronyms (KPI) stay in capitals; the first word is capitalised, the rest lower case.
      .map((w, i) => (w.length > 1 && w === w.toUpperCase() ? w : i ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' '))
}
/** building: still working · ready: versions to choose · open: built with problems, opens in the editor · failed: nothing to show */
export type VersionsState = 'loading' | 'building' | 'ready' | 'open' | 'failed' | 'saved'
/** The steps shown while building (no counts: the customer sees one app being made). */
export const STEPS = [
  { key: 'planning', label: 'Understanding your request' },
  { key: 'building', label: 'Building' },
  { key: 'checking', label: 'Checking' },
] as const

const BUILDING = new Set(['queued', 'planning', 'building', 'checking'])

/** What the customer sees for a variant build's status (`step` while building). Done means saved: handled by the project. */
export function screenFor(status: string): { state: VersionsState; step: string } | null {
  if (BUILDING.has(status)) return { state: 'building', step: status === 'queued' ? 'planning' : status }
  if (status === 'ready') return { state: 'ready', step: 'checking' }
  if (status === 'partial') return { state: 'open', step: 'checking' }
  if (status === 'done') return null
  return { state: 'failed', step: 'checking' } // error, declined, cancelled
}

/** Starts a variant build for a new app; returns the draft app's id. */
export async function startVersions(prompt: string): Promise<string> {
  const { projectId } = await api<{ projectId: string; generationId: string }>('POST', '/variants', { prompt })
  return projectId
}

export function useVersions(projectId: string) {
  const state = ref<VersionsState>('loading')
  const step = ref<string>('planning')
  const versions = ref<Version[]>([])
  const name = ref('')
  const prompt = ref('')
  const message = ref('')
  let generationId: string | null = null
  let stopGeneration: Unsubscribe | null = null

  function follow(gid: string) {
    if (gid === generationId) return
    generationId = gid
    stopGeneration?.()
    stopGeneration = onSnapshot(doc(db, 'projects', projectId, 'generations', gid), (s) => {
      const screen = screenFor(String(s.get('status') ?? 'queued'))
      message.value = s.get('error') ?? ''
      prompt.value = s.get('prompt') ?? prompt.value
      if (!screen) return
      if (screen.state === 'ready') {
        versions.value = ((s.get('finalists') as Version[] | undefined) ?? []).map(({ snapshotId, title, summary, style, files, credits }) => ({ snapshotId, title, summary, style: style ?? '', files: files ?? [], credits: typeof credits === 'number' ? credits : null }))
      }
      state.value = screen.state
      step.value = screen.step
    }, () => { state.value = 'failed'; message.value = 'Could not load your app.' })
  }

  const stopProject = onSnapshot(doc(db, 'projects', projectId), (s) => {
    if (!s.exists()) { state.value = 'failed'; message.value = 'This app no longer exists.'; return }
    name.value = s.get('name') ?? ''
    const draft = s.get('draft') as { generationId: string } | undefined
    if (draft) follow(draft.generationId)
    else if (state.value === 'loading' || state.value === 'ready') state.value = s.get('deletedAt') ? 'failed' : 'saved'
  }, () => { state.value = 'failed'; message.value = 'Could not load your app.' })

  onUnmounted(() => { stopProject(); stopGeneration?.() })

  async function stop() {
    if (generationId) await api('POST', `/projects/${projectId}/generations/${generationId}/cancel`)
  }

  /** Saves a version as the app (the other one stays in its History). */
  async function save(snapshotId: string, details: AppDetails) {
    await api('POST', `/projects/${projectId}/save`, { snapshotId, ...details })
  }

  return { state, step, versions, name, prompt, message, stop, save }
}
