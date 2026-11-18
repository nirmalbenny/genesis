export type FileOp =
  | { type: "write"; path: string; content: string }
  | { type: "delete"; path: string };

export type Rejection = { path: string; reason: string };

export const MAX_FILE_BYTES = 100_000;
export const ENTRY_FILES = ["src/main.js", "src/App.vue"];
const SYSTEM_OWNED = new Set(["src/hl.config.js", "package.json"]);
// Injected by the preview (src/genesis/hl.js, the HighLevel client); reserved as a whole for future system files.
const SYSTEM_DIR = "src/genesis/";
const ALLOWED_EXT = /\.(vue|ts|js|css|json)$/;

/** Returns an error message, or null when the path is acceptable. */
export function checkPath(path: string): string | null {
  if (!path || path.startsWith("/") || path.includes("\\")) return "path must be relative";
  if (path.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) return "path must not contain '..' or empty segments";
  if (SYSTEM_OWNED.has(path) || path.startsWith(SYSTEM_DIR)) return "path is system-owned";
  if (!path.startsWith("src/")) return "path must be inside src/";
  if (!ALLOWED_EXT.test(path)) return "extension not allowed (.vue .ts .js .css .json)";
  return null;
}

/** Returns an error message for file content that can't be saved, or null. */
export function checkContent(content: string): string | null {
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) return `file exceeds ${MAX_FILE_BYTES} bytes`;
  if (!content.trim()) return "file is empty";
  return null;
}
