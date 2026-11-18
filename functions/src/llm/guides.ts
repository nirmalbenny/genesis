import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESOURCES } from "../hl/registry";

/**
 * Claude's HighLevel reference, in two parts (docs/plans/hl-resource-registry.md §6):
 * - the core (llm/hlReference.md: errors, the shared client functions) and a catalog of every resource, one line
 *   each, in the system prompt for every build;
 * - one guide per resource (hl-resources/<id>.md: its functions, response shapes, quirks and limits), attached only
 *   when the build needs that resource, as a second cached system block. Guides are joined in a fixed order, so
 *   every build that needs the same set shares one prompt cache entry.
 */

const CORE = readFileSync(join(__dirname, "hlReference.md"), "utf8");
const RESOURCE_DIR = join(__dirname, "..", "hl-resources");

type Guide = { id: string; label: string; summary: string; aliases: string[]; text: string; functions: string[]; kinds: string[]; calls: string[] };

/** The resources with a guide (every resource that isn't internal), in registry order. */
export const GUIDES: Guide[] = RESOURCES.filter((r) => !r.internal).map((r) => {
  const text = readFileSync(join(RESOURCE_DIR, `${r.id}.md`), "utf8").trim();
  const kinds = [...new Set([...text.matchAll(/usePager\('(\w+)'/g)].map((m) => m[1]!))];
  const functions = [...new Set([...text.matchAll(/`(\w+)\(/g)].map((m) => m[1]!))].filter((f) => f !== "usePager" && f !== "call");
  const calls = [...new Set([...text.matchAll(/call\('(\w+)'/g)].map((m) => m[1]!))];
  return { id: r.id, label: r.label ?? r.id, summary: r.summary, aliases: r.aliases ?? [], text, functions, kinds, calls };
});

/** Every client function the reference documents (core and guides): what generated code may import. */
export const CLIENT_FUNCTIONS = new Set([
  ...[...(CORE.split("\n## Client")[1]?.split("\n## ")[0] ?? "").matchAll(/`(\w+)\(/g)].map((m) => m[1]!),
  ...GUIDES.flatMap((g) => g.functions),
]);

/** One line per resource: what it holds and what to call. */
export function catalog(): string {
  return GUIDES.map((g) => {
    const calls = [...g.kinds.map((k) => `usePager('${k}')`), ...g.calls.map((c) => `call('${c}')`), ...g.functions].join(", ");
    return `- ${g.label}: ${g.summary}. ${calls}.`;
  }).join("\n");
}

/** The core reference with the catalog: the system prompt's HighLevel part, the same for every build. */
export function coreReference(): string {
  return `${CORE.trim()}\n${catalog()}`;
}

/** Which resource a client function or usePager kind belongs to. */
const OWNER = new Map<string, string>([
  // Every registry list and endpoint, by the resource that declares it.
  ...RESOURCES.filter((r) => !r.internal).flatMap((r) => r.endpoints.flatMap((e) => [[`call:${e.name}`, r.id], ...(e.pager ? [[`pager:${e.name}`, r.id]] : [])] as [string, string][])),
  // The named client functions each guide documents.
  ...GUIDES.flatMap((g) => g.functions.map((f) => [f, g.id] as [string, string])),
]);

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);

/**
 * The guides a build needs:
 * - resources the app already uses (client functions it imports, usePager kinds in the files sent in full);
 * - resources whose aliases the request mentions;
 * - contacts, whenever anything else is chosen (nearly every app shows people).
 * When neither the request nor the app points anywhere (a vague request for a new app), every guide is attached,
 * as before the split, so a build never lacks what it needs.
 */
export function selectGuides(input: { prompt: string; helpers: string[]; sources: string[] }): string[] {
  const chosen = new Set<string>();
  for (const h of input.helpers) { const id = OWNER.get(h); if (id) chosen.add(id); }
  for (const src of input.sources) {
    for (const m of src.matchAll(/usePager\(\s*['"](\w+)['"]/g)) { const id = OWNER.get(`pager:${m[1]}`); if (id) chosen.add(id); }
    for (const m of src.matchAll(/\bcall\(\s*['"](\w+)['"]/g)) { const id = OWNER.get(`call:${m[1]}`); if (id) chosen.add(id); }
  }
  const said = words(input.prompt);
  for (const g of GUIDES) if (g.aliases.some((a) => said.has(a))) chosen.add(g.id);
  if (!chosen.size) return GUIDES.map((g) => g.id);
  if (GUIDES.some((g) => g.id === "contacts")) chosen.add("contacts");
  return GUIDES.filter((g) => chosen.has(g.id)).map((g) => g.id); // registry order: one cache entry per set
}

/** The guides block for the chosen resources (a second cached system block). */
export function guidesBlock(ids: string[]): string {
  const text = GUIDES.filter((g) => ids.includes(g.id)).map((g) => g.text).join("\n\n");
  return `# HighLevel guides\nThe guides for the resources this request needs. Other resources are listed under "HighLevel data".\n\n${text}`;
}
