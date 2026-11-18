/**
 * The probe (docs/plans/hl-resource-registry.md §8): checks a resource's registry entry against the real HighLevel
 * sandbox, through the local proxy, before the resource ships.
 *
 *   firebase emulators:start   (and a local account connected to the HighLevel sandbox)
 *   npm run hl:probe -- <resource> --email <local account>
 *
 * For every read of the resource it: calls the endpoint through the proxy (so the registry's path, version and
 * location handling are what's tested); pages each list to its end with the declared strategy, checking for
 * duplicates, a stop and the declared total; saves the first response, anonymized, as a test fixture
 * (hl-resources/fixtures/<resource>/<endpoint>.json); and compares the fields the guide documents with the fields
 * HighLevel returned. Writes are listed, never called: verify them by hand on a record tagged genesis-test.
 * Emulators only; it never prints tokens or record contents.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT ??= "genesisaibuilder";

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the emulator settings above */
const { db } = require("../admin") as typeof import("../admin");
const { getAuth } = require("firebase-admin/auth") as typeof import("firebase-admin/auth");
const { RESOURCES } = require("../hl/registry") as typeof import("../hl/registry");
/* eslint-enable @typescript-eslint/no-require-imports */
type Endpoint = (typeof RESOURCES)[number]["endpoints"][number];
type Pager = NonNullable<Endpoint["pager"]>;

const FN = `http://127.0.0.1:5001/${process.env.GCLOUD_PROJECT}/us-central1`;
const ROOT = join(__dirname, "..", "..", "..", "hl-resources");
const PAGE = 5; // small pages, so walking a list to its end shows how it stops
const MAX_PAGES = 40;

type Json = Record<string, unknown>;
const get = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v == null ? undefined : (v as Json)[k]), obj);
const asRecords = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => !!x && typeof x === "object") : []);

// ---- Anonymized fixtures: the shape of a real response, without anyone's data ----

const PERSONAL = /name|email|phone|address|city|street|body|message|text|title|note|subject|html|description|source|company|website|url|tag/i;
const ENUM = /^[A-Za-z][A-Za-z_-]{0,30}$/;

/** Ids become stable fakes; personal and free text is replaced; enums, numbers, booleans and dates stay. */
export function anonymize(value: unknown, key = "", ids = new Map<string, string>()): unknown {
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => anonymize(v, key, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, anonymize(v, k, ids)]));
  if (typeof value !== "string") return value;
  if (/(^id$|Id$|Ids$)/.test(key)) {
    if (!ids.has(value)) ids.set(value, `id-${ids.size + 1}`);
    return ids.get(value);
  }
  if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+([+-]\d{2}:?\d{2}|Z)?)?$/.test(value) || /^\d+$/.test(value)) return value;
  if (!PERSONAL.test(key) && ENUM.test(value)) return value;
  return "redacted";
}

/** Every key in a response, at any depth (arrays look at their first items). */
function keysOf(value: unknown, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 4 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) { value.slice(0, 5).forEach((v) => keysOf(v, out, depth + 1)); return out; }
  for (const [k, v] of Object.entries(value)) { out.add(k); keysOf(v, out, depth + 1); }
  return out;
}

// ---- Strategies: the client's pagination, as the probe follows it (frontend/src/sandbox/genesis/hl.js) ----

function nextPage(p: Pager, data: unknown, items: Json[], limit: number, prev: Json | null, total: unknown): { cursor: Json | null; more: (shown: number) => boolean } {
  switch (p.strategy) {
    case "cursorFields": {
      const cursor = Object.fromEntries(Object.entries(p.cursor ?? {}).map(([param, path]) => [param, get(data, path)]));
      return { cursor, more: () => items.length === limit && !!Object.values(cursor)[0] };
    }
    case "lastItem": {
      const last = items.at(-1);
      const value = last ? (p.from ?? []).map((path) => get(last, path)).find((v) => v !== undefined && v !== null) : undefined;
      return { cursor: last ? { [p.param!]: value } : prev, more: (shown) => items.length === limit && (total == null || shown < Number(total)) };
    }
    case "token":
      return { cursor: { [p.param!]: get(data, p.token!) }, more: () => get(data, p.hasNext!) === true && items.length > 0 };
    case "page": {
      const param = p.param ?? "page";
      return { cursor: { [param]: Number(prev?.[param] ?? 1) + 1 }, more: () => items.length === limit };
    }
  }
}

