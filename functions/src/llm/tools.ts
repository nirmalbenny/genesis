import type Anthropic from "@anthropic-ai/sdk";
import type { Manifest, ProjectFile } from "../files";
import { FILE_BUDGET_CHARS, SINGLE_FILE_LIMIT_CHARS } from "./prompt";
import { fileBlock } from "./format";
import { checkPath } from "./validate";

/**
 * read_files: lets the model read files listed in the context index (llm/context.ts) before changing them.
 * The definition is frozen and identical for every build: tools come first in the prompt, so any variation
 * would break the shared prompt cache (see prompt.test.ts). Inputs are tiny, so eager input streaming stays off
 * and the API validates them against the schema; runReadFiles validates again.
 */
export const MAX_READ_PATHS = 5;

const deepFreeze = <T>(o: T): T => {
  Object.values(o as object).forEach((v) => v && typeof v === "object" && deepFreeze(v));
  return Object.freeze(o);
};

export const READ_FILES_TOOL: Anthropic.Tool = deepFreeze({
  name: "read_files",
  description:
    "Returns the full content of files of this app that are listed under \"Other files\" but not shown. Read every " +
    "file you will change, and the files you need to understand, before writing any output. Ask for all of them in " +
    `one call (at most ${MAX_READ_PATHS} paths); you can make at most two calls.`,
  input_schema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_READ_PATHS,
        description: "Project paths exactly as listed, e.g. \"src/components/ContactList.vue\".",
      },
    },
    required: ["paths"],
    additionalProperties: false,
  },
});

export type ReadResult = { content: string; is_error: boolean; read: string[] };

/**
 * Runs one read_files call. Valid, existing, not-too-large files are returned (within the context budget) and
 * added to `seen`, which allows the model to rewrite them. Every other path gets a one-line reason; the result is
 * an error only when nothing could be returned.
 */
export async function runReadFiles(
  input: unknown,
  manifest: Manifest,
  read: (paths: string[]) => Promise<ProjectFile[]>,
  seen: Set<string>,
): Promise<ReadResult> {
  const paths = (input as { paths?: unknown } | null)?.paths;
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== "string")) {
    return { content: 'Invalid input: expected {"paths": ["src/…", …]}.', is_error: true, read: [] };
  }
  const notes: string[] = [];
  const wanted: string[] = [];
  let budget = FILE_BUDGET_CHARS;
  for (const p of [...new Set(paths as string[])]) {
    const entry = manifest[p];
    const pathError = checkPath(p);
    if (wanted.length >= MAX_READ_PATHS) notes.push(`${p}: not read (at most ${MAX_READ_PATHS} files per call)`);
    else if (pathError) notes.push(`${p}: ${pathError}`);
    else if (!entry) notes.push(`${p}: no such file`);
    else if (seen.has(p)) notes.push(`${p}: already shown in full above`);
    else if (entry.size > SINGLE_FILE_LIMIT_CHARS) notes.push(`${p}: too large to read or edit (${entry.size} bytes)`);
    else if (entry.size > budget) notes.push(`${p}: not read (this call's size limit); ask for it in another call`);
    else { wanted.push(p); budget -= entry.size; }
  }
  const files = await read(wanted);
  for (const f of files) seen.add(f.path);
  const parts = files.map((f) => fileBlock(f.path, f.content));
  if (notes.length) parts.push(notes.join("\n"));
  return { content: parts.join("\n") || "Nothing to read.", is_error: files.length === 0, read: files.map((f) => f.path) };
}
