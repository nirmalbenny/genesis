import { describe, expect, it } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
// @ts-expect-error The components are plain JavaScript (injected into Sandpack previews), so they have no types.
import * as UI from './ui/index.js'

/** Renders a component (with props and a default slot) to HTML, as the preview would on first paint. */
async function render(component: Component, props: Record<string, unknown> = {}, slot: () => unknown = () => 'x') {
  const html = await renderToString(createSSRApp({ render: () => h(component, props, { default: slot }) }))
  return html.replace(/<!--[^>]*-->/g, '') // Vue's hydration markers
}

/** The opening tag of the first element whose tag contains `marker`, to check attributes in any order. */
function tag(html: string, marker: string): string {
  const found = [...html.matchAll(/<[a-z][^>]*>/g)].map((m) => m[0]).find((t) => t.includes(marker))
  if (!found) throw new Error(`no element with ${marker} in ${html}`)
  return found
}

describe('components render with the kit classes', () => {
  it('Button maps shadcn variants and sizes to kit classes, and renders links', async () => {
    const button = tag(await render(UI.Button), 'class="btn primary"')
    expect(button).toMatch(/^<button /)
    expect(button).toContain('type="button"')
    expect(await render(UI.Button, { variant: 'outline', size: 'sm' })).toContain('class="btn outline sm"')
    expect(await render(UI.Button, { variant: 'destructive' })).toContain('class="btn danger"')
    expect(await render(UI.Button, { variant: 'ghost', size: 'icon' })).toContain('class="btn ghost icon"')
    const link = await render(UI.Button, { as: 'a', href: '/x', variant: 'link' })
    expect(tag(link, 'class="btn link"')).toMatch(/^<a [^>]*href="\/x"/)
    expect(link).not.toContain('type=')
  })

  it('Badge and Alert map variants', async () => {
    expect(await render(UI.Badge)).toContain('class="badge primary"')
    expect(await render(UI.Badge, { variant: 'secondary' })).toContain('class="badge"')
    expect(await render(UI.Badge, { variant: 'success' })).toContain('class="badge success"')
    const alert = await render(UI.Alert, { variant: 'destructive' })
    expect(alert).toContain('role="alert"')
    expect(alert).toContain('class="notice error"')
  })

  it('Card parts, Table, Separator, Skeleton, Label and the states render their kit elements', async () => {
    expect(await render(UI.Card)).toBe('<div class="card">x</div>')
    expect(await render(UI.CardTitle)).toBe('<h3 class="card-title">x</h3>')
    expect(await render(UI.Table)).toBe('<div class="table-wrap"><table class="table">x</table></div>')
    expect(await render(UI.Separator, { orientation: 'vertical' })).toContain('class="separator vertical"')
    expect(await render(UI.Skeleton, { style: 'height: 20px' })).toContain('class="skeleton"')
    expect(await render(UI.Label, { for: 'email' })).toBe('<label class="label" for="email">x</label>')
    expect(await render(UI.Loading)).toContain('role="status"')
    expect(await render(UI.Stat, { label: 'Leads', value: 12 })).toMatch(/stat-value">12<.*stat-label">Leads</)
    expect(await render(UI.EmptyState, { title: 'No contacts', description: 'Try another search' })).toMatch(/No contacts.*Try another search/)
  })

  it('Input, Textarea and NativeSelect are v-model friendly and pass native attributes', async () => {
    const input = await render(UI.Input, { modelValue: 'Ada', placeholder: 'Name', type: 'email' })
    expect(input).toContain('class="input"')
    expect(input).toContain('value="Ada"')
    expect(input).toContain('placeholder="Name"')
    expect(await render(UI.Textarea, { modelValue: 'Hi' })).toMatch(/<textarea class="input"[^>]*>Hi<\/textarea>/)
    const select = await render(UI.NativeSelect, {}, () => h('option', { value: 'a' }, 'A'))
    expect(select).toMatch(/<select class="input"[^>]*><option value="a">A<\/option><\/select>/)
  })

  it('Avatar shows initials, or the image', async () => {
    expect(await render(UI.Avatar, { name: 'ada lovelace' })).toContain('>AL</span>')
    expect(await render(UI.Avatar, { name: '' })).toContain('>?</span>')
    expect(await render(UI.Avatar, { name: 'Ada', src: 'https://x/a.png' })).toContain('<img src="https://x/a.png" alt="Ada">')
  })

  it('reka-ui components render accessible markup with kit classes', async () => {
    const tabs = await render(UI.Tabs, { defaultValue: 'a' }, () => [
      h(UI.TabsList, null, { default: () => [h(UI.TabsTrigger, { value: 'a' }, { default: () => 'A' }), h(UI.TabsTrigger, { value: 'b' }, { default: () => 'B' })] }),
      h(UI.TabsContent, { value: 'a' }, { default: () => 'Panel A' }),
    ])
    expect(tabs).toContain('class="tabs"')
    const active = tag(tabs, 'trigger-a"')
    for (const a of ['class="tab"', 'role="tab"', 'aria-selected="true"', 'data-state="active"']) expect(active).toContain(a)
    expect(tabs).toContain('role="tabpanel"')
    expect(tabs).toContain('Panel A')

    const checkbox = await render(UI.Checkbox, { modelValue: true })
    for (const a of ['class="checkbox"', 'role="checkbox"', 'aria-checked="true"']) expect(tag(checkbox, 'role="checkbox"')).toContain(a)
    for (const a of ['class="switch"', 'aria-checked="false"']) expect(tag(await render(UI.Switch, { modelValue: false }), 'role="switch"')).toContain(a)

    const select = await render(UI.Select, {}, () => h(UI.SelectTrigger, null, { default: () => h(UI.SelectValue, { placeholder: 'Pick one' }) }))
    expect(select).toContain('class="select-trigger"')
    expect(select).toContain('Pick one')

    // Closed overlays render only their trigger.
    const dialog = await render(UI.Dialog, {}, () => h(UI.DialogTrigger, null, { default: () => 'Open' }))
    for (const a of ['aria-haspopup="dialog"', 'aria-expanded="false"']) expect(tag(dialog, 'aria-haspopup')).toContain(a)
  })
})

// Sandpack's vue-cli template compiles .vue files with an older compiler than this repo's: macros added in
// Vue 3.3+ (defineOptions, defineModel, …) and destructured props crash the preview at run time.
const SOURCES = import.meta.glob('./ui/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('components only use what the preview compiler supports', () => {
  it.each(Object.entries(SOURCES))('%s', (_, source) => {
    expect(source).not.toMatch(/\b(defineOptions|defineModel|defineSlots|useTemplateRef|useId)\b/)
    expect(source).not.toMatch(/const\s*\{[^}]*\}\s*=\s*(withDefaults\()?defineProps/)
    expect(source).not.toMatch(/<script[^>]*\blang=/)
  })
})
