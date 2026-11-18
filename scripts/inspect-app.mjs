// Shows what a local app is made of and how its builds went: its files, what the code check says about them now,
// and each build (prompt, outcome, files written, tokens, credits, error, the reply shown in the chat). The first
// step when a generated app comes out wrong. Emulators only; run `cd functions && npm run build` first.
//
//   node scripts/inspect-app.mjs <app id | name | latest> [--email <owner>] [--builds <n>] [--file <path>]… [--all-files]
//
// --builds: how many recent builds to show (default 5). --file prints a file's content (repeatable); --all-files
// prints every file. Build traces: when TRACING=langfuse, the app's builds are one Langfuse session (id = app id).
import { parseArgs } from "node:util";
import { findApp, fnRequire } from "./lib/local.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { email: { type: "string" }, builds: { type: "string", default: "5" }, file: { type: "string", multiple: true, default: [] }, "all-files": { type: "boolean" } },
});
if (positionals.length !== 1) {
  console.error("usage: node scripts/inspect-app.mjs <app id | name | latest> [--email <owner>] [--builds <n>] [--file <path>]… [--all-files]");
  process.exit(1);
}

const { db } = fnRequire("./lib/admin");
const { fileStore } = fnRequire("./lib/files");
const { checkFile, checkImports } = fnRequire("./lib/llm/checkCode");
const { getAuth } = fnRequire("firebase-admin/auth");

const app = await findApp(positionals[0], opts.email).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
const ref = db.doc(`projects/${app.id}`);
const when = (t) => (t?.toDate ? t.toDate().toISOString().slice(0, 16).replace("T", " ") : "-");
const owner = await getAuth().getUser(app.ownerId).then((u) => u.email, () => app.ownerId);

console.log(`${app.name} (${app.id})`);
console.log(`  owner ${owner} · ${app.kind ?? "user"} · ${app.category ?? "-"} · updated ${when(app.updatedAt)}${app.deletedAt ? " · DELETED" : ""}${app.pinnedAt ? " · pinned" : ""}`);
if (app.description) console.log(`  ${app.description}`);

// ---- Files and the code check, as the next build would see them ----
const files = (await fileStore().readAll(app.id)).sort((a, b) => a.path.localeCompare(b.path));
const paths = new Set(files.map((f) => f.path));
const exists = (p) => paths.has(p);
console.log(`\nFiles (${files.length})`);
for (const f of files) console.log(`  ${f.path.padEnd(44)} ${String(f.content.split("\n").length).padStart(5)} lines ${String(Buffer.byteLength(f.content)).padStart(7)} bytes`);
const problems = files.flatMap((f) => [checkFile(f.path, f.content), ...checkImports(f.path, f.content, exists)].filter(Boolean).map((p) => `${f.path}: ${p}`));
console.log(`\nCode check: ${problems.length ? `${problems.length} problem${problems.length > 1 ? "s" : ""}` : "ok"}`);
for (const p of problems) console.log(`  - ${p}`);

// ---- Builds, newest first, with the reply each left in the chat ----
const n = Number(opts.builds) || 5;
const gens = (await ref.collection("generations").orderBy("createdAt", "desc").limit(n).get()).docs;
const replies = new Map();
for (const m of (await ref.collection("messages").where("role", "==", "assistant").get()).docs) replies.set(m.data().generationId, m.data().content);
const snapshots = await fileStore().listSnapshots(app.id).catch(() => []);
console.log(`\nBuilds (latest ${gens.length}) · ${snapshots.length} snapshots`);
for (const g of gens) {
  const d = g.data();
  const u = d.usage;
  const usage = u ? ` · ${u.model ?? ""} · input ${u.inputTokens ?? 0} + cache read ${u.cacheReadTokens ?? 0} + cache write ${u.cacheWriteTokens ?? 0} · output ${u.outputTokens ?? "-"}` : "";
  console.log(`\n  ${when(d.createdAt)}  ${(d.status ?? "-").toUpperCase()}  ${g.id}${usage}${d.credits != null ? ` · ${d.credits} credits` : ""}`);
  if (d.prompt) console.log(`    prompt: ${d.prompt.length > 300 ? `${d.prompt.slice(0, 300)}…` : d.prompt}`);
  if (d.files?.length) console.log(`    wrote:  ${d.files.join(", ")}`);
  if (d.error) console.log(`    error:  ${d.error}`);
  const reply = replies.get(g.id);
  if (reply) console.log(`    reply:  ${reply.replace(/\s+/g, " ").slice(0, 400)}`);
}

// ---- File contents on request ----
const shown = opts["all-files"] ? files : files.filter((f) => opts.file.includes(f.path));
for (const missing of opts.file.filter((p) => !paths.has(p))) console.log(`\n(no file ${missing})`);
for (const f of shown) console.log(`\n=== ${f.path}\n${f.content}`);
process.exit(0);
