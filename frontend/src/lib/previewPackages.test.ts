import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { packagesFor, PREVIEW_PACKAGES } from './previewPackages'
import SETUP from '../sandbox/genesis/setup.js?raw'
// @ts-expect-error A plain JavaScript script (it writes the code check's list), no types.
import { describe as describePackages, MODULES } from '../../scripts/preview-packages.mjs'

const checkList = JSON.parse(readFileSync(new URL('../../../functions/src/llm/packages.json', import.meta.url), 'utf8'))
const devDependencies = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).devDependencies

describe('the npm packages generated apps may import', () => {
  it('are pinned to the same exact versions in the preview, the dev dependencies and the code check', () => {
    expect(checkList.versions).toEqual(PREVIEW_PACKAGES)
    for (const [pkg, version] of Object.entries(PREVIEW_PACKAGES)) {
      expect(version, pkg).toMatch(/^\d+\.\d+\.\d+$/)
      expect(devDependencies[pkg], pkg).toBe(version)
    }
  })

  it("give the code check every name each module really exports (regenerate: node scripts/preview-packages.mjs)", async () => {
    expect(Object.keys(checkList.modules)).toEqual(MODULES)
    expect(await describePackages()).toEqual(checkList)
  })

  it('are added to the preview only when the app imports them, with what they need', () => {
    expect(packagesFor(['import { ref } from "vue";'])).toEqual({})
    expect(packagesFor([SETUP])).toEqual({ 'element-plus': '2.14.8' })
    expect(packagesFor(['import { Search } from "@element-plus/icons-vue";'])).toEqual({ '@element-plus/icons-vue': '2.3.2' })
    expect(packagesFor(['import { Bar } from "vue-chartjs";\nimport "chart.js/auto";'])).toEqual({ 'vue-chartjs': '5.3.4', 'chart.js': '4.6.1' })
    expect(packagesFor(['import "element-plus-extras";']), 'a prefix is not the package').toEqual({})
  })
})

describe('the setup file', () => {
  it('mounts the app with Element Plus and its styles, and uses only what the preview compiler supports', () => {
    expect(SETUP).toMatch(/export function mountApp\(App, options = \{\}\)/)
    expect(SETUP).toContain('import ElementPlus from "element-plus"')
    expect(SETUP).toContain('import "element-plus/dist/index.css"')
    expect(SETUP).toContain('app.mount("#app")')
    expect(SETUP.indexOf('import "./theme.css"'), 'the design standard loads after Element Plus').toBeGreaterThan(SETUP.indexOf('element-plus/dist/index.css'))
    expect(SETUP).toMatch(/classList\.toggle\("dark", options\.theme === "dark"\)/)
  })
})
