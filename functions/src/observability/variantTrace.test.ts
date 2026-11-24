import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { CRITERIA, type Levels } from "../llm/variants";
import { langfuseProcessor, useTraceProcessor } from "./langfuse";
import { keptScores, sendVariantTrace, variantScores, type VariantTraceInput, type VersionTrace } from "./variantTrace";

// The real Langfuse processor, exporting to memory instead of the network.
const exporter = new InMemorySpanExporter();
useTraceProcessor(langfuseProcessor({ publicKey: "pk-lf-test", secretKey: "sk-lf-test", baseUrl: "http://localhost:1", exporter }));
beforeEach(() => exporter.reset());

const T0 = Date.UTC(2026, 10, 19, 13, 0, 0);
const usage = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
const levels = (level: number): Levels => Object.fromEntries(CRITERIA.map((c) => [c.id, { level, reason: `reason ${c.id}` }])) as Levels;

const version = (title: string, over: Partial<VersionTrace> = {}): VersionTrace => ({
  title, summary: `${title} summary`, prompt: `Build the ${title}`, style: "Dark, compact", model: "claude-opus-5-5", effort: "high", status: "done", gate: "passed",
  files: ["src/App.vue"], problems: [],
  build: { startedAt: T0 + 10_000, endedAt: T0 + 90_000, usage: usage(9000, 8000) },
  security: { startedAt: T0 + 91_000, endedAt: T0 + 100_000, usage: usage(6000, 700), review: { findings: [], care: { B1: 4 }, checkedSinks: ["src/App.vue: {{ x }}"] } },
  quality: { startedAt: T0 + 91_000, endedAt: T0 + 98_000, usage: usage(6000, 900), levels: levels(4) },
  total: 100,
  ...over,
});

const input = (): VariantTraceInput => ({
  generationId: "gen1", uid: "user1", projectId: "app1", appName: "Unread inbox", request: "An inbox I can reply from",
  status: "ready", error: null, startedAt: T0, endedAt: T0 + 120_000,
  models: { build: "claude-sonnet-5-5", security: "claude-sonnet-5-5", quality: "claude-haiku-5-5" },
  planner: { startedAt: T0 + 1000, endedAt: T0 + 9000, usage: usage(2500, 1500), name: "Unread inbox", declined: null },
  versions: [
    version("Two-pane inbox", { total: 94 }),
    version("Reply queue", { total: 86 }),
    version("Dashboard", {
      gate: "secure", total: null,
      security: { startedAt: T0 + 91_000, endedAt: T0 + 100_000, usage: usage(6000, 700), review: { findings: [{ check: "A3", severity: "critical", file: "src/Notes.vue", line: 4, evidence: "v-html of note.body" }], care: {}, checkedSinks: [] } },
    }),
    version("Contact inbox", { total: 90 }),
  ],
  finalists: [0, 3],
  context: { guides: ["contacts"], ui: "element-plus", contextTools: true, hashes: { buildPrompt: "aaaaaaaaaaaa", guides: { contacts: "bbbbbbbbbbbb" }, uiGuide: "c", buildTools: "d", planner: "e", rubric: "f", security: "g" } },
  credits: { held: 191, charged: 109, absorbed: 467 },
});

test("a variant build is one trace in the app's session: the planner, then a span per version with its build and reviews", async () => {
  const sent = await sendVariantTrace(input());
  assert.ok(sent);
  assert.equal(sent.versionIds.length, 4);
  const spans = exporter.getFinishedSpans();
  const names = spans.map((s) => s.name);
  for (const n of ["variant-build", "plan-versions", "version-1", "version-4", "build", "security-review", "quality-review"]) assert.ok(names.includes(n), n);
  assert.equal(new Set(spans.map((s) => s.spanContext().traceId)).size, 1, "one trace");
  const root = spans.find((s) => s.name === "variant-build")!;
  assert.equal(root.attributes["session.id"] ?? root.attributes["langfuse.session.id"], "app1");
  // A version span's id is what its scores attach to.
  const v1 = spans.find((s) => s.name === "version-1")!;
  assert.equal(v1.spanContext().spanId, sent.versionIds[0]);
  assert.equal(spans.filter((s) => s.name === "build").length, 4);
  // The context (guides sent, text hashes) is on the trace, so scores can be tied to the texts that produced them.
  assert.match(JSON.stringify(root.attributes), /aaaaaaaaaaaa/);
});

test("the evaluation becomes scores: per version on its span, per build on the trace", () => {
  const sent = { traceId: "t1", versionIds: ["o1", "o2", "o3", "o4"] };
  const scores = variantScores(input(), sent);
  const of = (name: string, observationId?: string) => scores.filter((s) => s.name === name && s.observationId === observationId);

  assert.deepEqual(of("total", "o1").map((s) => s.value), [94]);
  assert.deepEqual(of("total", "o3"), [], "a version removed at a gate has no total");
  assert.deepEqual(of("gate", "o3").map((s) => s.value), ["secure"]);
  assert.deepEqual(of("build_config", "o1").map((s) => s.value), ["claude-opus-5-5:high"]);
  assert.deepEqual([of("offered", "o1")[0]!.value, of("offered", "o2")[0]!.value], [1, 0]);
  assert.match(String(of("security_findings", "o3")[0]!.comment), /\[critical\] A3 src\/Notes.vue:4: v-html/);
  assert.equal(of("c1_does_what_was_asked", "o1")[0]!.value, 4);
  assert.equal(of("c1_does_what_was_asked", "o1")[0]!.comment, "reason 1");
  assert.equal(of("finalist_margin")[0]!.value, 4, "90 (2nd) beats 86 (3rd) by 4");
  assert.deepEqual([of("charged_credits")[0]!.value, of("absorbed_credits")[0]!.value, of("versions_passed")[0]!.value], [109, 467, 3]);
  assert.ok(scores.every((s) => s.traceId === "t1"));
  assert.equal(new Set(scores.map((s) => s.id)).size, scores.length, "fixed, unique ids: sending again replaces");
});

test("keeping a version scores its rank on the trace and marks the version", () => {
  const scores = keptScores("gen1", { traceId: "t1", versionIds: ["o1", "o2", "o3", "o4"] }, 3, 2);
  assert.deepEqual(scores.map((s) => [s.name, s.value, s.observationId]), [["kept_rank", 2, undefined], ["kept", 1, "o4"]]);
});
