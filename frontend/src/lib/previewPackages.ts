// npm packages a generated app may import, at the exact versions the preview installs (Sandpack downloads what the
// preview's package.json lists). Only the packages an app's files import are listed, so apps that don't use one
// don't download it. Versions are pinned: an upgrade is deliberate (docs/plans/ui-library.md). The code check's
// list (functions/src/llm/packages.json) must name the same packages and versions; a test checks both.
export const PREVIEW_PACKAGES: Record<string, string> = {
  'element-plus': '2.14.8',
  '@element-plus/icons-vue': '2.3.2',
  'chart.js': '4.6.1',
  'vue-chartjs': '5.3.4',
}

/** Packages a package needs next to it in the preview (vue-chartjs draws with chart.js). */
const WITH: Record<string, string[]> = { 'vue-chartjs': ['chart.js'] }

const imports = (code: string, pkg: string) => new RegExp(`(?:from|import)\\s*["']${pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:/[^"']*)?["']`).test(code)

/** The pinned packages the given sources import (with what they need), as package.json dependencies. */
export function packagesFor(sources: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [pkg, version] of Object.entries(PREVIEW_PACKAGES)) {
    if (!sources.some((code) => imports(code, pkg))) continue
    out[pkg] = version
    for (const dep of WITH[pkg] ?? []) out[dep] = PREVIEW_PACKAGES[dep]!
  }
  return out
}
