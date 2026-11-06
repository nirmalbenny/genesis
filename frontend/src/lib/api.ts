import { auth, FUNCTIONS_BASE } from '@/firebase'

export async function authHeader(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Not signed in')
  return { Authorization: `Bearer ${token}` }
}

/** Authenticated JSON call to the `api` function. Throws Error(message) using the server's error body. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${FUNCTIONS_BASE}/api${path}`, {
      method,
      headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Network error. Check your connection and try again.')
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`)
  return json as T
}
