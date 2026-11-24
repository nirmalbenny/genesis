import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSystemPrompt } from "./prompt";
import { fill, parsePlan, planRequest, versionRequest } from "./plan";
import { parseQuality, parseSecurity, qualityRequest, securityRequest } from "./grade";
import {
  assignBuilds, CARE_ITEMS, careLevel, CHECKS, configKey, parseBuildConfigs, CRITERIA, isEligible, JUDGED, keepTwo, levelFromChecks, levelsOf, mentionsEvaluation, pointsOf, SECURITY_CHECKS,
  securityRemoves, total, type CriterionId, type Level, type Levels, type SecurityReview,
} from "./variants";

const clean: SecurityReview = { findings: [], care: {}, checkedSinks: [] };
const judged = (levels: Partial<Record<CriterionId, number>>): Partial<Record<CriterionId, Level>> =>
  Object.fromEntries(JUDGED.map((id) => [id, { level: levels[id] ?? 4, reason: "" }]));
const levels = (l: Partial<Record<CriterionId, number>>, review: SecurityReview = clean): Levels => levelsOf(judged(l), review);
const finding = (severity: "critical" | "high" | "medium" | "low") => ({ check: "A3", severity, file: "src/App.vue", line: 3, evidence: "" });

const FILES = { "src/App.vue": "<template><p>{{ contact.name }}</p></template>" };

test("the quality score has 8 criteria worth 100 points; the judge's and the reviewer's instructions name them", () => {
  assert.equal(CRITERIA.length, 8);
  assert.equal(CRITERIA.reduce((s, c) => s + c.points, 0), 100);
  const rubric = readFileSync(join(__dirname, "rubric.md"), "utf8");
  for (const id of JUDGED) assert.ok(rubric.includes(`${id}. ${CRITERIA.find((c) => c.id === id)!.name}.`), `rubric names criterion ${id}`);
  assert.ok(!JUDGED.includes(3), "criterion 3 comes from the security review");
  const security = readFileSync(join(__dirname, "security.md"), "utf8");
  for (const id of [...SECURITY_CHECKS, ...CARE_ITEMS]) assert.match(security, new RegExp(`- ${id} `), `security brief has ${id}`);
});

test("nothing the builds or the planner are told mentions the evaluation", () => {
  assert.equal(mentionsEvaluation(String(planRequest("m", "x").system)), false);
  // The build prompt says a request is something "to evaluate" (its decline rule); it must never mention scoring.
  const build = buildSystemPrompt();
  assert.doesNotMatch(build, /\b(scor(e|ed|es|ing)|rubric|criteri(a|on)|grad(e|ed|er|ing)|finalists?|eliminat\w*)\b/i);
  for (const c of CRITERIA) assert.ok(!build.includes(c.name), c.name);
});

test("evaluation terms are recognised", () => {
  for (const t of ["We will score this", "per the rubric", "graded on accessibility", "the best version wins", "Security and privacy care"]) {
    assert.ok(mentionsEvaluation(t), t);
  }
  for (const t of ["A board of open deals by stage", "Show today's appointments first, then the week"]) assert.ok(!mentionsEvaluation(t), t);
});

test("gate 1: only a build that finished cleanly goes on", () => {
  assert.equal(isEligible("done"), true);
  for (const s of ["problems", "truncated", "error", "cancelled", "declined"] as const) assert.equal(isEligible(s), false);
});

test("gate 2: a critical or high finding removes a version, and so does a review that couldn't be completed", () => {
  assert.equal(securityRemoves(clean), false);
  assert.equal(securityRemoves({ ...clean, findings: [finding("critical")] }), true);
  assert.equal(securityRemoves({ ...clean, findings: [finding("high")] }), true);
  assert.equal(securityRemoves({ ...clean, findings: [finding("medium"), finding("low")] }), false);
  assert.equal(securityRemoves(null), true);
});

test("criterion 3: the care items' average, rounded down, one level lower per medium finding", () => {
  assert.equal(careLevel(clean), 4, "items not returned are not applicable");
  assert.equal(careLevel({ ...clean, care: { B1: 3, B2: 4, B3: 4, B4: 4, B5: 4, B6: 4, B7: 2 } }), 3);
  assert.equal(careLevel({ ...clean, care: { B1: 4 }, findings: [finding("medium"), finding("low")] }), 3);
  assert.equal(careLevel({ ...clean, care: { B1: 0, B2: 0 }, findings: [finding("medium"), finding("medium"), finding("medium")] }), 0);
});

