import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const theme = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')
const guide = readFileSync(new URL('../../../../functions/src/llm/ui/element-plus.md', import.meta.url), 'utf8')
const defined = new Set([...theme.matchAll(/(--app-[\w-]+)\s*:/g)].map((m) => m[1]))
const selectors = theme.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^}]*\}/g, ' ')
const classes = new Set([...selectors.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]))

describe('the design standard (theme.css) and the guide Claude reads', () => {
  it('defines every token the guide names', () => {
    const named = [...new Set([...guide.matchAll(/var\((--app-[\w-]+)\)/g)].map((m) => m[1]))]
    expect(named.length).toBeGreaterThan(10)
    for (const token of named.filter((t) => !t.startsWith('--app-chart-'))) expect(defined, token).toContain(token)
    for (const i of [1, 2, 3, 4, 5]) expect(defined).toContain(`--app-chart-${i}`)
  })

  it('defines every layout class the guide names', () => {
    const line = guide.split('\n').find((l) => l.includes('Classes: `.page`'))!
    const named = [...line.matchAll(/`\.([a-z][\w-]*)`/g)].map((m) => m[1])
    expect(named).toContain('page-header')
    for (const c of named) expect(classes, c).toContain(c)
  })

  it('derives Element Plus from the tokens, so one override restyles every component', () => {
    for (const v of ['--el-color-primary: var(--app-primary-strong)', '--el-bg-color: var(--app-surface)', '--el-text-color-primary: var(--app-text)', '--el-border-color: var(--app-border)', '--el-font-family: var(--app-font)']) {
      expect(theme).toContain(v)
    }
    expect(theme).toMatch(/--el-color-primary-light-3: color-mix\(in srgb, var\(--app-primary\) 70%, var\(--app-surface\)\)/)
  })

  it('has the palette of the design standard, and a dark theme that swaps the surface and text tokens', () => {
    for (const v of ['--app-primary: #ff7a59', '--app-primary-hover: #f56645', '--app-bg: #f5f6f7', '--app-text: #33475b', '--app-border: #dfe3eb', '--app-success: #00a38a', '--app-warning: #f5a623', '--app-danger: #f2545b', '--app-info: #0091ae']) {
      expect(theme).toContain(v)
    }
    const dark = /html\.dark \{([^}]*)\}/.exec(theme)![1]
    for (const t of ['--app-bg', '--app-surface', '--app-text', '--app-border']) expect(dark).toContain(`${t}:`)
  })

  it('keeps text in and on the brand color at WCAG AA contrast (4.5:1)', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05) }
    const token = (name: string) => new RegExp(`${name}: (#[0-9a-f]{6})`).exec(theme)![1]!
    expect(ratio(token('--app-primary-strong'), token('--app-on-primary'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('--app-primary-strong'), token('--app-primary-light'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('--app-text'), token('--app-surface'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('--app-text-secondary'), token('--app-surface'))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(token('--app-text-secondary'), token('--app-bg'))).toBeGreaterThanOrEqual(4.5)
    expect(theme, 'quiet content text uses the secondary color, not the 3:1 muted one').toMatch(/\.muted \{ color: var\(--app-text-secondary\); \}/)
  })
})
