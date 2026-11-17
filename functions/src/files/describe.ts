import crypto from "node:crypto";
import { posix } from "node:path";

/**
 * What a build needs to know about a file without reading it: its size, its component interface (props and
 * emits), what it imports and which HighLevel client helpers it uses. Stored in the manifest, so the context
 * index (llm/context.ts) and import-based ranking cost no extra reads. Regex-based on purpose (no parser
 * dependency): good enough for the small Vue files the builder writes, and wrong only in the index text.
 */
export type FileMeta = {
  size: number; // bytes
  lines: number;
  props: string[];
  emits: string[];
  /** Project files this file imports, as normalized paths (extension as written, possibly none). */
  imports: string[];
  /** Named imports from the injected HighLevel client (genesis/hl.js). */
  hlHelpers: string[];
};

/** Content address of a file: hex SHA-256 of its UTF-8 text. */
export const contentHash = (content: string) => crypto.createHash("sha256").update(content).digest("hex");

const MAX_ITEMS = 20; // keeps manifest entries small whatever the file contains

const unique = (xs: string[]) => [...new Set(xs)].slice(0, MAX_ITEMS);

/** The text between the bracket at `open` and its matching close (strings and nesting respected), or "". */
function balanced(src: string, open: number): string {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]", "<": ">" };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (pairs[c] && !(c === "<" && stack.length && stack[stack.length - 1] !== ">")) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return src.slice(open + 1, i);
    }
  }
  return "";
}

/** Keys at the top level of an object literal or type literal body ("a: String, b?: number, 'c-d': …"). */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let start = 0;
  const take = (part: string) => {
    const m = /^\s*(?:readonly\s+)?['"]?([\w$-]+)['"]?\s*\??\s*:/.exec(part);
    if (m) keys.push(m[1]!);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ("({[<".includes(c!)) depth++;
    else if (")}]".includes(c!) || (c === ">" && body[i - 1] !== "=")) depth--; // "=>" is an arrow, not a bracket
    else if (depth === 0 && (c === "," || c === ";" || c === "\n")) { take(body.slice(start, i)); start = i + 1; }
  }
  take(body.slice(start));
  return keys;
}

const strings = (s: string) => [...s.matchAll(/['"`]([\w:.-]+)['"`]/g)].map((m) => m[1]!);

/** Props or emits from `defineProps(…)` / `defineEmits(…)`: array, object and type-literal forms. */
function macroNames(src: string, macro: "defineProps" | "defineEmits"): string[] {
  const at = src.search(new RegExp(`\\b${macro}\\s*[<(]`));
  if (at < 0) return [];
  const bracket = src.indexOf(src.slice(at).match(/[<(]/)![0], at);
  const inner = balanced(src, bracket).trim();
  if (macro === "defineEmits") {
    // ['a', 'b'] | { (e: 'a', …): void } | { a: [id: string] } | { a: null }
    const literals = [...inner.matchAll(/\(\s*\w+\s*:\s*['"]([\w:.-]+)['"]/g)].map((m) => m[1]!);
    if (literals.length) return literals;
  }
  const body = inner.replace(/^withDefaults\s*\(/, "");
  if (body.startsWith("[")) return strings(body);
  if (body.startsWith("{")) return topLevelKeys(balanced(body, 0));
  return [];
}

export function describeFile(path: string, content: string): FileMeta {
  const imports: string[] = [];
  const hlHelpers: string[] = [];
  const dir = posix.dirname(path);
  for (const m of content.matchAll(/\bimport\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/g)) {
    const [, clause = "", spec = ""] = m;
    if (!spec.startsWith(".")) continue; // packages (vue) are not project files
    const target = posix.normalize(posix.join(dir, spec));
    if (target.startsWith("src/genesis/")) {
      // `import { usePager, contactName as name } from "../genesis/hl.js"`
      const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? "";
      if (target.startsWith("src/genesis/hl")) hlHelpers.push(...named.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]!).filter(Boolean));
      continue; // system files are not part of the project
    }
    imports.push(target);
  }
  // Emits are also used without defineEmits: $emit('select') in templates, emit('select') in scripts.
  const called = [...content.matchAll(/\$?\bemit\s*\(\s*['"]([\w:.-]+)['"]/g)].map((m) => m[1]!);
  return {
    size: Buffer.byteLength(content),
    lines: content ? content.split("\n").length : 0,
    props: unique(macroNames(content, "defineProps")),
    emits: unique([...macroNames(content, "defineEmits"), ...called]),
    imports: unique(imports),
    hlHelpers: unique(hlHelpers),
  };
}
