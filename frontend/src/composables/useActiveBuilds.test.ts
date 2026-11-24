import { describe, expect, it, vi } from 'vitest'

vi.mock('@/firebase', () => ({ db: {}, auth: {}, FUNCTIONS_BASE: '' }))
vi.mock('@/composables/useApps', () => ({ useApps: vi.fn() }))
vi.mock('@/composables/useAuth', () => ({ useAuth: vi.fn() }))
const { activeBuilds } = await import('./useActiveBuilds')

const app = (id: string, name: string) => ({ id, name, description: '', category: 'other' as const, icon: null, updatedAt: 0, pinnedAt: null, prebuilt: false })
const now = 1_000_000

describe('active builds in the top bar', () => {
  it('a single build opens its workspace; a variant build opens its versions', () => {
    const items = activeBuilds(
      [
        { generationId: 'g1', projectId: 'p1', startedAt: now - 5_000, exclusive: false },
        { generationId: 'g2', projectId: 'd1', startedAt: now - 1_000, exclusive: true },
      ],
      [{ id: 'd1', name: 'Contact dashboard', updatedAt: now - 1_000 }, { id: 'd2', name: 'Inbox', updatedAt: now - 60_000 }],
      [app('p1', 'Pipeline')],
      now,
    )
    expect(items).toEqual([
      { projectId: 'd1', name: 'Contact dashboard', href: '/choose/d1', state: 'building' },
      { projectId: 'p1', name: 'Pipeline', href: '/p/p1', state: 'building' },
      { projectId: 'd2', name: 'Inbox', href: '/choose/d2', state: 'ready' },
    ])
  })

  it('drops slots past the server TTL (a crashed build) and lists nothing when idle', () => {
    expect(activeBuilds([{ generationId: 'g', projectId: 'p', startedAt: now - 11 * 60_000, exclusive: false }], [], [], now)).toEqual([])
    expect(activeBuilds([], [], [], now)).toEqual([])
  })
})
