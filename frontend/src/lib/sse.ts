export type SseMessage = { event: string; data: unknown }

/** Reads a text/event-stream response body and calls onMessage for each complete event. */
export async function readSse(res: Response, onMessage: (m: SseMessage) => void): Promise<void> {
  if (!res.body) throw new Error('Response has no body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (block: string) => {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue // comment / heartbeat
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (!data.length) return
    try {
      onMessage({ event, data: JSON.parse(data.join('\n')) })
    } catch {
      // ignore a malformed event rather than dropping the whole stream
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      dispatch(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 2)
    }
  }
  if (buffer.trim()) dispatch(buffer)
}
