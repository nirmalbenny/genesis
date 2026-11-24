// How consistent the variant reviews are (docs/plans/build-variants-evaluation.md §11): re-reviews the finalists of
// recent variant builds several times, with the current rubric and security brief, and reports how much each
// criterion's level, each total and the security verdict move between runs, and whether the two finalists swap order.
// Only finalists can be re-reviewed (their files are kept as snapshots; the other versions' files are not). Emulators
// and Claude (Haiku for quality, Sonnet for security); `cd functions && npm run build` first. Never prints keys.
//
//   node scripts/eval-consistency.mjs [--email <owner>] [--builds <n>] [--runs <n>] [--no-security]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fnRequire, ROOT, uidOf } from "./lib/local.mjs";

const { values: opts } = parseArgs({
  options: {
    email: { type: "string" }, builds: { type: "string", default: "3" }, runs: { type: "string", default: "3" },
    "no-security": { type: "boolean" },
  },
});
const Anthropic = fnRequire("@anthropic-ai/sdk").default;
const { db } = fnRequire("./lib/admin");
const { fileStore } = fnRequire("./lib/files");
const { qualityRequest, parseQuality, securityRequest, parseSecurity } = fnRequire("./lib/llm/grade");
const { CRITERIA, levelsOf, securityRemoves, total } = fnRequire("./lib/llm/variants");
const key = readFileSync(`${ROOT}functions/.secret.local`, "utf8").match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1]?.trim();
const client = new Anthropic({ apiKey: key });
const env = readFileSync(`${ROOT}functions/.env.local`, "utf8");
const model = (name, fallback) => env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim() ?? fallback;
const QUALITY = model("GRADER_MODEL", "claude-haiku-5-5");
const SECURITY = model("SECURITY_MODEL", "claude-sonnet-5-5");
const RUNS = Number(opts.runs) || 3;
const text = (m) => m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
const ask = async (req, read) => read(text(await client.messages.stream(req).finalMessage()));

const uid = opts.email ? await uidOf(opts.email) : null;
const builds = (await (uid ? db.collection("variantScores").where("uid", "==", uid) : db.collection("variantScores")).get()).docs
  .filter((d) => (d.get("versions") ?? []).some((v) => v.gate !== undefined) && (d.get("finalists") ?? []).length)
  .sort((a, b) => (b.get("createdAt")?.toMillis() ?? 0) - (a.get("createdAt")?.toMillis() ?? 0))
  .slice(0, Number(opts.builds) || 3);
if (!builds.length) { console.log("No variant builds with finalists to re-review."); process.exit(0); }

const spreads = Object.fromEntries(CRITERIA.map((c) => [c.id, []]));
let swaps = 0, pairs = 0, verdictFlips = 0, finalistsChecked = 0;
for (const d of builds) {
  const s = d.data();
  const gen = (await db.doc(`projects/${s.projectId}/generations/${d.id}`).get()).data() ?? {};
  console.log(`\n${"=".repeat(90)}\n${d.id} · ${gen.prompt ?? ""}`);
  const totalsByFinalist = [];
  for (const [rank, f] of (gen.finalists ?? []).entries()) {
    const index = s.finalists[rank];
    const version = s.versions[index];
    const files = Object.fromEntries(((await fileStore().readSnapshot(s.projectId, f.snapshotId)) ?? []).map((x) => [x.path, x.content]));
    if (!Object.keys(files).length) { console.log(`  ${version.title}: files not found`); continue; }
    const input = { request: gen.prompt ?? "", version: version.prompt, files };
    const runs = await Promise.all(Array.from({ length: RUNS }, async () => {
      const [quality, security] = await Promise.all([
        ask(qualityRequest(QUALITY, input), parseQuality).catch(() => ({})),
        opts["no-security"] ? Promise.resolve(version.security) : ask(securityRequest(SECURITY, input), parseSecurity).catch(() => null),
      ]);
      const levels = levelsOf(quality, security ?? { findings: [], care: {}, checkedSinks: [] });
      return { levels, total: total(levels), removed: securityRemoves(security), security };
    }));
    finalistsChecked++;
    const totals = runs.map((r) => r.total);
    totalsByFinalist.push(totals);
    if (new Set(runs.map((r) => r.removed)).size > 1) verdictFlips++;
    console.log(`  ${version.title} (stored total ${version.total})`);
    console.log(`    totals per run: ${totals.join(", ")} · security: ${runs.map((r) => (r.removed ? "REMOVED" : "passed")).join(", ")}`);
    for (const c of CRITERIA) {
      const levels = runs.map((r) => r.levels[c.id].level);
      spreads[c.id].push(Math.max(...levels) - Math.min(...levels));
      const failed = runs.map((r) => (r.levels[c.id].failed ? `[${r.levels[c.id].failed.join(" ") || "-"}]` : "")).join(" ");
      if (new Set(levels).size > 1) console.log(`    ${c.id}. ${c.name.padEnd(27)} levels ${levels.join(", ")}  ${failed}`);
    }
  }
  // Does the order of the two finalists hold in every run?
  if (totalsByFinalist.length === 2) {
    for (let i = 0; i < RUNS; i++) {
      pairs++;
      if (totalsByFinalist[1][i] > totalsByFinalist[0][i]) swaps++;
    }
  }
}

const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-");
console.log(`\n${"=".repeat(90)}\n${finalistsChecked} finalists × ${RUNS} runs`);
console.log("Level spread per criterion (max − min across runs; 0 = always the same level):");
for (const c of CRITERIA) console.log(`  ${c.id}. ${c.name.padEnd(27)} average spread ${avg(spreads[c.id])} · moved in ${spreads[c.id].filter((x) => x > 0).length} of ${spreads[c.id].length}`);
console.log(`Finalists in the stored order: ${pairs - swaps} of ${pairs} runs (swapped in ${swaps})`);
console.log(`Security verdict changed between runs for ${verdictFlips} of ${finalistsChecked} finalists`);
process.exit(0);
