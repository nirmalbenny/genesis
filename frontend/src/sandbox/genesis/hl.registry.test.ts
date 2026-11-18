import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// A resource the client has no code for, declared only as registry data: everything below must work from it.
vi.mock('./hl.registry.js', () => ({
  default: [
    {
      name: 'deals', method: 'GET', path: '/deals/search',
      pager: { strategy: 'page', items: 'deals', total: 'meta.total', search: { param: 'q', min: 2 }, options: ['stage'], fixed: { status: 'open' } },
    },
    { name: 'stageDeals', method: 'GET', path: '/pipelines/{pipelineId}/deals', pager: { strategy: 'token', items: 'deals', param: 'after', token: 'next', hasNext: 'more' } },
    { name: 'getDeal', method: 'GET', path: '/deals/{dealId}', unwrap: 'deal' },
    { name: 'updateDeal', method: 'PUT', path: '/deals/{dealId}', unwrap: 'deal' },
  ],
}))

// @ts-expect-error untyped: plain JS, injected as-is into the sandbox
const hl = await import('./hl.js')

type Call = { url: URL; init: RequestInit }
let calls: Call[] = []
function respond(...responses: [number, unknown][]) {
  calls = []
  const queue = [...responses]
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    calls.push({ url: new URL(url), init })
    const [status, body] = queue.shift() ?? [500, { error: { code: 'no_stub', message: 'no response stubbed' } }]
    return new Response(JSON.stringify(body), { status })
  }))
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const deals = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${from + i}` }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('a resource declared only in the registry', () => {
  it('pages its list by page number, with its search, options and fixed parameters', async () => {
    respond([200, { deals: deals(0, 2), meta: { total: 3 } }], [200, { deals: deals(2, 1), meta: { total: 3 } }])
    const pager = hl.usePager('deals', { limit: 2, query: 'creta', stage: 'won' })
    await flush()
    expect(pager.items.value.map((d: { id: string }) => d.id)).toEqual(['d0', 'd1'])
    expect(pager.total.value).toBe(3)
    expect(pager.hasMore.value).toBe(true)
    const first = calls[0]!.url
    expect(first.pathname).toBe('/hlProxy/deals/search')
    expect(Object.fromEntries(first.searchParams)).toEqual({ status: 'open', limit: '2', stage: 'won', q: 'creta' })
    await pager.loadMore()
    await flush()
    expect(calls[1]!.url.searchParams.get('page')).toBe('2')
    expect(pager.items.value).toHaveLength(3)
    expect(pager.hasMore.value).toBe(false) // a short page ends the list
  })

  it('fills path placeholders from the options, and waits while one is missing', async () => {
    respond([200, { deals: deals(0, 1), next: 't2', more: true }], [200, { deals: deals(1, 1), more: false }])
    const pipelineId = ref('')
    const pager = hl.usePager('stageDeals', () => ({ pipelineId: pipelineId.value }))
    await flush()
    expect(calls).toHaveLength(0) // no request until pipelineId is set
    pipelineId.value = 'p 1'
    await flush() // the watcher runs on Vue's next tick, then the debounce starts
    vi.advanceTimersByTime(400)
    await flush()
    expect(calls[0]!.url.pathname).toBe('/hlProxy/pipelines/p%201/deals')
    expect(pager.hasMore.value).toBe(true)
    await pager.loadMore()
    await flush()
    expect(calls[1]!.url.searchParams.get('after')).toBe('t2')
    expect(pager.hasMore.value).toBe(false)
  })

  it('call() reads and writes by name, fills the path and unwraps the response', async () => {
    respond([200, { deal: { id: 'd1', name: 'Creta' } }], [200, { deal: { id: 'd1', stage: 'won' } }])
    expect(await hl.call('getDeal', { dealId: 'd1', expand: 'contact' })).toEqual({ id: 'd1', name: 'Creta' })
    expect(calls[0]!.url.pathname).toBe('/hlProxy/deals/d1')
    expect(calls[0]!.url.searchParams.get('expand')).toBe('contact')
    expect(calls[0]!.url.searchParams.has('dealId')).toBe(false) // placeholders are not sent again as query
    expect(await hl.call('updateDeal', { dealId: 'd1' }, { stage: 'won' })).toEqual({ id: 'd1', stage: 'won' })
    expect(calls[1]!.init.method).toBe('PUT')
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ stage: 'won' })
  })

  it('call() refuses unknown names and missing placeholders before any request', async () => {
    respond()
    await expect(hl.call('deleteDeal', { dealId: 'd1' })).rejects.toMatchObject({ code: 'unknown_call' })
    await expect(hl.call('getDeal', {})).rejects.toMatchObject({ code: 'invalid_call', message: 'getDeal needs dealId.' })
    expect(calls).toHaveLength(0)
  })

  it('an unknown list names the ones that exist', () => {
    expect(() => hl.usePager('opportunities')).toThrow(/unknown list "opportunities" \(use deals, stageDeals\)/)
  })
})
