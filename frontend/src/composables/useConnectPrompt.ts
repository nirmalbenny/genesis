import { ref } from 'vue'

// One shared "connect a sub-account first" prompt for the whole app (the dialog lives in TopBar).
const pendingApp = ref<string | null>(null)

export function useConnectPrompt() {
  return {
    pendingApp,
    /** Ask the user to connect before launching `appName`. */
    ask: (appName: string) => { pendingApp.value = appName },
    close: () => { pendingApp.value = null },
  }
}
