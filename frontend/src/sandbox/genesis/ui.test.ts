import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./ui.css', import.meta.url), 'utf8')
const doc = readFileSync(new URL('../../../../functions/src/llm/uiKit.md', import.meta.url), 'utf8')

/** Class names used in selectors (declarations removed, so values like 0.5 or url(...) can't match). */
function cssClasses(): string[] {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^}]*\}/g, ' ')
  return [...new Set([...selectors.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]))]
}

/** Every `.name` (or `.a.b`) code span in the model's documentation. */
function documentedClasses(): string[] {
  const spans = [...doc.matchAll(/`(\.[a-z][\w.-]*)`/g)].map((m) => m[1])
  return [...new Set(spans.flatMap((s) => s.split('.').filter(Boolean)))]
}

describe('UI kit stays in sync with its documentation', () => {
  // The doc lists only what new apps should use; older class names and the components' internal ones stay in the
  // kit (add-only) but are left out of the prompt to keep it short.
  it('documents only classes the stylesheet defines', () => {
    for (const c of documentedClasses()) expect(cssClasses(), c).toContain(c)
  })

  it('documents the layout classes apps need next to the components', () => {
    const needed = 'page header stack row grid spacer stats table-wrap field list list-item clickable active chips chip muted small truncate sr-only'
    for (const c of needed.split(' ')) expect(documentedClasses(), c).toContain(c)
  })

  it('documents exactly the variables apps may override', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(css)![1]
    const defined = [...root.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
    const line = doc.split('\n').find((l) => l.startsWith('Variables'))!
    const documented = [...new Set([...line.matchAll(/--[\w-]+/g)].map((m) => m[0]))]
    expect(documented.sort()).toEqual(defined.sort())
  })

  it('tells apps how to import it', () => {
    expect(doc).toContain('import "./genesis/ui.css"')
  })
})

// Every class and variable an app could have used before the Genesis restyle (2026-11-18). The kit is live for all
// apps at once, so these must never disappear.
const SINCE_V1 = {
  classes: 'page header stack row grid spacer card muted small truncate btn primary danger ghost sm field label input list list-item clickable active table avatar badge success warning info chips chip stats stat stat-value stat-label notice error empty loading'.split(' '),
  variables: '--bg --surface --text --muted --border --primary --on-primary --success --warning --danger --info --radius --font --tint-amount --surface-muted --primary-soft'.split(' '),
}

describe('UI kit is add-only', () => {
  it('keeps every class and variable apps may already use', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(css)![1]
    for (const c of SINCE_V1.classes) expect(cssClasses(), c).toContain(c)
    for (const v of SINCE_V1.variables) expect(root, v).toContain(`${v}:`)
  })
})

describe('components stay in sync with their documentation', () => {
  const index = readFileSync(new URL('./ui/index.js', import.meta.url), 'utf8')
  const exported = [...index.matchAll(/export \{ default as (\w+) \}/g)].map((m) => m[1])
  it('documents exactly the exported components', () => {
    const documented = [...new Set([...doc.matchAll(/`([A-Z]\w+)`/g)].map((m) => m[1]))]
    expect(documented.sort()).toEqual([...exported].sort())
  })
  it('tells apps how to import them', () => {
    expect(doc).toContain('from "./genesis/ui"')
  })
})
