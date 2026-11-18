// Compares two build eval runs (scripts/eval-builds.mjs) from eval-results.jsonl, case by case: passes, and the
// median time, output tokens and credits. Reads the file only (no emulators, no Claude).
//
//   node scripts/eval-compare.mjs                     the latest run against the run before it
//   node scripts/eval-compare.mjs <label> [baseline]  a run against a baseline (default: the run before it)
//   node scripts/eval-compare.mjs --list              every run: label, date, cases, passes
//
// A run is every row with the same label. The default baseline is the earlier run with the most cases in common
// (the latest one on a tie). Exits 1 when a case passes less often than in the baseline.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = fileURLToPath(new URL("../eval-results.jsonl", import.meta.url));
if (!existsSync(FILE)) {
  console.error("No eval-results.jsonl yet: run node scripts/eval-builds.mjs <label> first.");
  process.exit(1);
}
const rows = readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** label → its rows, in the order the labels first ran. */
const runs = new Map();
for (const r of rows) runs.set(r.label, [...(runs.get(r.label) ?? []), r]);
const labels = [...runs.keys()];
const casesOf = (label) => new Set(runs.get(label).map((r) => r.case));

const args = process.argv.slice(2);
if (args[0] === "--list") {
  for (const label of labels) {
    const rs = runs.get(label);
    console.log(`${rs.at(-1).at.slice(0, 16).replace("T", " ")}  ${label.padEnd(28)} ${String(rs.filter((r) => r.ok).length).padStart(3)}/${rs.length} passed  ${[...casesOf(label)].join(", ")}`);
  }
  process.exit(0);
}

const label = args[0] ?? labels.at(-1);
if (!runs.has(label)) {
  console.error(`No run labelled "${label}". Runs: node scripts/eval-compare.mjs --list`);
  process.exit(1);
}
const common = (other) => [...casesOf(label)].filter((c) => casesOf(other).has(c)).length;
const baseline = args[1] ?? labels.slice(0, labels.indexOf(label)).reverse().filter((l) => common(l) > 0)
  .reduce((best, l) => (best === undefined || common(l) > common(best) ? l : best), undefined);
if (!baseline || !runs.has(baseline)) {
  console.error(baseline ? `No run labelled "${baseline}".` : `No earlier run shares a case with "${label}".`);
  process.exit(1);
}

const median = (xs, digits = 0) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  const m = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return Number(m.toFixed(digits));
};
/** One case of one run: passes and medians. */
const stats = (run, name) => {
  const rs = runs.get(run).filter((r) => r.case === name);
  if (!rs.length) return null;
  return { runs: rs.length, passed: rs.filter((r) => r.ok).length, seconds: median(rs.map((r) => r.seconds), 1), tokens: median(rs.map((r) => r.outputTokens)), credits: median(rs.map((r) => r.credits)) };
};
const cell = (s) => (s ? `${s.passed}/${s.runs}  ${s.seconds ?? "-"}s  ${s.tokens ?? "-"} out  ${s.credits ?? "-"} cr` : "-");
const delta = (a, b) => (a == null || b == null || !b ? "" : `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%`);

console.log(`${label}  vs  ${baseline}   (passes, median time, output tokens, credits)\n`);
console.log(`${"case".padEnd(13)}${label.padEnd(38)}${baseline.padEnd(38)}time   tokens credits`);
let worse = 0;
for (const name of [...new Set([...casesOf(label), ...casesOf(baseline)])]) {
  const now = stats(label, name);
  const before = stats(baseline, name);
  const dropped = now && before && now.passed / now.runs < before.passed / before.runs;
  if (dropped) worse++;
  const changes = now && before ? [delta(now.seconds, before.seconds), delta(now.tokens, before.tokens), delta(now.credits, before.credits)].map((d) => d.padEnd(7)).join("") : "";
  console.log(`${name.padEnd(13)}${cell(now).padEnd(38)}${cell(before).padEnd(38)}${changes}${dropped ? "  PASSES LESS" : ""}`);
}
const total = (run) => runs.get(run).filter((r) => [...casesOf(label)].includes(r.case) && casesOf(baseline).has(r.case));
const sum = (rs, k) => rs.reduce((s, r) => s + (r[k] ?? 0), 0) / (rs.length || 1);
const [a, b] = [total(label), total(baseline)];
console.log(`\nCases in both: ${label} ${a.filter((r) => r.ok).length}/${a.length} passed, ${baseline} ${b.filter((r) => r.ok).length}/${b.length}. ` +
  `Mean per build: tokens ${delta(sum(a, "outputTokens"), sum(b, "outputTokens")) || "-"}, credits ${delta(sum(a, "credits"), sum(b, "credits")) || "-"}, time ${delta(sum(a, "seconds"), sum(b, "seconds")) || "-"}.`);
if (worse) console.log(`${worse} case${worse > 1 ? "s pass" : " passes"} less often than in ${baseline}.`);
process.exit(worse ? 1 : 0);
