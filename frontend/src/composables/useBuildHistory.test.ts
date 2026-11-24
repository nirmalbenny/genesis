import { describe, expect, it, vi } from 'vitest'

vi.mock('@/firebase', () => ({ db: {}, auth: {}, FUNCTIONS_BASE: '' }))
vi.mock('@/composables/useAuth', () => ({ useAuth: vi.fn() }))
const { OUTCOMES, opens } = await import('./useBuildHistory')

const record = (outcome: string, href: string) => ({
  id: 'g', projectId: 'p', mode: 'variants' as const, appName: 'App', request: 'r', outcome: outcome as never, href, credits: 10, versions: [], endedAt: 0,
})

describe('build history rows', () => {
  it('every finished outcome has a label in words', () => {
    expect(Object.values(OUTCOMES).map((o) => o.label)).toEqual(['Updated', 'Saved', 'Needs a fix', 'Failed', 'Stopped', 'Expired'])
  })

  it('a row opens its app, unless the build left none', () => {
    expect(opens(record('saved', '/p/p'))).toBe(true)
    expect(opens(record('expired', '/'))).toBe(false)
  })
})
