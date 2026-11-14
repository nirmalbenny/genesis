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
  it('documents exactly the classes the stylesheet defines', () => {
    expect(documentedClasses().sort()).toEqual(cssClasses().sort())
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
