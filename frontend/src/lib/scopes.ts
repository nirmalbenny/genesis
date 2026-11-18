// What the HighLevel connection can't do yet: the registry's scopes (hl-resources/*.json, shared with the functions)
// compared with the scopes the user granted (users/{uid}.hl.scopes). When a release adds a resource, users who
// connected before are asked to reconnect for it.

import { RESOURCES, type Resource } from './registry'

export { RESOURCES }

export type Missing = { label: string; changesOnly: boolean }

/**
 * Resources the connection lacks scopes for: `changesOnly` when it can read them but not change them.
 * Unknown grants (a connection the server hasn't synced yet) report nothing rather than a false alarm.
 */
export function missingAccess(granted: string[] | null | undefined, resources: Pick<Resource, 'id' | 'label' | 'internal' | 'scopes'>[] = RESOURCES): Missing[] {
  if (!granted) return []
  const out: Missing[] = []
  for (const r of resources) {
    if (r.internal) continue
    const lacking = r.scopes.filter((s) => !granted.includes(s))
    if (!lacking.length) continue
    out.push({ label: r.label ?? r.id, changesOnly: lacking.every((s) => s.endsWith('.write')) })
  }
  return out
}

const list = (words: string[]) => (words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`)

/** "Opportunities and changes to Contacts and Calendars", for the reconnect notice. */
export function describeMissing(missing: Missing[]): string {
  const full = list(missing.filter((m) => !m.changesOnly).map((m) => m.label))
  const changes = list(missing.filter((m) => m.changesOnly).map((m) => m.label))
  return [full, changes && `changes to ${changes}`].filter(Boolean).join(' and ')
}
