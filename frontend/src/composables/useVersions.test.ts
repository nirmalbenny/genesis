import { describe, expect, it, vi } from 'vitest'

vi.mock('@/firebase', () => ({ db: {}, auth: {}, FUNCTIONS_BASE: '' }))
const { screenFor, screensOf, STEPS } = await import('./useVersions')

describe('variant build screens', () => {
  it('shows building steps without counts, starting with understanding the request', () => {
    expect(screenFor('queued')).toEqual({ state: 'building', step: 'planning' })
    for (const s of ['planning', 'building', 'checking']) expect(screenFor(s)).toEqual({ state: 'building', step: s })
    expect(STEPS.map((s) => s.label).join(' ')).not.toMatch(/\d/)
  })

  it('offers the versions when ready, opens a build with problems, and reports everything else', () => {
    expect(screenFor('ready')?.state).toBe('ready')
    expect(screenFor('partial')?.state).toBe('open')
    for (const s of ['error', 'declined', 'cancelled']) expect(screenFor(s)?.state).toBe('failed')
    expect(screenFor('done')).toBeNull() // saved: the project's draft flag is gone
  })
})

describe('what a version is made of', () => {
  it('names its components in words, leaving out the app shell and helpers', () => {
    expect(screensOf(['src/main.js', 'src/App.vue', 'src/utils.js', 'src/components/AgendaList.vue', 'src/components/ContactSearchBar.vue', 'src/components/KPIRow.vue']))
      .toEqual(['Agenda list', 'Contact search bar', 'KPI row'])
  })
})
