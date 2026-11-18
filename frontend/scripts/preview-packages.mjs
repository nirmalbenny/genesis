// Writes functions/src/llm/packages.json: the npm modules generated apps may import, at the versions the preview
// pins (src/lib/previewPackages.ts), with every name each one exports. The code check refuses other packages and
// names a module doesn't export. The packages are devDependencies here at the same exact versions; after changing a
// version in both places, run `node scripts/preview-packages.mjs` (a test checks all three agree).
import { readFileSync, writeFileSync } from 'node:fs'

/** Modules apps may import: each package, and the few entry points under one they need. */
export const MODULES = ['element-plus', '@element-plus/icons-vue', 'chart.js', 'chart.js/auto', 'vue-chartjs']

const pkgOf = (module) => (module.startsWith('@') ? module.split('/').slice(0, 2).join('/') : module.split('/')[0])

export async function describe() {
  const devDeps = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).devDependencies
  const versions = {}
  const modules = {}
  for (const module of MODULES) {
    versions[pkgOf(module)] = devDeps[pkgOf(module)]
    modules[module] = Object.keys(await import(module)).filter((k) => k !== '__esModule').sort()
  }
  return { versions, modules }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = new URL('../../functions/src/llm/packages.json', import.meta.url)
  writeFileSync(out, JSON.stringify(await describe(), null, 1) + '\n')
  console.log(`wrote ${MODULES.length} modules to functions/src/llm/packages.json`)
}
