// Shows how a variant build chose its versions (docs/plans/build-variants-evaluation.md): what the planner wrote for
// each version, which gate each passed or failed, the security review (findings, care levels, sinks checked), the
// quality levels with the judge's reasons, the totals, the finalists, the version kept and what was charged. Reads
// variantScores/{generationId}, which only Genesis can read. Emulators only; run `cd functions && npm run build` first.
//
//   node scripts/inspect-variants.mjs --list [--email <owner>]                     recent variant builds, one line each
//   node scripts/inspect-variants.mjs --stats [--email <owner>]                    across all of them: gates, criteria, margins, kept
//   node scripts/inspect-variants.mjs <app id | name | latest> [--email <owner>]   that app's variant build in full
//                                     [--generation <id>] [--sinks] [--short]
//
// --generation picks one of the app's variant builds (default: the latest). --sinks lists every sink the security
// reviewer checked. --short leaves out the planner's full prompts and the judge's reasons.
import { parseArgs } from "node:util";
import { findApp, fnRequire, uidOf } from "./lib/local.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: "boolean" }, stats: { type: "boolean" }, email: { type: "string" }, generation: { type: "string" },
    sinks: { type: "boolean" }, short: { type: "boolean" },
  },
});
if (!opts.list && !opts.stats && positionals.length !== 1) {
  console.error("usage: node scripts/inspect-variants.mjs --list | --stats [--email <owner>]\n       node scripts/inspect-variants.mjs <app id | name | latest> [--email <owner>] [--generation <id>] [--sinks] [--short]");
  process.exit(1);
}

const { db } = fnRequire("./lib/admin");
const { CRITERIA, pointsOf } = fnRequire("./lib/llm/variants");
const when = (t) => (t?.toDate ? t.toDate().toISOString().slice(0, 16).replace("T", " ") : "-");
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? "");

// ---- --list: recent variant builds ----
if (opts.list) {
  const uid = opts.email ? await uidOf(opts.email) : null;
  const q = (uid ? db.collection("variantScores").where("uid", "==", uid) : db.collection("variantScores")).limit(50);
  const docs = (await q.get()).docs.sort((a, b) => (b.get("createdAt")?.toMillis() ?? 0) - (a.get("createdAt")?.toMillis() ?? 0)).slice(0, 15);
  if (!docs.length) console.log("No variant builds yet.");
  for (const d of docs) {
    const s = d.data();
    const app = (await db.doc(`projects/${s.projectId}`).get()).data() ?? {};
    const gen = (await db.doc(`projects/${s.projectId}/generations/${d.id}`).get()).data() ?? {};
    // Builds scored before the two gates (no `gate`) show their total under the earlier rubric, marked "(old)".
    const old = (s.versions ?? []).every((v) => v.gate === undefined);
    const cell = (v) => (old ? (v.total ?? "BUILD") : v.gate === "passed" ? v.total : v.gate === "secure" ? "SEC" : "BUILD");
    const row = `${(s.versions ?? []).map((v, i) => `${i + 1}:${cell(v)}${(s.finalists ?? []).includes(i) ? "*" : ""}`).join(" ")}${old ? " (old)" : ""}`;
    console.log(`${when(s.createdAt)}  ${(gen.status ?? "-").padEnd(8)} ${clip(app.name ?? "-", 28).padEnd(29)} ${row.padEnd(34)} ${d.id} (app ${s.projectId})`);
    if (gen.prompt) console.log(`                    ${clip(gen.prompt, 110)}`);
  }
  console.log("\n  per version: total, or the gate it failed (BUILD, SEC); * = offered; (old) = scored with the earlier rubric");
  process.exit(0);
}

