import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, toDisplayString } from 'vue'
// @ts-expect-error untyped: plain JS, injected as-is into the sandbox
import * as hl from './hl.js'

type Call = { url: URL; init: RequestInit }
let calls: Call[] = []

/** Stubs fetch with the given responses, in order: [status, body]. */
function respond(...responses: [number, unknown][]) {
  calls = []
  const queue = [...responses]
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    calls.push({ url: new URL(url), init })
    const [status, body] = queue.shift() ?? [500, { error: { code: 'no_stub', message: 'no response stubbed' } }]
    return new Response(JSON.stringify(body), { status })
  }))
}

/** Lets pending promises (fetch → json → state) settle. */
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

const contacts = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${from + i}` }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('hlGet / hlSend', () => {
  it('sends the preview token and drops empty params', async () => {
    respond([200, { ok: 1 }])
    expect(await hl.hlGet('/contacts/', { limit: 5, query: '', x: null })).toEqual({ ok: 1 })
    expect(calls[0].url.href).toBe('https://proxy.test/hlProxy/contacts/?limit=5')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
  })

  it('retries a 429 exactly once, after retryAfter', async () => {
    respond([429, { error: { code: 'rate_limited', message: 'slow down', retryAfter: 2 } }], [200, { ok: 1 }])
    const p = hl.hlGet('/calendars/')
    await flush()
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await p).toEqual({ ok: 1 })
    expect(calls).toHaveLength(2)
  })

  it('gives up after the second 429', async () => {
    const limited: [number, unknown] = [429, { error: { code: 'rate_limited', message: 'slow down', retryAfter: 1 } }]
    respond(limited, limited, [200, {}])
    const p = hl.hlSend('POST', '/contacts/', { firstName: 'A' }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toMatchObject({ code: 'rate_limited', message: 'slow down', status: 429 })
    expect(calls).toHaveLength(2)
  })

  it("doesn't wait out a long retryAfter", async () => {
    respond([429, { error: { code: 'rate_limited', message: 'daily limit', retryAfter: 3600 } }])
    await expect(hl.hlGet('/calendars/')).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 3600 })
    expect(calls).toHaveLength(1)
  })

  it("returns the proxy's error code and message", async () => {
    respond([403, { error: { code: 'hl_scope_missing', message: 'Reconnect HighLevel.' } }])
    await expect(hl.addTags('c1', ['vip'])).rejects.toMatchObject({ code: 'hl_scope_missing', message: 'Reconnect HighLevel.', status: 403 })
    expect(calls[0].init).toMatchObject({ method: 'POST', body: '{"tags":["vip"]}' })
  })

  it('reports a network failure as an error with a message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(hl.hlGet('/calendars/')).rejects.toMatchObject({ code: 'network_error' })
  })
})

describe('usePager', () => {
  it('pages contacts with the cursor and stops on a short page even when nextPageUrl is set', async () => {
    respond(
      [200, { contacts: contacts(0, 2), meta: { total: 3, startAfterId: 'c1', startAfter: 111, nextPageUrl: 'x' } }],
      [200, { contacts: contacts(2, 1), meta: { total: 3, startAfterId: 'c2', startAfter: 222, nextPageUrl: 'x' } }],
    )
    const p = hl.usePager('contacts', { limit: 2 })
    await flush()
    expect(p.items.value.map((c: { id: string }) => c.id)).toEqual(['c0', 'c1'])
    expect(p.total.value).toBe(3)
    expect(p.hasMore.value).toBe(true)
    await p.loadMore()
    expect(calls[1].url.searchParams.get('startAfterId')).toBe('c1')
    expect(calls[1].url.searchParams.get('startAfter')).toBe('111')
    expect(p.items.value).toHaveLength(3)
    expect(p.hasMore.value).toBe(false)
  })

  it('skips ids already shown', async () => {
    respond(
      [200, { contacts: contacts(0, 2), meta: { startAfterId: 'c1', startAfter: 1 } }],
      [200, { contacts: contacts(1, 2), meta: { startAfterId: 'c2', startAfter: 2 } }],
    )
    const p = hl.usePager('contacts', { limit: 2 })
    await flush()
    await p.loadMore()
    expect(p.items.value.map((c: { id: string }) => c.id)).toEqual(['c0', 'c1', 'c2'])
  })

  it('only searches with 3+ characters', async () => {
    respond([200, { contacts: [], meta: {} }])
    hl.usePager('contacts', { query: 'ab' })
    await flush()
    expect(calls[0].url.searchParams.has('query')).toBe(false)
  })

  it('resets when the options change and drops the superseded response', async () => {
    const query = ref('ann')
    let release!: (r: Response) => void
    calls = []
    vi.stubGlobal('fetch', vi.fn((url: URL) => {
      calls.push({ url: new URL(url), init: {} })
      if (calls.length === 1) return new Promise<Response>((r) => { release = r }) // the old search, still in flight
      return Promise.resolve(new Response(JSON.stringify({ contacts: [{ id: 'bob' }], meta: { total: 1 } })))
    }))
    const p = hl.usePager('contacts', () => ({ query: query.value }))
    query.value = 'bob'
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    expect(calls[1].url.searchParams.get('query')).toBe('bob')
    release(new Response(JSON.stringify({ contacts: [{ id: 'ann' }], meta: { total: 1 } })))
    await flush()
    expect(p.items.value.map((c: { id: string }) => c.id)).toEqual(['bob'])
  })

  it('pages conversations by the last sort value', async () => {
    respond(
      [200, { conversations: [{ id: 'a', sort: [30] }, { id: 'b', sort: [20] }], total: 3 }],
      [200, { conversations: [{ id: 'c', sort: [10] }], total: 3 }],
    )
    const p = hl.usePager('conversations', { limit: 2, status: 'unread' })
    await flush()
    await p.loadMore()
    expect(calls[1].url.searchParams.get('startAfterDate')).toBe('20')
    expect(calls[1].url.searchParams.get('status')).toBe('unread')
    expect(p.hasMore.value).toBe(false)
  })

  it('searches conversations by name from 2 characters', async () => {
    respond([200, { conversations: [], total: 0 }], [200, { conversations: [], total: 0 }])
    hl.usePager('conversations', { query: 'n' })
    hl.usePager('conversations', { query: ' Nis ' })
    await flush()
    expect(calls[0].url.searchParams.has('query')).toBe(false)
    expect(calls[1].url.searchParams.get('query')).toBe('Nis')
  })

  it('pages messages by lastMessageId while nextPage, and waits for a conversation', async () => {
    respond(
      [200, { messages: { messages: [{ id: 'm2' }], lastMessageId: 'm2', nextPage: true } }],
      [200, { messages: { messages: [{ id: 'm1' }], lastMessageId: 'm1', nextPage: false } }],
    )
    const id = ref('')
    const p = hl.usePager('messages', () => ({ conversationId: id.value }))
    await flush()
    expect(calls).toHaveLength(0)
    id.value = 'conv 1'
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    await p.loadMore()
    expect(calls[0].url.pathname).toBe('/hlProxy/conversations/conv%201/messages')
    expect(calls[1].url.searchParams.get('lastMessageId')).toBe('m2')
    expect(p.hasMore.value).toBe(false)
  })

  it('shows a page error and keeps the list', async () => {
    respond([502, { error: { code: 'hl_unavailable', message: 'HighLevel is temporarily unavailable.' } }])
    const p = hl.usePager('contacts')
    await flush()
    expect(p.error.value).toMatchObject({ code: 'hl_unavailable', message: 'HighLevel is temporarily unavailable.' })
    expect(p.loading.value).toBe(false)
    // A template shows the message whether the app writes {{ error }} or {{ error.message }}.
    expect(toDisplayString(p.error.value)).toBe('HighLevel is temporarily unavailable.')
    respond([200, { contacts: [{ id: 'c1' }], meta: {} }])
    await p.reset()
    expect(p.error.value).toBeNull()
    expect(p.items.value).toHaveLength(1)
  })
})

describe('calendars', () => {
  it('caps free slots at 31 days, sends the timezone, and keeps only date keys', async () => {
    respond([200, { '2026-11-07': { slots: ['b'] }, '2026-11-06': { slots: ['a'] }, traceId: 't' }])
    const from = Date.UTC(2026, 10, 1)
    const slots = await hl.freeSlots('cal1', { from, to: from + 90 * 86_400_000, timezone: 'Asia/Kolkata' })
    const q = calls[0].url.searchParams
    expect(Number(q.get('endDate')) - Number(q.get('startDate'))).toBe(31 * 86_400_000)
    expect(q.get('timezone')).toBe('Asia/Kolkata')
    expect(q.has('locationId')).toBe(false)
    expect(slots).toEqual([{ date: '2026-11-06', slots: ['a'] }, { date: '2026-11-07', slots: ['b'] }])
  })

  it('merges events across calendars, ignoring an inactive calendar that refuses', async () => {
    respond(
      [200, { calendars: [{ id: 'a', name: 'Sales' }, { id: 'b', name: 'Old', isActive: false }, { id: 'c', name: 'Service' }] }],
      [200, { events: [{ id: 'e2', startTime: '2026-11-06 12:00:00' }] }],
      [400, { error: { code: 'hl_request_failed', message: 'Calendar is inactive' } }],
      [200, { events: [{ id: 'e1', startTime: '2026-11-06 09:00:00' }] }],
    )
    const events = await hl.listEvents({ from: 1, to: 2 })
    expect(events.map((e: { id: string; calendarName: string }) => `${e.id}:${e.calendarName}`)).toEqual(['e1:Service', 'e2:Sales'])
  })

  it('fails when an active calendar fails', async () => {
    respond(
      [200, { calendars: [{ id: 'a', name: 'Sales' }] }],
      [502, { error: { code: 'hl_unavailable', message: 'HighLevel is temporarily unavailable.' } }],
    )
    await expect(hl.listEvents({ from: 1, to: 2 })).rejects.toMatchObject({ code: 'hl_unavailable' })
  })
})

describe('shape helpers', () => {
  it('names contacts in real case from any record', () => {
    // Contacts list item (lowercased names, real case in *Raw), single contact, conversation.
    expect(hl.contactName({ firstName: 'nisha', lastName: 'ramesh', contactName: 'nisha ramesh', firstNameRaw: 'Nisha', lastNameRaw: 'Ramesh' })).toBe('Nisha Ramesh')
    expect(hl.contactName({ firstName: 'George', lastName: 'Kutty' })).toBe('George Kutty')
    expect(hl.contactName({ fullName: 'Nisha Ramesh Updated', contactName: 'Nisha Ramesh updated' })).toBe('Nisha Ramesh Updated')
    expect(hl.contactName({ companyName: 'AutoFleet' })).toBe('AutoFleet')
    expect(hl.contactName({ email: 'a@b.co' })).toBe('a@b.co')
    expect(hl.contactName({})).toBe('Unnamed contact')
    expect(hl.contactName(null)).toBe('')
  })

  it('reads every HighLevel time format', () => {
    expect(hl.toDate('2026-11-06T14:30:00+05:30')!.toISOString()).toBe('2026-11-06T09:00:00.000Z')
    const local = hl.toDate('2026-10-22 16:00:00')!
    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes()]).toEqual([2026, 9, 22, 16, 0])
    expect(hl.toDate(1794374629386)!.getTime()).toBe(1794374629386)
    expect(hl.toDate('')).toBeNull()
    expect(hl.toDate('not a date')).toBeNull()
    expect(hl.toDate(null)).toBeNull()
  })

  it('returns a contact and its appointments sorted, with Dates, optionally upcoming only', async () => {
    vi.setSystemTime(new Date(2026, 10, 1, 12, 0))
    respond(
      [200, { contact: { id: 'c1', firstName: 'Shilpa' } }],
      [200, { events: [
        { id: 'late', startTime: '2026-11-06 14:30:00', endTime: '2026-11-06 16:00:00' },
        { id: 'past', startTime: '2026-10-22 16:00:00' },
        { id: 'soon', startTime: '2026-11-02 09:00:00' },
        { id: 'bad', startTime: null },
      ] }],
    )
    expect(await hl.getContact('c 1')).toEqual({ id: 'c1', firstName: 'Shilpa' })
    expect(calls[0].url.pathname).toBe('/hlProxy/contacts/c%201')
    const upcoming = await hl.contactAppointments('c1', { upcoming: true })
    expect(upcoming.map((e: { id: string }) => e.id)).toEqual(['soon', 'late'])
    expect(upcoming[1].end).toBeInstanceOf(Date)
  })
})

describe('API reference stays in sync', () => {
  it('documents exactly the functions the client exports', () => {
    const md = readFileSync(new URL('../../../../functions/src/llm/hlReference.md', import.meta.url), 'utf8')
    const section = md.split('\n## Client')[1].split('\n## ')[0]
    const documented = new Set([...section.matchAll(/`(\w+)\(/g)].map((m) => m[1]))
    const exported = Object.entries(hl).filter(([, v]) => typeof v === 'function').map(([k]) => k)
    expect([...documented].sort()).toEqual(exported.sort())
    for (const name of ['LOCATION_ID', 'LOCATION_NAME']) {
      expect(section).toContain(`\`${name}\``)
      expect(typeof hl[name]).toBe('string')
    }
  })
})
