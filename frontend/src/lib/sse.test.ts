import { describe, expect, it } from 'vitest'
import { readSse, type SseMessage } from './sse'

/** A Response whose body arrives in the given chunks, like a network stream. */
function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)))
      c.close()
    },
  }))
}

async function read(chunks: string[]): Promise<SseMessage[]> {
  const out: SseMessage[] = []
  await readSse(streamOf(chunks), (m) => out.push(m))
  return out
}

const stream = [
  'event: start\ndata: {"generationId":"g1"}\n\n',
  ': ping\n\n',
  'event: token\ndata: {"text":"a\\nb","path":null}\n\n',
  'event: file_start\ndata: {"path":"src/App.vue"}\n\n',
  'event: done\ndata: {"files":["src/App.vue"]}\n\n',
].join('')

describe('readSse', () => {
  it('parses events and skips heartbeats', async () => {
    expect(await read([stream])).toEqual([
      { event: 'start', data: { generationId: 'g1' } },
      { event: 'token', data: { text: 'a\nb', path: null } },
      { event: 'file_start', data: { path: 'src/App.vue' } },
      { event: 'done', data: { files: ['src/App.vue'] } },
    ])
  })

  it('gives the same result however the stream is split', async () => {
    const whole = await read([stream])
    for (const size of [1, 2, 5, 17]) {
      const chunks = Array.from({ length: Math.ceil(stream.length / size) }, (_, i) => stream.slice(i * size, (i + 1) * size))
      expect(await read(chunks)).toEqual(whole)
    }
  })

  it('handles CRLF line endings and a final event without a trailing blank line', async () => {
    expect(await read(['event: a\r\ndata: 1\r\n\r\nevent: b\ndata: 2'])).toEqual([
      { event: 'a', data: 1 },
      { event: 'b', data: 2 },
    ])
  })

  it('skips a malformed event without dropping the rest', async () => {
    expect(await read(['event: a\ndata: {broken\n\nevent: b\ndata: {"ok":true}\n\n'])).toEqual([
      { event: 'b', data: { ok: true } },
    ])
  })
})
