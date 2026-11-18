import type { Manifest } from "../files";
import { checkDesign, checkFile, checkImports } from "./checkCode";
import { SINGLE_FILE_LIMIT_CHARS } from "./prompt";
import { checkContent, checkPath, ENTRY_FILES, type FileOp } from "./validate";

/**
 * The build's working copy: the app's files as the model's tool calls change them. Every call is checked when it
 * runs and answered with a result the model reads (a short confirmation, or the reason it was refused), so the
 * model can correct a refused change within the same build. Nothing is persisted here: `ops()` is applied once at
 * the end of the build, as one snapshot.
 *
 * Rules: paths and content as in validate.ts; an existing file can be rewritten, edited or deleted only after the
 * model was given its content (sent in full, read with read_files, or written in this build), so a file left out
 * of the context is never overwritten blindly; entry files can't be deleted; a file that doesn't compile is refused
 * (checkCode.ts). `problems()` checks imports across the app once a response's changes are all in.
 */
export type ToolResult = { content: string; isError: boolean };

export function createWorkspace(manifest: Manifest) {
  /** Content the model has been given or has written, by path. */
  const known = new Map<string, string>();
  /** Net changes by path, in the order first touched. */
  const changes = new Map<string, FileOp>();
  const exists = (path: string) => {
    const c = changes.get(path);
    return c ? c.type === "write" : Boolean(manifest[path]);
  };
  const notShown = (path: string) => manifest[path] && !known.has(path) && !changes.has(path)
    ? manifest[path]!.size > SINGLE_FILE_LIMIT_CHARS
      ? `${path} is too large for the AI to change; leave it as it is`
      : `you haven't been shown ${path}: read it with read_files first`
    : null;
  const fail = (content: string): ToolResult => ({ content, isError: true });

  function put(path: string, content: string) {
    changes.delete(path); // re-insert so the order follows the latest change
    changes.set(path, { type: "write", path, content });
    known.set(path, content);
  }

  return {
    /** Records content the model was given (context sent in full, read_files results). */
    show(path: string, content: string) {
      known.set(path, content);
    },
    /** Whether the model has the file's content (given, read or written in this build). */
    shown(path: string): boolean {
      return known.has(path);
    },
    write(path: string, content: string): ToolResult {
      const bad = checkPath(path) ?? notShown(path) ?? checkContent(content);
      if (bad) return fail(`Not saved: ${bad}.`);
      const broken = checkFile(path, content);
      if (broken) return fail(`Not saved: ${path} doesn't compile: ${broken}. Fix it and write the whole file again.`);
      const created = !exists(path);
      put(path, content);
      return { content: `${created ? "Created" : "Saved"} ${path} (${Buffer.byteLength(content)} bytes).`, isError: false };
    },
    edit(path: string, oldText: string, newText: string): ToolResult {
      const bad = checkPath(path) ?? (exists(path) ? notShown(path) : `${path} does not exist; create it with write_file`);
      if (bad) return fail(`Not changed: ${bad}.`);
      const current = known.get(path)!;
      if (!oldText) return fail("Not changed: old_text is empty; to replace the whole file use write_file.");
      const at = current.indexOf(oldText);
      if (at < 0) return fail(`Not changed: old_text was not found in ${path}. Copy it exactly from the current file, including whitespace.`);
      if (current.indexOf(oldText, at + 1) >= 0) return fail(`Not changed: old_text appears more than once in ${path}; include more surrounding lines so it is unique.`);
      const next = current.slice(0, at) + newText + current.slice(at + oldText.length);
      const badContent = checkContent(next);
      if (badContent) return fail(`Not changed: ${badContent}.`);
      const broken = checkFile(path, next);
      if (broken) return fail(`Not changed: after this edit ${path} wouldn't compile: ${broken}. The file is unchanged; fix the edit.`);
      put(path, next);
      return { content: `Edited ${path}.`, isError: false };
    },
    remove(path: string): ToolResult {
      const bad = checkPath(path)
        ?? (ENTRY_FILES.includes(path) ? `${path} is an entry file and can't be deleted` : null)
        ?? (exists(path) ? null : `${path} does not exist`);
      if (bad) return fail(`Not deleted: ${bad}.`);
      changes.delete(path);
      known.delete(path);
      // A file created in this build and deleted again leaves nothing to do.
      if (manifest[path]) changes.set(path, { type: "delete", path });
      return { content: `Deleted ${path}.`, isError: false };
    },
    /** The current content of a file the build wrote (for the editor). */
    content(path: string): string | undefined {
      const c = changes.get(path);
      return c?.type === "write" ? c.content : undefined;
    },
    /**
     * Problems the build's changes leave in the app: imports in files it wrote, in src/main.js, and in other files that
     * import a file it deleted; in apps on Element Plus, the design standard's rules (checkDesign). One line per
     * problem, "path: problem".
     */
    problems(): string[] {
      const out: string[] = [];
      for (const op of changes.values()) {
        if (op.type === "write") out.push(...checkImports(op.path, op.content, exists).map((p) => `${op.path}: ${p}`));
      }
      // src/main.js is always in the context: an unchanged one is checked too (it must set up the UI).
      const main = "src/main.js";
      if (!changes.has(main) && known.has(main)) out.push(...checkImports(main, known.get(main)!, exists).map((p) => `${main}: ${p}`));
      // Apps on Element Plus follow the design standard; apps with their own CSS or on the older kit keep theirs.
      const entry = changes.get(main);
      const mainCode = entry?.type === "write" ? entry.content : known.get(main) ?? "";
      if (/genesis\/setup(\.js)?["']/.test(mainCode)) {
        for (const op of changes.values()) {
          if (op.type === "write") out.push(...checkDesign(op.path, op.content).map((p) => `${op.path}: ${p}`));
        }
      }
      const deleted = [...changes.values()].filter((o) => o.type === "delete").map((o) => o.path);
      if (deleted.length) {
        for (const [path, entry] of Object.entries(manifest)) {
          if (changes.has(path)) continue;
          for (const target of entry.imports) {
            const gone = deleted.find((d) => [d, d.replace(/\.(vue|js|ts)$/, ""), d.replace(/\/index\.(js|ts)$/, "")].includes(target));
            if (gone && !exists(gone)) out.push(`${path}: imports ${gone}, which this change deletes`);
          }
        }
      }
      return out;
    },
    /** The net changes to persist, in order. */
    ops(): FileOp[] {
      return [...changes.values()];
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