test("levels become points: weight × level ÷ 4, rounded; ungraded criteria are 0", () => {
  assert.equal(pointsOf(1, 4), 20);
  assert.equal(pointsOf(2, 3), 11);
  assert.equal(pointsOf(6, 3), 8);
  assert.equal(total(levels({})), 100);
  assert.deepEqual(levelsOf({ 7: { level: 2, reason: "r", failed: ["7.1"] } }, clean)[7].failed, ["7.1"], "failed checks are kept");
  const partial = levelsOf({ 1: { level: 9, reason: "" } }, clean);
  assert.deepEqual([partial[1].level, partial[2].level, partial[3].level], [4, 0, 4]);
});

test("the evaluation doc's worked example adds up", () => {
  const care = (level: number): SecurityReview => ({ ...clean, care: Object.fromEntries(CARE_ITEMS.map((b) => [b, level])) });
  const agenda = levels({ 1: 4, 2: 3, 4: 3, 5: 4, 6: 3, 7: 2, 8: 4 }, care(4));
  const search = levels({ 1: 4, 2: 4, 4: 3, 5: 4, 6: 4, 7: 3, 8: 4 }, care(3));
  const cards = levels({ 1: 3, 2: 3, 4: 3, 5: 2, 6: 3, 7: 2, 8: 4 }, care(3));
  assert.deepEqual([total(agenda), total(search), total(cards)], [85, 90, 71]);
  assert.deepEqual(keepTwo([{ index: 0, levels: agenda }, { index: 1, levels: search }, { index: 2, levels: cards }]), [1, 0]);
});

test("ties go to security care, then real data, then build order", () => {
  const care3: SecurityReview = { ...clean, care: { B1: 3, B2: 3, B3: 3, B4: 3, B5: 3, B6: 3, B7: 3 } };
  const fullCare = levels({ 7: 2 }); // 100 - 5 = 95, care 4
  const lowerCare = levels({ 8: 3 }, care3); // 100 - 1 - 4 = 95, care 3
  assert.deepEqual([total(fullCare), total(lowerCare)], [95, 95]);
  assert.deepEqual(keepTwo([{ index: 0, levels: lowerCare }, { index: 1, levels: fullCare }]), [1, 0]);

  const fullRealData = levels({ 7: 2 }); // 95, real data 4
  const lowerRealData = levels({ 2: 3, 8: 3 }); // 100 - 4 - 1 = 95, real data 3
  assert.equal(total(lowerRealData), 95);
  assert.deepEqual(keepTwo([{ index: 0, levels: lowerRealData }, { index: 1, levels: fullRealData }]), [1, 0]);

  assert.deepEqual(keepTwo([{ index: 3, levels: levels({ 7: 2 }) }, { index: 2, levels: levels({ 7: 2 }) }]), [2, 3], "build order last");
  assert.deepEqual(keepTwo([]), []);
});

