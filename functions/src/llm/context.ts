import { posix } from "node:path";
import type { FileEntry, Manifest } from "../files";
import { fileBlock } from "./format";
import { FILE_BUDGET_CHARS, SINGLE_FILE_LIMIT_CHARS, type ContextFile } from "./prompt";

/**
 * Which files a build sends in full, and an index line for the rest. Everything fits in most apps, and then the
 * result is exactly what was sent before (every file, alphabetically, no index). In a large app the files the
 * request most likely touches go first; the model can read indexed files with read_files (llm/tools.ts).
 */
export type ContextHints = {
  activePath?: string | null; // the editor's active tab
  openPaths?: string[]; // other open tabs
  recentPaths?: string[]; // files changed by the last builds
  prompt: string;
};

export type ContextSelection = { full: string[]; index: string[] };

export const ENTRY_CONTEXT = ["src/main.js", "src/App.vue", "src/utils.js"];
const EXTENSIONS = ["", ".vue", ".js", ".ts", "/index.js", "/index.ts"];

/** The project file an import points at (imports are stored without guessing an extension). */
function resolve(manifest: Manifest, target: string): string | null {
  for (const ext of EXTENSIONS) if (manifest[target + ext]) return target + ext;
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Files the prompt names: by path, file name ("ContactList.vue") or component name ("ContactList"). */
function namedIn(prompt: string, paths: string[]): string[] {
  const text = prompt.toLowerCase();
  return paths.filter((p) => {
    const file = posix.basename(p).toLowerCase();
    const name = file.replace(/\.[^.]+$/, "");
    if (text.includes(p.toLowerCase()) || text.includes(file)) return true;
    // Component names only when distinctive: "List" or "utils" would match ordinary words.
    return name.length >= 5 && /[a-z][A-Z]|-/.test(posix.basename(p)) && new RegExp(`\\b${escape(name)}\\b`).test(text);
  });
}

/** Every path of the manifest, most relevant first (see ContextHints); ties keep alphabetical order. */
export function rankPaths(manifest: Manifest, hints: ContextHints): string[] {
  const all = Object.keys(manifest).sort((a, b) => a.localeCompare(b));
  const ranked: string[] = [];
  const add = (paths: Iterable<string | null | undefined>) => {
    for (const p of paths) if (p && manifest[p] && !ranked.includes(p)) ranked.push(p);
  };
  add(ENTRY_CONTEXT);
  add([hints.activePath]);
  add(hints.openPaths ?? []);
  add(hints.recentPaths ?? []);
  add(namedIn(hints.prompt, all));
  // Neighbours of the focus files (not of the entry files: App.vue imports everything).
  const focus = ranked.filter((p) => !ENTRY_CONTEXT.includes(p));
  const neighbours = new Set<string>();
  for (const p of focus) {
    for (const i of manifest[p]!.imports) {
      const target = resolve(manifest, i);
      if (target) neighbours.add(target);
    }
  }
  for (const p of all) if (manifest[p]!.imports.some((i) => focus.includes(resolve(manifest, i) ?? ""))) neighbours.add(p);
  add([...neighbours].sort((a, b) => a.localeCompare(b)));
  add(all);
  return ranked;
}

/** Fills the budget in rank order; files over the single-file limit, or past the budget, go to the index. */
export function selectContext(manifest: Manifest, hints: ContextHints): ContextSelection {
  const full: string[] = [];
  const index: string[] = [];
  let used = 0;
  for (const p of rankPaths(manifest, hints)) {
    const { size } = manifest[p]!; // bytes ≥ characters, so the budget is never exceeded
    if (size > SINGLE_FILE_LIMIT_CHARS || used + size > FILE_BUDGET_CHARS) { index.push(p); continue; }
    used += size;
    full.push(p);
  }
  return { full: full.sort((a, b) => a.localeCompare(b)), index: index.sort((a, b) => a.localeCompare(b)) };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** One line describing a file the model wasn't given, from its manifest entry. */
export function indexLine(path: string, e: FileEntry): string {
  const parts = [`${kb(e.size)}, ${e.lines} lines`];
  if (e.size > SINGLE_FILE_LIMIT_CHARS) parts.push("too large to read or edit");
  if (e.props.length) parts.push(`props: ${e.props.join(", ")}`);
  if (e.emits.length) parts.push(`emits: ${e.emits.join(", ")}`);
  if (e.hlHelpers.length) parts.push(`uses ${e.hlHelpers.join(", ")}`);
  return `${path}  ${parts.join(" · ")}`;
}

/**
 * The files section of the user message. Files sent in full are rendered as file blocks; when some are left
 * out, an index follows, with how to get them (`tools`: the read_files tool is available).
 */
export function renderContext(files: ContextFile[], manifest: Manifest, index: string[], tools: boolean): string {
  const text = files.map((f) => fileBlock(f.path, f.content)).join("\n");
  if (!index.length) return text;
  const how = tools
    ? "Read any of them with read_files before changing them."
    : "They can't be changed in this request (you may still create new files or delete files).";
  return `${text}\n\nOther files in this app, not shown above. ${how}\n${index.map((p) => indexLine(p, manifest[p]!)).join("\n")}`;
}
