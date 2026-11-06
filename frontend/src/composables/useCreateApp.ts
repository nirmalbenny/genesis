import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AppDetails } from '@/components/AppDetailsDialog.vue'
import { api } from '@/lib/api'
import { guessCategory, suggestName } from '@/lib/catalog'

/** Create flow: the details dialog opens with suggestions; the app is created only when the user confirms. */
export function useCreateApp() {
  const router = useRouter()
  const initial = ref<AppDetails | null>(null)
  const prompt = ref('')
  const busy = ref(false)
  const error = ref('')

  /** From the chat box: suggest details from the prompt, then build right after creating. */
  function fromPrompt(text: string) {
    prompt.value = text
    error.value = ''
    initial.value = { name: suggestName(text), description: text.slice(0, 500), category: guessCategory(text) }
  }

  /** "New app": an empty app the user describes later in chat. */
  function blank() {
    prompt.value = ''
    error.value = ''
    initial.value = { name: '', description: '', category: 'other' }
  }

  async function create(details: AppDetails) {
    busy.value = true
    error.value = ''
    try {
      const { id } = await api<{ id: string }>('POST', '/projects', details)
      const first = prompt.value
      initial.value = null
      await router.push({ path: `/p/${id}`, query: first ? { prompt: first, autostart: '1' } : {} })
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      busy.value = false
    }
  }

  return { initial, prompt, busy, error, fromPrompt, blank, create }
}
