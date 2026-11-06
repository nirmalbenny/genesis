import { ref } from 'vue'
import { FUNCTIONS_BASE } from '@/firebase'
import { authHeader } from '@/lib/api'
import { readSse } from '@/lib/sse'

type Handlers = {
  onFileStart: (path: string) => void
  onToken: (path: string, text: string) => void
  /** Called once after every generation, successful or not, so the UI can re-sync with the server. */
  onFinished: () => Promise<void>
}

type ErrorData = { code: string; message: string; partial: boolean }

export function useGeneration(h: Handlers) {
  const streaming = ref(false)
  const error = ref('')
  const plan = ref('')
  /** Set when the server declines the request (off-topic or harmful). Shown as a notice, never stored. */
  const declined = ref('')
  /** Files in the current build, in order. `done` flips on file_end. */
  const building = ref<{ path: string; done: boolean }[]>([])
  let abort: AbortController | null = null

  async function start(projectId: string, prompt: string) {
    streaming.value = true
    error.value = ''
    declined.value = ''
    building.value = []
    plan.value = ''
    abort = new AbortController()
    let finished = false

    try {
      const res = await fetch(`${FUNCTIONS_BASE}/generate`, {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, prompt }),
        signal: abort.signal,
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `Generation failed (${res.status})`)
      }
      await readSse(res, ({ event, data }) => {
        const d = data as Record<string, unknown>
        if (event === 'token') {
          const path = d.path as string | null
          if (path) h.onToken(path, d.text as string)
          else plan.value += d.text as string
        } else if (event === 'start') {
          // generation id is not needed client-side
        } else if (event === 'file_start') {
          building.value.push({ path: d.path as string, done: false })
          h.onFileStart(d.path as string)
        } else if (event === 'file_end') {
          const f = building.value.find((b) => b.path === d.path)
          if (f) f.done = true
        } else if (event === 'done') {
          finished = true
        } else if (event === 'error') {
          finished = true
          const e = d as unknown as ErrorData
          if (e.code === 'declined') declined.value = e.message
          else error.value = e.partial ? `${e.message} Completed files were kept.` : e.message
        }
      })
      if (!finished) error.value = 'Connection lost before generation finished. Completed files were kept.'
    } catch (e) {
      if (!finished) {
        error.value = (e as Error).name === 'AbortError'
          ? 'Generation interrupted. Completed files were kept.'
          : `${(e as Error).message}. Completed files were kept if any.`
      }
    } finally {
      streaming.value = false
      abort = null
      // After a dropped connection the server may still be saving partial results.
      if (!finished) await new Promise((r) => setTimeout(r, 2000))
      await h.onFinished()
    }
  }

  return { streaming, error, plan, declined, building, start, abortLocal: () => abort?.abort() }
}
