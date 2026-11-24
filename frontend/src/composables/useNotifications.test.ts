import { describe, expect, it, vi } from 'vitest'

vi.mock('@/firebase', () => ({ db: {}, auth: {}, FUNCTIONS_BASE: '' }))
vi.mock('@/composables/useAuth', () => ({ useAuth: vi.fn() }))
const { shouldToast } = await import('./useNotifications')

const n = { id: 'n', kind: 'versions_ready' as const, title: 'Ready', body: '', href: '/choose/p1', read: false, createdAt: 0 }

describe('build notification toasts', () => {
  it('shows a new notification, unless the customer is already on its page or has read it', () => {
    expect(shouldToast(n, '/')).toBe(true)
    expect(shouldToast(n, '/choose/p1')).toBe(false)
    expect(shouldToast({ ...n, read: true }, '/')).toBe(false)
  })
})
