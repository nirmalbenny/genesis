import {
  AppWindow, CalendarDays, ChartColumn, ClipboardList, History, Kanban, LifeBuoy, Radar, Sun, TrendingUp, Users,
  type LucideIcon,
} from '@lucide/vue'

/** App catalog categories (keys duplicated in functions/src/projects.ts). */
export type Category = 'sales' | 'service' | 'scheduling' | 'insights' | 'other'

export const CATEGORIES: { key: Category; label: string; icon: LucideIcon; tile: string }[] = [ // tile: icon container classes
  { key: 'sales', label: 'Sales & Leads', icon: TrendingUp, tile: 'bg-[#fff1ee] text-[#e8491f]' },
  { key: 'service', label: 'Customer Service', icon: LifeBuoy, tile: 'bg-ok-100 text-ok-500' },
  { key: 'scheduling', label: 'Scheduling', icon: CalendarDays, tile: 'bg-data-100 text-data-500' },
  { key: 'insights', label: 'Insights', icon: ChartColumn, tile: 'bg-[#f1edff] text-[#6d4aff]' },
  { key: 'other', label: 'Other', icon: AppWindow, tile: 'bg-muted text-ink-200' },
]

export const categoryOf = (key: string | undefined) => CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[4]!

// Icon keys a ready-made app can name in its manifest; anything else falls back to the category icon.
const ICONS: Record<string, LucideIcon> = {
  users: Users, sun: Sun, clipboard: ClipboardList, radar: Radar, kanban: Kanban, history: History,
}
export const iconOf = (icon: string | null | undefined, category: string | undefined) =>
  (icon && ICONS[icon]) || categoryOf(category).icon

/** Best guess at a category from a prompt, so the create dialog starts with a sensible choice. */
export function guessCategory(text: string): Category {
  const t = text.toLowerCase()
  if (/appointment|calendar|booking|schedule|slot/.test(t)) return 'scheduling'
  if (/lead|pipeline|deal|follow.?up|prospect|sales/.test(t)) return 'sales'
  if (/inbox|conversation|message|support|ticket|reply/.test(t)) return 'service'
  if (/dashboard|report|chart|metric|insight|overview|360/.test(t)) return 'insights'
  return 'other'
}

/** "Build me a contact dashboard with search" -> "Contact dashboard". */
export function suggestName(prompt: string): string {
  const core = prompt.replace(/^(please\s+)?(build|create|make|generate)\s+(me\s+)?(an?\s+|the\s+)?/i, '')
  const short = core.split(/\s+(with|that|which|for|showing|where)\s+|[.,:;]/i)[0] ?? core
  const title = short.trim().slice(0, 48)
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : 'New app'
}