// ---- The run ----

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith("--"));
  const email = args[args.indexOf("--email") + 1];
  const resource = RESOURCES.find((r) => r.id === id);
  if (!resource || !args.includes("--email") || !email) {
    console.error(`usage: npm run hl:probe -- <${RESOURCES.filter((r) => !r.internal).map((r) => r.id).join("|")}> --email <local account connected to HighLevel>`);
    process.exit(2);
  }

  // A throwaway app and a preview token for the local account, exactly as the preview gets one.
  const uid = (await getAuth().getUserByEmail(email)).uid;
  const signIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=probe`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: await getAuth().createCustomToken(uid), returnSecureToken: true }),
  });
  const { idToken } = (await signIn.json()) as { idToken: string };
  const app = db.collection("projects").doc();
  await app.set({ ownerId: uid, name: "HighLevel probe", description: "probe", kind: "user", category: "other", icon: null, locationId: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
  const failures: string[] = [];
  try {
    const tokenRes = await fetch(`${FN}/api/projects/${app.id}/preview-token`, { method: "POST", headers: { Authorization: `Bearer ${idToken}` } });
    if (!tokenRes.ok) throw new Error(`No preview token (${tokenRes.status}): is ${email} connected to HighLevel?`);
    const { token } = (await tokenRes.json()) as { token: string };
    const proxy = async (path: string, params: Json) => {
      const url = new URL(`${FN}/hlProxy${path}`);
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      return { status: res.status, data: (await res.json().catch(() => ({}))) as Json };
    };

    // Records seen so far, by the path that returned them: placeholders ({contactId}) are filled from them.
    const seen: { path: string; records: Json[] }[] = [];
    const resolve = (name: string): string | undefined => {
      const base = name.replace(/Ids?$/, "").toLowerCase();
      for (const { records } of seen) for (const r of records) if (typeof r[name] === "string") return r[name] as string;
      const lists = seen.filter((s) => s.path.split("/")[1]?.toLowerCase().startsWith(base) && !s.path.includes("{")).sort((a, b) => a.path.length - b.path.length);
      for (const { records } of lists) {
        const r = records.find((x) => x.isActive !== false && typeof x.id === "string") ?? records.find((x) => typeof x.id === "string");
        if (r) return r.id as string;
      }
      return undefined;
    };
    const fill = (value: string) => value
      .replace(/^now([+-]\d+)d$/, (_, d) => String(Date.now() + Number(d) * 86_400_000))
      .replace(/^now$/, String(Date.now()))
      .replace(/^\{(\w+)\}$/, (_, k) => resolve(k) ?? `(no ${k} found)`);

    const guide = (() => { try { return readFileSync(join(ROOT, `${resource.id}.md`), "utf8"); } catch { return ""; } })();
    // Reads without placeholders first: they provide the ids the others need.
    const reads = resource.endpoints.filter((e) => e.method === "GET").sort((a, b) => Number(a.path.includes("{")) - Number(b.path.includes("{")));
    console.log(`\n${resource.label ?? resource.id}: ${reads.length} reads, version ${resource.version}\n`);
    for (const e of reads) {
      const path = e.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(resolve(k) ?? `missing-${k}`));
      const params: Json = Object.fromEntries(Object.entries(e.probe ?? {}).map(([k, v]) => [k, fill(v)]));
      if (e.pager) params.limit = PAGE;
      const first = await proxy(path, params);
      if (first.status !== 200) {
        const err = (first.data.error ?? {}) as { code?: string; message?: string };
        failures.push(`${e.name}: ${first.status} ${err.code ?? ""} ${err.message ?? ""}`.trim());
        console.log(`FAIL ${e.name.padEnd(22)} ${first.status} ${err.code ?? ""}: ${err.message ?? ""}`);
        continue;
      }
      const records = e.pager ? asRecords(get(first.data, e.pager.items)) : asRecords(e.unwrap ? first.data[e.unwrap] : Object.values(first.data).find(Array.isArray));
      seen.push({ path: e.path, records });
      let line = `OK   ${e.name.padEnd(22)} 200 keys: ${Object.keys(first.data).filter((k) => k !== "traceId").join(", ")}`;

      if (e.pager) {
        // Walk to the end with the declared strategy.
        const ids = new Set<string>();
        let duplicates = 0;
        let data: unknown = first.data;
        let items = records;
        let cursor: Json | null = null;
        let pages = 1;
        let shown = 0;
        let total: unknown;
        for (;;) {
          for (const it of items) { const i = String(it.id ?? ""); if (i && ids.has(i)) duplicates++; ids.add(i); }
          shown += items.length;
          total = e.pager.total ? get(data, e.pager.total) : undefined;
          const next = nextPage(e.pager, data, items, PAGE, cursor, total);
          if (!next.more(shown) || pages >= MAX_PAGES) break;
          cursor = next.cursor;
          const page = await proxy(path, { ...params, ...cursor });
          if (page.status !== 200) { failures.push(`${e.name}: page ${pages + 1} failed (${page.status})`); break; }
          data = page.data;
          items = asRecords(get(data, e.pager.items));
          pages++;
        }
        const ended = pages < MAX_PAGES;
        line += `\n     list: ${shown} items in ${pages} pages, ${ended ? "stopped" : `NO STOP after ${MAX_PAGES} pages`}${total !== undefined ? `, total ${total}` : ""}${duplicates ? `, ${duplicates} DUPLICATES` : ""}`;
        if (!records.length) line += "\n     (empty list: seed demo data to check the shape and paging)";
        if (!ended) failures.push(`${e.name}: no end after ${MAX_PAGES} pages (check the strategy and its end rule)`);
        if (duplicates) failures.push(`${e.name}: ${duplicates} duplicate items across pages (check the cursor)`);
        if (ended && total !== undefined && Number(total) !== shown) line += `\n     note: total ${total} but ${shown} listed (fine if the data changed meanwhile)`;
      }

      // Fixture: the first response, anonymized.
      mkdirSync(join(ROOT, "fixtures", resource.id), { recursive: true });
      writeFileSync(join(ROOT, "fixtures", resource.id, `${e.name}.json`), `${JSON.stringify(anonymize(first.data), null, 2)}\n`);

      // The guide's documented fields against what came back (warnings: fields can be optional).
      // Only the endpoint's own lines (`GET <path>` exactly), and only what follows the path.
      const doc = guide.split("\n").filter((l) => l.includes(`\`GET ${e.path}\``)).map((l) => l.split(`\`GET ${e.path}\``)[1] ?? "").join(" ");
      const documented = [...new Set([...(doc.match(/\{[^`]*\}/g) ?? []).join(" ").matchAll(/\b([a-zA-Z_]\w*)\b(?=\s*[,:}(])/g)].map((m) => m[1]!))];
      const returned = keysOf(first.data);
      const missing = documented.filter((f) => !returned.has(f));
      if (!doc) line += "\n     the guide doesn't document this endpoint's shape";
      else if (!records.length && returned.size <= 2) line += "\n     no records returned: seed demo data to compare the guide with real fields";
      else if (missing.length) line += `\n     guide documents, not returned here: ${missing.join(", ")} (fine if optional)`;
      console.log(line);
    }
    const writes = resource.endpoints.filter((e) => e.method !== "GET");
    if (writes.length) console.log(`\nNot probed (writes change data): ${writes.map((w) => `${w.method} ${w.path}`).join(", ")}. Verify by hand on a record tagged genesis-test.`);
  } finally {
    await app.delete();
  }
  console.log(failures.length ? `\n${failures.length} problem(s):\n- ${failures.join("\n- ")}` : `\nAll reads passed. Fixtures in hl-resources/fixtures/${resource.id}/.`);
  process.exit(failures.length ? 1 : 0);
}

if (require.main === module) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