// ---- --stats: across every variant build scored with the two gates (older ones are left out) ----
if (opts.stats) {
  const uid = opts.email ? await uidOf(opts.email) : null;
  const docs = (await (uid ? db.collection("variantScores").where("uid", "==", uid) : db.collection("variantScores")).get()).docs
    .filter((d) => (d.get("versions") ?? []).some((v) => v.gate !== undefined));
  if (!docs.length) {
    console.log("No variant builds scored with the two gates yet.");
    process.exit(0);
  }
  const versions = docs.flatMap((d) => d.get("versions") ?? []);
  const passed = versions.filter((v) => v.gate === "passed");
  const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : "-");
  const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-");
  console.log(`${docs.length} variant builds · ${versions.length} versions`);
  console.log(`\nGates`);
  console.log(`  removed at gate 1 (build):    ${versions.filter((v) => v.gate === "builds").length} (${pct(versions.filter((v) => v.gate === "builds").length, versions.length)})`);
  console.log(`  removed at gate 2 (security): ${versions.filter((v) => v.gate === "secure").length} (${pct(versions.filter((v) => v.gate === "secure").length, versions.length)})`);
  console.log(`  security reviews not completed: ${versions.filter((v) => v.gate !== "builds" && !v.security).length}`);
  const findings = versions.flatMap((v) => v.security?.findings ?? []);
  const byCheck = {};
  for (const f of findings) byCheck[`${f.check} ${f.severity}`] = (byCheck[`${f.check} ${f.severity}`] ?? 0) + 1;
  console.log(`  security findings: ${findings.length}${findings.length ? ` (${Object.entries(byCheck).map(([k, n]) => `${k} ×${n}`).join(", ")})` : ""}`);
  console.log(`\nQuality (versions that passed both gates: ${passed.length}) · average level of 4, lowest first`);
  const rows = CRITERIA.map((c) => ({ c, levels: passed.map((v) => v.levels?.[c.id]?.level).filter((n) => typeof n === "number") }))
    .sort((a, b) => Number(avg(a.levels)) - Number(avg(b.levels)));
  for (const { c, levels } of rows) console.log(`  ${String(c.id)}. ${c.name.padEnd(27)} ${avg(levels)}  (${levels.filter((n) => n <= 2).length} at level 2 or below)`);
  console.log(`  total: average ${avg(passed.map((v) => v.total).filter((n) => typeof n === "number"))}`);
  const margins = docs.map((d) => (d.get("versions") ?? []).map((v) => v.total).filter((n) => typeof n === "number").sort((a, b) => b - a))
    .filter((t) => t.length >= 3).map((t) => t[1] - t[2]);
  // Each model and effort compared (builds that recorded them: VARIANT_BUILDS).
  const configured = docs.flatMap((d) => (d.get("versions") ?? []).map((v, i) => ({ v, offered: (d.get("finalists") ?? []).includes(i), id: d.id })))
    .filter((x) => x.v.model);
  if (configured.length) {
    const keptIds = new Map();
    for (const g of await Promise.all(docs.map((d) => db.doc(`projects/${d.get("projectId")}/generations/${d.id}`).get()))) {
      const gd = g.data();
      if (gd?.status === "done") keptIds.set(g.id, (gd.finalists ?? []).find((f) => f.snapshotId === gd.snapshotId)?.title);
    }
    console.log(`\nBy model and effort (${configured.length} versions)`);
    const groups = new Map();
    for (const x of configured) {
      const k = `${x.v.model}:${x.v.effort}`;
      groups.set(k, [...(groups.get(k) ?? []), x]);
    }
    for (const [k, xs] of [...groups].sort()) {
      const totals = xs.map((x) => x.v.total).filter((n) => typeof n === "number");
      const removed = xs.filter((x) => x.v.gate !== "passed").length;
      const kept = xs.filter((x) => keptIds.get(x.id) === x.v.title).length;
      const out = xs.map((x) => x.v.usage?.outputTokens).filter((n) => typeof n === "number");
      console.log(`  ${k.padEnd(30)} ${String(xs.length).padStart(2)} versions · average total ${avg(totals)} · removed ${removed} · offered ${xs.filter((x) => x.offered).length} · kept ${kept} · output tokens ${avg(out)}`);
    }
  }
  console.log(`\nFinalist margin (2nd best over 3rd): average ${avg(margins)} · ${margins.filter((m) => m <= 2).length} of ${margins.length} builds by 2 points or less`);
  const gens = await Promise.all(docs.map((d) => db.doc(`projects/${d.get("projectId")}/generations/${d.id}`).get()));
  const kept = gens.map((g) => g.data()).filter((g) => g?.status === "done" && g.finalists?.length)
    .map((g) => g.finalists.findIndex((f) => f.snapshotId === g.snapshotId) + 1);
  console.log(`Kept by customers: ${kept.length} saved · top-ranked ${kept.filter((r) => r === 1).length} · second ${kept.filter((r) => r === 2).length}`);
  const charges = await Promise.all(docs.map((d) => db.doc(`users/${d.get("uid")}/creditLedger/${d.id}-charge`).get()));
  const ch = charges.filter((c) => c.exists).map((c) => c.data());
  console.log(`Credits per build: charged ${avg(ch.map((c) => c.credits))} · absorbed by Genesis ${avg(ch.map((c) => c.absorbed).filter((n) => typeof n === "number"))}`);
  process.exit(0);
}

// ---- One app's variant build in full ----
const app = await findApp(positionals[0], opts.email).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
const gens = (await db.collection(`projects/${app.id}/generations`).where("mode", "==", "variants").get()).docs
  .sort((a, b) => (b.get("createdAt")?.toMillis() ?? 0) - (a.get("createdAt")?.toMillis() ?? 0));
const genDoc = opts.generation ? gens.find((g) => g.id === opts.generation) : gens[0];
if (!genDoc) {
  console.error(`${app.name} (${app.id}) has no variant build${opts.generation ? ` ${opts.generation}` : ""}.`);
  process.exit(1);
}
const gen = genDoc.data();
const scores = (await db.doc(`variantScores/${genDoc.id}`).get()).data();

