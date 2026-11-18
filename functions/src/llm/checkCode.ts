import { babelParse, compileScript, compileTemplate, parse, type BindingMetadata } from "@vue/compiler-sfc";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { endpointNames, listNames, RESOURCES } from "../hl/registry";
import { CLIENT_FUNCTIONS } from "./guides";

/**
 * Checks generated code before it's saved, with the same Vue compiler the editor's preview builds on. Two levels:
 * - checkFile: one file on its own (it compiles; no feature the preview's older compiler lacks; every component its
 *   template uses is imported). A file that fails is refused, and the model is told why.
 * - checkImports: a file against the app (relative imports resolve; names imported from the injected client and
 *   components exist; no npm package but vue). Run after all of a response's calls, because files written later in
 *   the same response can satisfy an import. src/main.js must also load the UI kit's styles.
 * Errors are written for the model: what is wrong, where, and what to do instead.
 */

// What the preview injects (src/genesis/, src/hl.config.js), read from the same documents the model is given;
// frontend tests keep both in sync with the injected code (ui.test.ts, hl.test.ts).
const uiKit = readFileSync(join(__dirname, "uiKit.md"), "utf8");
const COMPONENTS = new Set([...uiKit.matchAll(/`([A-Z]\w+)`/g)].map((m) => m[1]!));
// The client's functions as the reference documents them (the core and every resource guide).
const CLIENT = new Set([...CLIENT_FUNCTIONS, "usePager", "LOCATION_ID", "LOCATION_NAME"]);
// What usePager('…') and call('…') accept: the registry's lists and endpoints.
const LISTS = listNames(RESOURCES);
const CALLS = endpointNames(RESOURCES);
const CONFIG = new Set(["HL_PROXY", "PREVIEW_TOKEN", "LOCATION_ID", "LOCATION_NAME"]);
const BUILT_IN = new Set(["Transition", "TransitionGroup", "KeepAlive", "Teleport", "Suspense", "Component", "RouterView", "RouterLink"]);
const PACKAGES = new Set(["vue"]);
const EXTENSIONS = ["", ".vue", ".js", ".ts", "/index.js", "/index.ts"];

const at = (line: number | undefined) => (line ? ` (line ${line})` : "");
/** A compiler message without its tool prefix and position (the line is added from the error's location). */
const clean = (message: string) => message.split("\n")[0]!.replace(/^\[vue\/compiler-sfc\]\s*/, "").replace(/\s*\(\d+:\d+\)$/, "");

