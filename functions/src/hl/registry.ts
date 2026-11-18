import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The HighLevel resource registry (docs/plans/hl-resource-registry.md): every resource generated apps can reach is
 * declared once, as data, in `hl-resources/<id>.json` at the repo root (copied into lib/ by the build). The OAuth
 * scopes and the proxy's routes are derived from it, so supporting a resource never means editing them by hand.
 * The files are a security boundary (the proxy's allowlist): they're validated strictly, and an invalid registry
 * fails the build and every function's start.
 */

export type Method = "GET" | "POST" | "PUT";
/** Where the proxy puts the connected sub-account: a query parameter, a body field, or nowhere (the token scopes it). */
export type Location = { in: "query" | "body"; name: string } | null;

export type Endpoint = {
  /** Unique across the registry: the name the client and the model use. */
  name: string;
  method: Method;
  /** A path template: literal segments and `{name}` placeholders; a trailing "/" is optional in requests. */
  path: string;
  /** The scope this endpoint needs. */
  scope: string;
  /** "query" / "body" (the parameter is `locationId`), { in, name } for another name, or "none". */
  location: "query" | "body" | "none" | { in: "query" | "body"; name: string };
  /** A message to a real person: tighter limits, SMS or Email only. */
  send?: boolean;
  /** Overrides the resource's `version`. */
  version?: string;
  /** A paginated list: `usePager(<name>)` in generated apps (see Pager). Reads only. */
  pager?: Pager;
  /** For `call(<name>)`: return this field of the response (`{ contact: … }` → the contact). */
  unwrap?: string;
  /**
   * Query values the probe (scripts/hl-probe.ts) sends to read this endpoint: "now", "now+7d", "now-30d", or
   * "{name}" for an id found in an earlier list (e.g. "{calendarId}"). Also documents what the endpoint requires.
   */
  probe?: Record<string, string>;
};

/**
 * How the injected client pages a list, as data. Paths are dot paths into HighLevel's response (`meta.total`,
 * `sort.0`). Strategies, implemented once in the client (frontend/src/sandbox/genesis/hl.js):
 * - cursorFields: send `cursor`'s fields from the response as parameters; stop on a short page or a missing cursor;
 * - lastItem: send `param` = the first of `from` found on the last item; stop on a short page or when `total` is reached;
 * - token: send `param` = the response's `token`; continue while `hasNext` is true;
 * - page: send `param` (default `page`) = 2, 3, …; stop on a short page.
 */
export type Pager = {
  strategy: "cursorFields" | "lastItem" | "token" | "page";
  items: string;
  total?: string;
  cursor?: Record<string, string>;
  param?: string;
  from?: string[];
  token?: string;
  hasNext?: string;
  /** Server-side search: the option `query` is sent as `param` from `min` characters. */
  search?: { param: string; min: number };
  /** Options passed through as query parameters under the same name. */
  options?: string[];
  /** Parameters always sent. */
  fixed?: Record<string, string>;
};

export type Resource = {
  id: string;
  /** Not shown to users or the model (e.g. the location lookup made when connecting). */
  internal?: boolean;
  label?: string;
  summary: string;
  aliases?: string[];
  /** Every scope to request for this resource; each endpoint's scope must be one of them. */
  scopes: string[];
  /** HighLevel's `Version` header for this resource's endpoints. */
  version: string;
  endpoints: Endpoint[];
};

/** A compiled endpoint, as the proxy uses it. */
export type Route = {
  name: string;
  resource: string;
  method: Method;
  path: RegExp;
  template: string;
  scope: string;
  write: boolean;
  send: boolean;
  version: string;
  location: Location;
  /** Literal segments, so a literal path wins over a placeholder (`/conversations/search` over `/conversations/{id}`). */
  literals: number;
};

const METHODS = ["GET", "POST", "PUT"];
const SEGMENT = /^(?:[A-Za-z0-9-]+|\{[A-Za-z]\w*\})$/;
const NAME = /^[A-Za-z]\w*$/;

/** Every problem in the registry, one line each; empty when it's valid. */
export function validateRegistry(resources: Resource[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const routes = new Set<string>();
  for (const r of resources) {
    const at = `hl-resources/${r.id}.json`;
    if (!r.id || !/^[a-z][a-z0-9-]*$/.test(r.id)) errors.push(`${at}: id must be lowercase letters, digits and dashes`);
    if (ids.has(r.id)) errors.push(`${at}: duplicate id`);
    ids.add(r.id);
    if (!r.summary) errors.push(`${at}: summary is required`);
    if (!r.internal && !r.label) errors.push(`${at}: label is required (or mark the resource internal)`);
    if (!Array.isArray(r.scopes) || !r.scopes.length) errors.push(`${at}: scopes must list at least one scope`);
    if (!r.version) errors.push(`${at}: version is required`);
    if (!Array.isArray(r.endpoints)) { errors.push(`${at}: endpoints must be a list`); continue; }
    for (const e of r.endpoints) {
      const where = `${at} ${e.name ?? "(unnamed)"}`;
      if (!e.name || !NAME.test(e.name)) errors.push(`${where}: name must be an identifier`);
      if (names.has(e.name)) errors.push(`${where}: name is already used by another endpoint`);
      names.add(e.name);
      if (!METHODS.includes(e.method)) errors.push(`${where}: method must be GET, POST or PUT (never DELETE)`);
      const segments = typeof e.path === "string" && e.path.startsWith("/") ? e.path.replace(/^\/|\/$/g, "").split("/") : [];
      if (!segments.length || segments.some((s) => !SEGMENT.test(s))) {
        errors.push(`${where}: path must be "/" + segments of letters, digits and dashes, or {placeholders}`);
      }
      if (!r.scopes?.includes(e.scope)) errors.push(`${where}: scope "${e.scope}" is not in the resource's scopes`);
      const write = e.method !== "GET";
      const loc = typeof e.location === "string" ? e.location : e.location?.in;
      if (!["query", "body", "none"].includes(String(loc))) errors.push(`${where}: location must be "query", "body", "none" or { in, name }`);
      else if (write && loc === "query") errors.push(`${where}: a write takes the location in the body or not at all`);
      else if (!write && loc === "body") errors.push(`${where}: a read takes the location as a query parameter or not at all`);
      if (typeof e.location === "object" && e.location && !NAME.test(e.location.name)) errors.push(`${where}: location name must be an identifier`);
      if (e.send && e.method !== "POST") errors.push(`${where}: only a POST can send a message`);
      if (e.unwrap !== undefined && (typeof e.unwrap !== "string" || !NAME.test(e.unwrap))) errors.push(`${where}: unwrap must be a field name`);
      if (e.pager) errors.push(...pagerProblems(e.pager, e.method).map((p) => `${where}: pager ${p}`));
      if (e.probe !== undefined && (typeof e.probe !== "object" || e.probe === null || Object.entries(e.probe).some(([k, v]) => !NAME.test(k) || typeof v !== "string"))) {
        errors.push(`${where}: probe must map parameter names to strings`);
      }
      const key = `${e.method} ${e.path?.replace(/\{\w+\}/g, "{}").replace(/\/$/, "")}`;
      if (routes.has(key)) errors.push(`${where}: another endpoint has the same method and path`);
      routes.add(key);
    }
  }
  return errors;
}

const PATH = /^[A-Za-z_]\w*(\.\w+)*$/;

/** Problems with a list's pager spec, one per line. */
function pagerProblems(p: Pager, method: string): string[] {
  const out: string[] = [];
  const isPath = (v: unknown) => typeof v === "string" && PATH.test(v);
  if (method !== "GET") out.push("is only for GET endpoints");
  if (!["cursorFields", "lastItem", "token", "page"].includes(p.strategy)) out.push("strategy must be cursorFields, lastItem, token or page");
  if (!isPath(p.items)) out.push("items must be a dot path into the response");
  if (p.total !== undefined && !isPath(p.total)) out.push("total must be a dot path");
  if (p.param !== undefined && !NAME.test(p.param)) out.push("param must be a parameter name");
  if (p.strategy === "cursorFields" && (!p.cursor || !Object.keys(p.cursor).length || Object.entries(p.cursor).some(([k, v]) => !NAME.test(k) || !isPath(v)))) {
    out.push("cursorFields needs cursor: { parameter: response path }");
  }
  if (p.strategy === "lastItem" && (!p.param || !Array.isArray(p.from) || !p.from.length || !p.from.every(isPath))) out.push("lastItem needs param and from: [item paths]");
  if (p.strategy === "token" && (!p.param || !isPath(p.token) || !isPath(p.hasNext))) out.push("token needs param, token and hasNext");
  if (p.search && (!NAME.test(p.search.param) || !Number.isInteger(p.search.min) || p.search.min < 0)) out.push("search needs param and a whole-number min");
  if (p.options && !(Array.isArray(p.options) && p.options.every((o) => NAME.test(o)))) out.push("options must be parameter names");
  if (p.fixed && Object.entries(p.fixed).some(([k, v]) => !NAME.test(k) || typeof v !== "string")) out.push("fixed must map parameter names to strings");
  return out;
}

/** Names generated apps can use: list kinds for usePager and endpoint names for call(). */
export const listNames = (resources: Resource[]): string[] => resources.flatMap((r) => r.endpoints.filter((e) => e.pager).map((e) => e.name));
export const endpointNames = (resources: Resource[]): string[] => resources.filter((r) => !r.internal).flatMap((r) => r.endpoints.map((e) => e.name));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The path pattern for a template: placeholders match one id segment; a trailing "/" is optional. */
export function pathPattern(template: string): RegExp {
  const optionalSlash = template.length > 1 && template.endsWith("/");
  const body = template.replace(/\/$/, "").split("/").map((s) => (/^\{\w+\}$/.test(s) ? "[\\w-]+" : escape(s))).join("\\/");
  return new RegExp(`^${body}${optionalSlash ? "\\/?" : ""}$`);
}

/** Compiles the registry's endpoints into routes, the most specific first. */
export function compileRoutes(resources: Resource[]): Route[] {
  return resources
    .flatMap((r) => r.endpoints.map((e): Route => {
      const loc = e.location;
      return {
        name: e.name,
        resource: r.id,
        method: e.method,
        path: pathPattern(e.path),
        template: e.path,
        scope: e.scope,
        write: e.method !== "GET",
        send: e.send === true,
        version: e.version ?? r.version,
        location: loc === "none" ? null : typeof loc === "string" ? { in: loc, name: "locationId" } : loc,
        literals: e.path.split("/").filter((s) => s && !s.startsWith("{")).length,
      };
    }))
    .sort((a, b) => b.literals - a.literals);
}

/** Reads `hl-resources/*.json` from `dir` (in lib/ after the build). */
export function loadRegistry(dir = join(__dirname, "..", "hl-resources")): Resource[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Resource);
}

export const RESOURCES = loadRegistry();
const problems = validateRegistry(RESOURCES);
if (problems.length) throw new Error(`Invalid HighLevel resource registry:\n${problems.join("\n")}`);

/** A resource's name for people ("Contacts"); its id when it has none. */
export const labelOf = (id: string): string => RESOURCES.find((r) => r.id === id)?.label ?? id;

/** Every resource's scopes: what connecting asks the user to grant. */
export const HL_SCOPES = [...new Set(RESOURCES.flatMap((r) => r.scopes))].join(" ");
export const ROUTES = compileRoutes(RESOURCES);
