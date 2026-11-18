// The HighLevel resource registry (hl-resources/*.json at the repo root, shared with the functions), as the frontend
// uses it: scopes for the reconnect notice, labels for the data chips, and the endpoints the injected client calls.

type Endpoint = { name: string; method: string; path: string; pager?: Record<string, unknown>; unwrap?: string }
export type Resource = { id: string; label?: string; internal?: boolean; scopes: string[]; endpoints: Endpoint[] }

const files = import.meta.glob<Resource>('@hl-resources/*.json', { eager: true, import: 'default' })
export const RESOURCES: Resource[] = Object.values(files).sort((a, b) => a.id.localeCompare(b.id))

/** Names of the HighLevel data apps can use, for the "Using live data" chips. */
export const DATA_LABELS: string[] = RESOURCES.filter((r) => !r.internal).map((r) => r.label ?? r.id)

/**
 * What the injected client needs (src/genesis/hl.registry.js in the preview): each endpoint's name, method, path,
 * pager and unwrap. Scopes, versions and locations stay on the server, which enforces them.
 */
export function clientRegistry(resources: Resource[] = RESOURCES): Endpoint[] {
  return resources
    .filter((r) => !r.internal)
    .flatMap((r) => r.endpoints.map(({ name, method, path, pager, unwrap }) => ({ name, method, path, ...(pager ? { pager } : {}), ...(unwrap ? { unwrap } : {}) })))
}