test("the planner's answer: prompts mentioning evaluation are dropped, the rest completed with the request", () => {
  const plan = parsePlan(JSON.stringify({
    declined: null,
    name: "Contact dashboard",
    prompts: [
      { title: "Agenda", summary: "Today first.", prompt: "Show today's appointments first, in a dark theme.", style: "Dark, compact" },
      { title: "Board", summary: "By stage.", prompt: "A board that will be scored on accessibility." },
      { title: "", summary: "", prompt: "no title" },
    ],
  }))!;
  assert.deepEqual(plan.prompts.map((p) => p.title), ["Agenda"]);
  assert.equal(plan.name, "Contact dashboard");
  assert.equal(plan.prompts[0]!.style, "Dark, compact");
  const versions = fill(plan.prompts, "a contact dashboard");
  assert.equal(versions.length, 4);
  assert.equal(versionRequest("a contact dashboard", versions[3]!), "Request: a contact dashboard");
  assert.equal(versions[3]!.style, "Standard");
  assert.match(versionRequest("a contact dashboard", versions[0]!), /^Request: a contact dashboard\n\nBuild this version of it: Show today's/);
  assert.equal(parsePlan(JSON.stringify({ declined: "Not an app", prompts: [] }))!.declined, "Not an app");
  assert.equal(parsePlan("not json"), null);
});

test("the rubric lists exactly the checks the code knows, with the same KEY marks", () => {
  const rubric = readFileSync(join(__dirname, "rubric.md"), "utf8");
  for (const [id, { ids, key }] of Object.entries(CHECKS)) {
    for (const check of ids) {
      const line = rubric.split("\n").find((l) => l.trim().startsWith(`- ${check}`));
      assert.ok(line, `rubric has check ${check}`);
      assert.equal(line.includes(`${check} KEY`), key.includes(check), `${check} KEY mark`);
    }
    const listed = [...rubric.matchAll(new RegExp(`- (${id}\\.\\d+)`, "g"))].map((m) => m[1]);
    assert.deepEqual([...new Set(listed)], ids, `criterion ${id} lists no other checks`);
  }
});

test("levels come from the failed checks, by the evaluation doc's rule", () => {
  assert.equal(levelFromChecks(7, []), 4);
  assert.equal(levelFromChecks(7, ["7.3"]), 3, "one non-KEY");
  assert.equal(levelFromChecks(7, ["7.1"]), 2, "one KEY");
  assert.equal(levelFromChecks(2, ["2.4", "2.5"]), 2, "two");
  assert.equal(levelFromChecks(4, ["4.3", "4.5", "4.6"]), 2, "three");
  assert.equal(levelFromChecks(2, ["2.2", "2.3", "2.4", "2.5"]), 1, "more than three");
  assert.equal(levelFromChecks(1, [], false), 0, "purpose not met");
  assert.equal(levelFromChecks(8, ["9.9", "8.1", "8.1"]), 3, "unknown and repeated checks don't count");
});

test("the quality judge's answer becomes levels computed from its failed checks; missing criteria are left out", () => {
  const parsed = parseQuality(JSON.stringify({
    c1: { failed: [], purposeMet: true, reason: "Every applicable check passes." },
    c2: { failed: ["2.5"], purposeMet: true, reason: "Fails 2.5: long titles in ContactDrawer.vue." },
    c7: { failed: ["7.1", "7.9"], purposeMet: true, reason: "Fails 7.1." },
    c4: { level: 4, reason: "old shape: ignored" },
  }));
  assert.deepEqual(Object.keys(parsed).sort(), ["1", "2", "7"]);
  assert.deepEqual([parsed[1]!.level, parsed[2]!.level, parsed[7]!.level], [4, 3, 2]);
  assert.deepEqual(parsed[7]!.failed, ["7.1"]);
  assert.deepEqual(parseQuality("oops"), {});
  assert.match(JSON.stringify(qualityRequest("m", { request: "r", version: "v", files: FILES }).messages), /src\/App.vue/);
});

test("the security reviewer's answer: findings with a known severity, care levels, checked sinks; unreadable is null", () => {
  const review = parseSecurity(JSON.stringify({
    findings: [
      { check: "A3", severity: "critical", file: "src/Notes.vue", line: 4, evidence: "v-html of note.body" },
      { check: "A1", severity: "severe", file: "x", line: null, evidence: "unknown severity is ignored" },
    ],
    care: { B1: 3, B2: 4, B3: 4, B4: 4, B5: 4, B6: 4, B7: 2 },
    checkedSinks: ["src/Notes.vue: v-html"],
  }))!;
  assert.deepEqual(review.findings.map((f) => [f.check, f.severity]), [["A3", "critical"]]);
  assert.equal(review.care.B7, 2);
  assert.deepEqual(review.checkedSinks, ["src/Notes.vue: v-html"]);
  assert.equal(securityRemoves(review), true);
  assert.equal(parseSecurity("oops"), null);
  assert.equal(parseSecurity(JSON.stringify({ care: {} })), null, "no findings list: not a review");
  const req = securityRequest("m", { request: "r", version: "v", files: FILES });
  assert.match(JSON.stringify(req.system), /attacker-controlled/);
});

test("VARIANT_BUILDS: model:effort per version; bad entries dropped, too few repeated, none falls back", () => {
  const four = parseBuildConfigs("claude-sonnet-5-5:medium, claude-sonnet-5-5:high,claude-opus-5-5:medium,claude-opus-5-5:high", "m");
  assert.deepEqual(four.map(configKey), ["claude-sonnet-5-5:medium", "claude-sonnet-5-5:high", "claude-opus-5-5:medium", "claude-opus-5-5:high"]);
  assert.deepEqual(parseBuildConfigs("a:low,b:loud,:high", "m").map(configKey), ["a:low", "a:low", "a:low", "a:low"]);
  assert.deepEqual(parseBuildConfigs("", "fallback").map(configKey), Array(4).fill("fallback:high"));
});

test("which setting builds which prompt rotates per build, always using each setting once", () => {
  const configs = parseBuildConfigs("s:medium,s:high,o:medium,o:high", "m");
  const firsts = new Set<string>();
  for (let n = 0; n < 40; n++) {
    const assigned = assignBuilds(configs, `gen${n}`);
    assert.deepEqual([...assigned.map(configKey)].sort(), [...configs.map(configKey)].sort(), "each setting once");
    firsts.add(configKey(assigned[0]!));
  }
  assert.equal(firsts.size, 4, "every setting gets the planner's first prompt across builds");
  assert.deepEqual(assignBuilds(configs, "same"), assignBuilds(configs, "same"), "deterministic per build");
});
