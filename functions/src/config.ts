import { defineSecret, defineString } from "firebase-functions/params";

export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const HL_CLIENT_ID = defineSecret("HL_CLIENT_ID");
export const HL_CLIENT_SECRET = defineSecret("HL_CLIENT_SECRET");
export const PREVIEW_TOKEN_SECRET = defineSecret("PREVIEW_TOKEN_SECRET");

export const ANTHROPIC_MODEL = defineString("ANTHROPIC_MODEL");
export const ANTHROPIC_SUMMARY_MODEL = defineString("ANTHROPIC_SUMMARY_MODEL", { default: "claude-haiku-5-5" });
export const HL_REDIRECT_URI = defineString("HL_REDIRECT_URI");
export const APP_URL = defineString("APP_URL");
/** Where project files live: `firestore` (one document per file, the original) or `blobs` (Cloud Storage + manifest). */
export const FILE_STORE = defineString("FILE_STORE", { default: "firestore" });
/**
 * `on` (default): large apps get a file index and the read_files tool (llm/tools.ts). `off` is a kill switch: files
 * left out are only listed, and changes to them are rejected by the unread-file guard.
 */
export const CONTEXT_TOOLS = defineString("CONTEXT_TOOLS", { default: "on" });
/** Build traces to Langfuse: `langfuse` (needs the two LANGFUSE_* secrets) or `off` (default). */
export const TRACING = defineString("TRACING", { default: "off" });
/** Langfuse region: https://cloud.langfuse.com (EU, default) or https://us.cloud.langfuse.com (US). */
export const LANGFUSE_BASE_URL = defineString("LANGFUSE_BASE_URL", { default: "https://cloud.langfuse.com" });
export const LANGFUSE_PUBLIC_KEY = defineSecret("LANGFUSE_PUBLIC_KEY");
export const LANGFUSE_SECRET_KEY = defineSecret("LANGFUSE_SECRET_KEY");
/** The daily cleanup of unreferenced file content: `dry-run` (default) only logs, `delete` deletes. */
export const BLOB_CLEANUP = defineString("BLOB_CLEANUP", { default: "dry-run" });
/**
 * Read scopes in the proxy: `log` (default) logs a read whose scope the connection lacks and still serves it;
 * `enforce` refuses it with hl_scope_missing. Writes always need their scope. Switch to `enforce` once the
 * `hl.read_scope_missing` logs stay clean.
 */
/** Variant builds (docs/plans/build-variants.md): `on` lets a new app be built as 4 versions, 2 offered; `off` (default) refuses them. */
export const VARIANTS = defineString("VARIANTS", { default: "off" });
/**
 * The model and effort of each variant build version, comma-separated `model:effort` (effort: low, medium, high,
 * xhigh, max). Which prompt gets which setting rotates per build (assignBuilds in llm/variants.ts).
 */
export const VARIANT_BUILDS = defineString("VARIANT_BUILDS", {
  default: "claude-sonnet-5-5:medium,claude-sonnet-5-5:high,claude-opus-5-5:medium,claude-opus-5-5:high",
});
/** The model that scores a variant build's versions for quality (llm/rubric.md). */
export const GRADER_MODEL = defineString("GRADER_MODEL", { default: "claude-haiku-5-5" });
/** The model that reviews each version's security (llm/security.md): a gate, so the stronger model. */
export const SECURITY_MODEL = defineString("SECURITY_MODEL", { default: "claude-sonnet-5-5" });
export const READ_SCOPES = defineString("READ_SCOPES", { default: "log" });

/**
 * Browser origins allowed to call api, generate and hlAuthStart: the app's Firebase Hosting domains and the
 * Vite dev server. hlProxy stays open to any origin, because generated apps run on Sandpack's origin.
 */
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "";
export const APP_ORIGINS: (string | RegExp)[] = [
  `https://${PROJECT_ID}.web.app`,
  `https://${PROJECT_ID}.firebaseapp.com`,
  /^http:\/\/(localhost|127\.0\.0\.1):5173$/,
];

export const HL_API_BASE = "https://services.leadconnectorhq.com";
// The OAuth scopes are derived from the resource registry: HL_SCOPES in hl/registry.ts.
