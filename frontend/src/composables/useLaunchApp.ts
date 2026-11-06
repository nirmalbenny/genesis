import { useConnectPrompt } from '@/composables/useConnectPrompt'
import { useHl } from '@/composables/useHl'
import { api } from '@/lib/api'

/** Launching and pinning apps, shared by app cards and the sidebar. */
export function useLaunchApp() {
  const { hl } = useHl()
  const { ask } = useConnectPrompt()

  // Apps run on live HighLevel data: without a connected sub-account, explain instead of opening a dead tab.
  function launch(app: { id: string; name: string }) {
    if (!hl.value) return ask(app.name)
    window.open(`/run/${app.id}`, '_blank', 'noopener')
  }

  const setPinned = (id: string, pinned: boolean) => api('POST', `/projects/${id}/pin`, { pinned })

  return { launch, setPinned }
}
