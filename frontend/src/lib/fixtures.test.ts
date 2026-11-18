import { describe, expect, it } from 'vitest'
import { clientRegistry } from './registry'

// Real HighLevel responses, anonymized, recorded by the probe (npm run hl:probe in functions/): every list's pager
// must point at paths that exist in them, so a wrong path in hl-resources/*.json fails here, not in a preview.
const fixtures = import.meta.glob<Record<string, unknown>>('@hl-resources/fixtures/*/*.json', { eager: true, import: 'default' })
const byEndpoint = new Map(Object.entries(fixtures).map(([file, data]) => [file.split('/').pop()!.replace(/\.json$/, ''), data]))
const get = (obj: unknown, path: string) => path.split('.').reduce<unknown>((v, k) => (v == null ? undefined : (v as Record<string, unknown>)[k]), obj)

type Pager = { strategy: string; items: string; total?: string; cursor?: Record<string, string>; token?: string; hasNext?: string; from?: string[] }
const lists = clientRegistry().filter((e) => e.pager) as unknown as { name: string; pager: Pager }[]

describe('recorded HighLevel responses', () => {
  it('exist for every list', () => {
    for (const { name } of lists) expect(byEndpoint.has(name), `no fixture for ${name}: run the probe`).toBe(true)
  })

  it.each(lists.map((l) => [l.name, l.pager] as const))("%s: the pager's paths exist in the real response", (name, p) => {
    const data = byEndpoint.get(name)
    const items = get(data, p.items)
    expect(Array.isArray(items), `${p.items} is not a list`).toBe(true)
    if (p.total) expect(typeof get(data, p.total), `${p.total} is not a number`).toBe('number')
    if (p.strategy === 'cursorFields') for (const path of Object.values(p.cursor ?? {})) expect(get(data, path), `${path} missing`).toBeDefined()
    if (p.strategy === 'token') {
      expect(get(data, p.hasNext!), `${p.hasNext} missing`).toBeTypeOf('boolean')
      expect(get(data, p.token!), `${p.token} missing`).toBeDefined()
    }
    const first = (items as Record<string, unknown>[])[0]
    if (p.strategy === 'lastItem' && first) expect(p.from!.some((path) => get(first, path) !== undefined), `none of ${p.from} on an item`).toBe(true)
  })
})
