import { auth, FUNCTIONS_BASE } from '@/firebase'

export async function authHeader(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Not signed in')
  return { Authorization: `Bearer ${token}` }
}

/** Authenticated JSON call to the `api` function. Throws Error(message) using the server's error body (plus status, retryAfter). */
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
  if (!res.ok) {
    // `retryAfter` (seconds) is set on 429s, so callers can wait and retry once.
    throw Object.assign(new Error(json?.error?.message ?? `Request failed (${res.status})`), {
      status: res.status, retryAfter: json?.error?.retryAfter as number | undefined,
    })
  }
  return json as T
}
