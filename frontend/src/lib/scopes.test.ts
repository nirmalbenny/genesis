import { describe, expect, it } from 'vitest'
import { describeMissing, missingAccess, RESOURCES } from './scopes'

const ALL = RESOURCES.flatMap((r) => r.scopes)

describe('missingAccess', () => {
  it('reads the registry: every resource apps can use, with its scopes', () => {
    expect(RESOURCES.map((r) => r.id)).toEqual(expect.arrayContaining(['calendars', 'contacts', 'conversations', 'locations']))
    expect(ALL).toContain('contacts.readonly')
  })

  it('reports nothing when every scope is granted, or when the grant is unknown', () => {
    expect(missingAccess(ALL)).toEqual([])
    expect(missingAccess(undefined)).toEqual([])
    expect(missingAccess(null)).toEqual([])
  })

  it('names a resource the connection cannot read, and one it can only read', () => {
    const readOnly = ALL.filter((s) => !s.endsWith('.write') && !s.startsWith('calendars'))
    const missing = missingAccess(readOnly)
    expect(missing).toEqual(expect.arrayContaining([
      { label: 'Calendars', changesOnly: false },
      { label: 'Contacts', changesOnly: true },
      { label: 'Conversations', changesOnly: true },
    ]))
    // Any other resource (added later) has its read scopes here, so only its changes are missing.
    expect(missing.filter((m) => m.label !== 'Calendars').every((m) => m.changesOnly)).toBe(true)
  })

  it('skips internal resources, and a new resource shows up for connections made before it', () => {
    const resources = [
      { id: 'locations', internal: true, scopes: ['locations.readonly'] },
      { id: 'opportunities', label: 'Opportunities', scopes: ['opportunities.readonly', 'opportunities.write'] },
    ]
    expect(missingAccess([], resources)).toEqual([{ label: 'Opportunities', changesOnly: false }])
  })
})

describe('describeMissing', () => {
  it('reads as a sentence', () => {
    expect(describeMissing([])).toBe('')
    expect(describeMissing([{ label: 'Opportunities', changesOnly: false }])).toBe('Opportunities')
    expect(describeMissing([
      { label: 'Opportunities', changesOnly: false },
      { label: 'Contacts', changesOnly: true },
      { label: 'Calendars', changesOnly: true },
    ])).toBe('Opportunities and changes to Contacts and Calendars')
    expect(describeMissing([{ label: 'Contacts', changesOnly: true }, { label: 'Calendars', changesOnly: true }])).toBe('changes to Contacts and Calendars')
    expect(describeMissing([{ label: 'Tasks', changesOnly: false }, { label: 'Opportunities', changesOnly: false }])).toBe('Tasks and Opportunities')
  })
})