/** Features the preview's Vue compiler (vue-cli template) doesn't support, with what to use instead. */
const UNSUPPORTED: [RegExp, string][] = [
  [/\bdefineOptions\s*\(/, "defineOptions isn't supported by the preview; put the options in a separate <script> block: export default { inheritAttrs: false }"],
  [/\bdefineModel\s*(<[^>]*>)?\s*\(/, "defineModel isn't supported by the preview; use a modelValue prop and emit('update:modelValue', value)"],
  [/\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:withDefaults\s*\(\s*)?defineProps\b/, "destructuring defineProps isn't supported by the preview; use const props = defineProps(…) and props.name"],
];

/** Problems with one file on its own, or null when it compiles. */
export function checkFile(path: string, content: string): string | null {
  try {
    if (path.endsWith(".vue")) return checkVue(path, content);
    if (/\.(js|ts)$/.test(path)) {
      babelParse(content, { sourceType: "module", plugins: path.endsWith(".ts") ? ["typescript"] : [] });
    } else if (path.endsWith(".json")) JSON.parse(content);
    return null;
  } catch (e) {
    const err = e as Error & { loc?: { line: number } };
    return `${clean(err.message)}${at(err.loc?.line)}`;
  }
}

function checkVue(path: string, content: string): string | null {
  const { descriptor, errors } = parse(content, { filename: path });
  if (errors.length) {
    const e = errors[0] as Error & { loc?: { start: { line: number } } };
    return `${e.message}${at(e.loc?.start.line)}`;
  }
  if (!descriptor.template && !descriptor.script && !descriptor.scriptSetup) return "no <template> or <script> block";
  const setup = descriptor.scriptSetup?.content ?? "";
  for (const [re, message] of UNSUPPORTED) if (re.test(setup)) return message;
  let bindings: BindingMetadata | undefined;
  if (descriptor.script || descriptor.scriptSetup) {
    try {
      bindings = compileScript(descriptor, { id: "check" }).bindings;
    } catch (e) {
      const err = e as Error & { loc?: { line: number } };
      const offset = (descriptor.scriptSetup ?? descriptor.script)!.loc.start.line - 1;
      return `${clean(err.message)}${at(err.loc?.line ? err.loc.line + offset : undefined)}`;
    }
  }
  if (descriptor.template) {
    const t = compileTemplate({ source: descriptor.template.content, filename: path, id: "check", compilerOptions: { bindingMetadata: bindings } });
    if (t.errors.length) {
      const e = t.errors[0] as Error & { loc?: { start: { line: number } } };
      const line = e.loc?.start.line ? e.loc.start.line + descriptor.template.loc.start.line - 1 : undefined;
      return `${typeof e === "string" ? e : e.message}${at(line)}`;
    }
    // Without an options-API <script> (which may register components itself), every component the template uses
    // must be imported in <script setup>, or it renders as an unknown element.
    if (!descriptor.script) {
      for (const m of descriptor.template.content.matchAll(/<([A-Z]\w*)/g)) {
        const name = m[1]!;
        if (!BUILT_IN.has(name) && !(name in (bindings ?? {}))) return `the template uses <${name}> but the script doesn't import it`;
      }
    }
  }
  return null;
}

/** The import statements of a file's script: source and imported names. */
function importsOf(path: string, content: string): { source: string; names: string[] }[] {
  let code = content;
  let ts = path.endsWith(".ts");
  if (path.endsWith(".vue")) {
    const { descriptor } = parse(content, { filename: path });
    code = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join("\n");
    ts = [descriptor.script?.lang, descriptor.scriptSetup?.lang].includes("ts");
  } else if (!/\.(js|ts)$/.test(path)) return [];
  const out: { source: string; names: string[] }[] = [];
  for (const node of babelParse(code, { sourceType: "module", plugins: ts ? ["typescript"] : [] }).program.body) {
    if (node.type !== "ImportDeclaration" && node.type !== "ExportNamedDeclaration" && node.type !== "ExportAllDeclaration") continue;
    if (!node.source) continue;
    const names = node.type === "ImportDeclaration"
      ? node.specifiers.flatMap((s) => (s.type === "ImportSpecifier" ? [s.imported.type === "Identifier" ? s.imported.name : s.imported.value] : []))
      : [];
    out.push({ source: node.source.value, names });
  }
  return out;
}

/** Whether a project path is one of the files the preview provides. */
function system(target: string): "hl" | "ui" | "config" | "css" | null {
  if (target === "src/hl.config.js" || target === "src/hl.config") return "config";
  if (target === "src/genesis/hl.js" || target === "src/genesis/hl") return "hl";
  if (target === "src/genesis/ui.css") return "css";
  if (target === "src/genesis/ui" || target === "src/genesis/ui/index.js") return "ui";
  if (target.startsWith("src/genesis/ui/") && COMPONENTS.has(posix.basename(target).replace(/\.vue$/, ""))) return "ui";
  return null;
}

/** Problems with a file's imports, given the paths the app will have; empty when they all resolve. */
export function checkImports(path: string, content: string, exists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  let imports;
  try {
    imports = importsOf(path, content);
  } catch {
    return []; // a syntax error is reported by checkFile
  }
  for (const { source, names } of imports) {
    if (!source.startsWith(".")) {
      if (!PACKAGES.has(source)) problems.push(`imports "${source}", but apps can only import vue (no other npm packages)`);
      continue;
    }
    const target = posix.normalize(posix.join(posix.dirname(path), source));
    const kind = system(target);
    if (kind === "hl" || kind === "config") {
      const known = kind === "hl" ? CLIENT : CONFIG;
      const missing = names.filter((n) => !known.has(n));
      if (missing.length) problems.push(`imports ${missing.join(", ")} from "${source}", which doesn't export ${missing.length > 1 ? "them" : "it"} (see "Client")`);
    } else if (kind === "ui") {
      const missing = names.filter((n) => !COMPONENTS.has(n));
      if (missing.length) problems.push(`imports ${missing.join(", ")} from "${source}", which ${missing.length > 1 ? "aren't Genesis components" : "isn't a Genesis component"}`);
    } else if (kind === null && !EXTENSIONS.some((ext) => exists(target + ext))) {
      problems.push(`imports "${source}", but ${target} doesn't exist`);
    }
  }
  // Without the kit's stylesheet every Genesis component renders unstyled.
  if (path === "src/main.js" && !imports.some(({ source }) => system(posix.normalize(posix.join("src", source))) === "css")) {
    problems.push(`doesn't import the UI kit's styles: add import "./genesis/ui.css"; before App`);
  }
  // The names passed to usePager and call must be lists and endpoints that exist (checked when they're imported).
  const fromClient = imports.filter(({ source }) => system(posix.normalize(posix.join(posix.dirname(path), source))) === "hl").flatMap((i) => i.names);
  const checks: [string, string[], string][] = [["usePager", LISTS, "list"], ["call", CALLS, "call"]];
  for (const [fn, known, what] of checks) {
    if (!fromClient.includes(fn)) continue;
    for (const m of content.matchAll(new RegExp(`\\b${fn}\\(\\s*['"\`]([\\w-]+)['"\`]`, "g"))) {
      if (!known.includes(m[1]!)) problems.push(`${fn}('${m[1]}') isn't a HighLevel ${what}; available: ${known.join(", ")}`);
    }
  }
  return problems;
}
