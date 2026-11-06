export type FileOp =
  | { type: "write"; path: string; content: string }
  | { type: "delete"; path: string };

export type Rejection = { path: string; reason: string };

export const MAX_FILE_BYTES = 100_000;
export const ENTRY_FILES = ["src/main.js", "src/App.vue"];
const SYSTEM_OWNED = new Set(["src/hl.config.js", "package.json"]);
const ALLOWED_EXT = /\.(vue|ts|js|css|json)$/;

/** Returns an error message, or null when the path is acceptable. */
export function checkPath(path: string): string | null {
  if (!path || path.startsWith("/") || path.includes("\\")) return "path must be relative";
  if (path.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) return "path must not contain '..' or empty segments";
  if (SYSTEM_OWNED.has(path)) return "path is system-owned";
  if (!path.startsWith("src/")) return "path must be inside src/";
  if (!ALLOWED_EXT.test(path)) return "extension not allowed (.vue .ts .js .css .json)";
  return null;
}

/**
 * Validates ops against the current file set. Invalid ops are rejected individually so valid ones survive.
 * A delete that would remove an entry file is rejected unless the same batch rewrites it.
 */
export function validateOps(ops: FileOp[], existing: Set<string>): { valid: FileOp[]; rejected: Rejection[] } {
  const valid: FileOp[] = [];
  const rejected: Rejection[] = [];
  const written = new Set(ops.filter((o) => o.type === "write").map((o) => o.path));

  for (const op of ops) {
    const pathError = checkPath(op.path);
    if (pathError) { rejected.push({ path: op.path, reason: pathError }); continue; }
    if (op.type === "write") {
      if (Buffer.byteLength(op.content) > MAX_FILE_BYTES) {
        rejected.push({ path: op.path, reason: `file exceeds ${MAX_FILE_BYTES} bytes` });
        continue;
      }
      if (!op.content.trim()) { rejected.push({ path: op.path, reason: "file is empty" }); continue; }
    } else if (ENTRY_FILES.includes(op.path) && !written.has(op.path)) {
      rejected.push({ path: op.path, reason: "entry file cannot be deleted" });
      continue;
    } else if (!existing.has(op.path)) {
      rejected.push({ path: op.path, reason: "file to delete does not exist" });
      continue;
    }
    valid.push(op);
  }
  return { valid, rejected };
}
