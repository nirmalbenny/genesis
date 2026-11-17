import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

// The ready-made apps (functions/templates/<slug>/src) run in the same Sandpack preview as generated apps, on the
// injected kit and components. They can't be run here without HighLevel, so every file is compiled and every
// component it uses is checked against its imports and against the components the preview provides.
const ROOT = fileURLToPath(new URL('../../../functions/templates/', import.meta.url))
const UI_INDEX = readFileSync(new URL('./genesis/ui/index.js', import.meta.url), 'utf8')
const PROVIDED = new Set([...UI_INDEX.matchAll(/export \{ default as (\w+) \}/g)].map((m) => m[1]))

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]))
const slugs = readdirSync(ROOT).filter((f) => statSync(join(ROOT, f)).isDirectory())

describe.each(slugs)('ready-made app %s', (slug) => {
  const all = files(join(ROOT, slug, 'src'))

  it('imports the kit before its own styles', () => {
    const main = readFileSync(join(ROOT, slug, 'src', 'main.js'), 'utf8')
    expect(main).toContain('import "./genesis/ui.css";')
    const own = main.indexOf('./style.css')
    if (own >= 0) expect(main.indexOf('./genesis/ui.css')).toBeLessThan(own)
  })

  it.each(all.filter((f) => f.endsWith('.vue')).map((f) => [f.slice(ROOT.length), f]))('%s compiles and imports every component it uses', (_, file) => {
    const source = readFileSync(file, 'utf8')
    const { descriptor, errors } = parse(source, { filename: file })
    expect(errors).toEqual([])
    const script = compileScript(descriptor, { id: 'x' })
    const template = compileTemplate({ source: descriptor.template!.content, filename: file, id: 'x', compilerOptions: { bindingMetadata: script.bindings } })
    expect(template.errors).toEqual([])

    const used = new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]))
    const imported = new Set(Object.keys(script.bindings ?? {}))
    for (const name of used) expect(imported.has(name), `${name} is used but not imported`).toBe(true)

    for (const m of descriptor.scriptSetup!.content.matchAll(/import \{([^}]*)\} from "(?:\.\.?\/)+genesis\/ui"/g)) {
      for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        expect(PROVIDED.has(name), `${name} is not a Genesis component`).toBe(true)
      }
    }
  })
})