console.log(`${app.name} (${app.id})${app.draft ? " · draft, not saved yet" : ""}`);
console.log(`  variant build ${genDoc.id} · ${when(gen.createdAt)} · ${gen.status}${gens.length > 1 ? ` · ${gens.length} variant builds on this app` : ""}`);
if (gen.prompt) console.log(`  request: ${gen.prompt}`);
if (gen.error) console.log(`  error: ${gen.error}`);
if (!scores) {
  console.log("\n  No scores: the build ended before its versions were reviewed (declined, stopped, failed or still running).");
  process.exit(0);
}
console.log(`  reviewers: security ${scores.securityModel ?? "-"} · quality ${scores.graderModel ?? "-"}`);
const ctx = scores.context;
if (ctx) {
  const h = ctx.hashes;
  console.log(`  context: guides ${ctx.guides.join(", ")} · UI ${ctx.ui}${ctx.contextTools ? "" : " · no read_files"}`);
  console.log(`  text hashes: build prompt ${h.buildPrompt} · UI guide ${h.uiGuide} · tools ${h.buildTools} · planner ${h.planner} · rubric ${h.rubric} · security ${h.security}`);
  console.log(`               guides ${Object.entries(h.guides).map(([id, x]) => `${id} ${x}`).join(" · ")}`);
} else console.log("  context: not recorded (built before contexts were stored)");

const offered = new Set(scores.finalists ?? []);
const kept = (gen.finalists ?? []).find((f) => f.snapshotId === gen.snapshotId);
const GATE = { builds: "REMOVED at gate 1 (build)", secure: "REMOVED at gate 2 (security)", passed: "passed both gates" };

for (const [i, v] of (scores.versions ?? []).entries()) {
  const tag = offered.has(i) ? (kept?.title === v.title && gen.status === "done" ? "KEPT" : "OFFERED") : "not offered";
  console.log(`\n${"=".repeat(100)}\n#${i + 1} ${v.title} · ${tag} · ${GATE[v.gate] ?? v.gate} · total ${v.total ?? "-"}${v.model ? ` · built by ${v.model} (${v.effort} effort)` : ""}`);
  console.log(`  summary: ${v.summary}${v.style ? ` · style: ${v.style}` : ""}`);
  console.log(`  planner's prompt: ${opts.short ? clip(v.prompt, 160) : v.prompt}`);
  console.log(`  build: ${v.status} · ${(v.files ?? []).length} files written${v.usage ? ` · output ${v.usage.outputTokens} tokens` : ""}`);
  for (const p of v.problems ?? []) console.log(`    problem: ${p}`);

  const sec = v.security;
  if (v.gate !== "builds") {
    if (!sec) console.log("  security: NOT REVIEWED (the review couldn't be completed: counts as not passing)");
    else {
      console.log(`  security: ${sec.findings.length} finding${sec.findings.length === 1 ? "" : "s"} · ${sec.checkedSinks.length} sinks checked · care ${Object.entries(sec.care).map(([k, n]) => `${k}=${n}`).join(" ")}`);
      for (const f of sec.findings) console.log(`    [${f.severity.toUpperCase()}] ${f.check} ${f.file}${f.line ? `:${f.line}` : ""} · ${f.evidence}`);
      if (opts.sinks) for (const s of sec.checkedSinks) console.log(`    sink: ${s}`);
    }
  }
  if (v.levels) {
    console.log("  quality:");
    for (const c of CRITERIA) {
      const l = v.levels[c.id];
      const failed = l.failed ? ` [${l.failed.join(" ") || "all pass"}]` : "";
      console.log(`    ${String(c.id)}. ${c.name.padEnd(27)} level ${l.level} → ${String(pointsOf(c.id, l.level)).padStart(2)}/${c.points}${failed}${opts.short ? "" : `  ${l.reason}`}`);
    }
  }
}

// ---- Outcome and charge ----
const uid = scores.uid;
const ledger = db.collection(`users/${uid}/creditLedger`);
const [charge, adjust] = await Promise.all([ledger.doc(`${genDoc.id}-charge`).get(), ledger.doc(`${genDoc.id}-adjust`).get()]);
console.log(`\n${"=".repeat(100)}`);
console.log(`offered: ${[...offered].map((i) => `#${i + 1} ${scores.versions[i].title}`).join(", ") || "none"}`);
console.log(`kept: ${gen.status === "done" && kept ? kept.title : app.draft ? "not yet (waiting to be chosen)" : "-"}`);
if (charge.exists) {
  const c = charge.data();
  console.log(`charged ${c.credits} credits (hold ${c.released} released) · absorbed by Genesis ${c.absorbed ?? "-"} · ${c.calls ?? "-"} model calls`);
}
if (adjust.exists) console.log(`adjusted at save: ${adjust.get("credits") > 0 ? "+" : ""}${adjust.get("credits")} credits (${adjust.get("reason") ?? ""})`);
process.exit(0);
