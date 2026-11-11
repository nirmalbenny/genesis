import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.fn()
vi.mock('@/firebase', () => ({ FUNCTIONS_BASE: 'http://functions.test' }))
vi.mock('@/lib/api', () => ({ api: (...a: unknown[]) => api(...a), authHeader: async () => ({ Authorization: 'Bearer t' }) }))

const { useGeneration } = await import('./useGeneration')

const sse = (events: [string, unknown][]) =>
  events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')

/** A streaming response the test can push events into, then close. */
function controllable() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => { ctrl = c } })
  return {
    res: new Response(body, { status: 200 }),
    push: (events: [string, unknown][]) => ctrl.enqueue(new TextEncoder().encode(sse(events))),
    close: () => ctrl.close(),
  }
}

function setup() {
  const files: Record<string, string> = {}
  const onFinished = vi.fn(async () => {})
  const gen = useGeneration({
    onFileStart: (p) => { files[p] = '' },
    onToken: (p, t) => { files[p] += t },
    onFinished,
  })
  return { gen, files, onFinished }
}

const credits = { charged: 12, balance: 2488 }

beforeEach(() => {
  api.mockReset()
  vi.restoreAllMocks()
})

describe('useGeneration', () => {
  it('streams tokens into files and reports the credits used', async () => {
    const { gen, files, onFinished } = setup()
    const s = controllable()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(s.res)
    const run = gen.start('p1', 'Build a list')
    expect(gen.streaming.value).toBe(true)
    s.push([
      ['start', { generationId: 'g1' }],
      ['token', { text: 'Plan. ', path: null }],
      ['file_start', { path: 'src/App.vue' }],
      ['token', { text: '<template>', path: 'src/App.vue' }],
      ['token', { text: '</template>', path: 'src/App.vue' }],
      ['file_end', { path: 'src/App.vue', bytes: 21 }],
      ['done', { generationId: 'g1', files: ['src/App.vue'], credits }],
    ])
    s.close()
    await run
    expect(files['src/App.vue']).toBe('<template></template>')
    expect(gen.plan.value).toBe('Plan. ')
    expect(gen.building.value).toEqual([{ path: 'src/App.vue', done: true }])
    expect(gen.lastCredits.value).toEqual(credits)
    expect(gen.error.value).toBe('')
    expect(gen.streaming.value).toBe(false)
    expect(onFinished).toHaveBeenCalledOnce()
  })

  it('shows a refusal before streaming (e.g. rate limited) as a plain error', async () => {
    const { gen } = setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'rate_limited', message: 'You can run 2 builds at a time.', retryAfter: 30 } }),
      { status: 429 },
    ))
    await gen.start('p1', 'x')
    expect(gen.error.value).toBe('You can run 2 builds at a time.')
    expect(gen.streaming.value).toBe(false)
  })

  it('keeps declined requests out of the error box', async () => {
    const { gen } = setup()
    const s = controllable()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(s.res)
    const run = gen.start('p1', 'Write me a poem')
    s.push([['error', { code: 'declined', message: "I can't fulfill this request.", partial: false, credits }]])
    s.close()
    await run
    expect(gen.declined.value).toBe("I can't fulfill this request.")
    expect(gen.error.value).toBe('')
  })

  it('reports a partial result when the stream breaks', async () => {
    const { gen } = setup()
    const s = controllable()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(s.res)
    vi.useFakeTimers()
    const run = gen.start('p1', 'x')
    s.push([['start', { generationId: 'g1' }]])
    s.close() // ends without done/error
    await vi.runAllTimersAsync()
    await run
    vi.useRealTimers()
    expect(gen.error.value).toMatch(/Connection lost/)
  })

  it('Stop asks the server to stop the running build and ends without an error', async () => {
    const { gen } = setup()
    const s = controllable()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(s.res)
    api.mockResolvedValue({ requested: true })
    const run = gen.start('p1', 'x')
    s.push([['start', { generationId: 'g7' }]])
    await vi.waitFor(() => expect(gen.streaming.value).toBe(true))
    await new Promise((r) => setTimeout(r, 0)) // let the start event be read
    await gen.stop()
    expect(gen.stopping.value).toBe(true)
    expect(api).toHaveBeenCalledWith('POST', '/projects/p1/generations/g7/cancel')
    s.push([['cancelled', { generationId: 'g7', files: [], unfinished: null, credits }]])
    s.close()
    await run
    expect(gen.error.value).toBe('')
    expect(gen.lastCredits.value).toEqual(credits)
    expect(gen.stopping.value).toBe(false)
  })
})
