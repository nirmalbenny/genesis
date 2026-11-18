import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { costUsd } from "../credits";
import type { BuildTraceInput } from "./buildTrace";
import { langfuseProcessor, sendBuildTrace, stripFileContent, useTraceProcessor } from "./langfuse";

// The real Langfuse processor (propagation, masking), exporting to memory instead of the network.
const exporter = new InMemorySpanExporter();
const inMemory = () => langfuseProcessor({ publicKey: "pk-lf-test", secretKey: "sk-lf-test", baseUrl: "http://localhost:1", exporter });
useTraceProcessor(inMemory());
beforeEach(() => exporter.reset());

const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const usage = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) =>
  ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });

/** A large-app follow-up: Claude reads one file, then edits it; a write to another file is refused. */
function build(over: Partial<BuildTraceInput> = {}): BuildTraceInput {
  return {
    generationId: "gen1", uid: "user1", projectId: "app1", projectName: "Leads board",
    startedAt: T0, endedAt: T0 + 20_000, status: "partial", error: { code: "invalid_output", message: "Some changes were rejected" },
    prompt: "Show each lead's phone number", plan: "Add the phone under the name.",
    followUp: { previousGenerationId: "gen0", historyMessages: 2 },
    history: [{ role: "user", content: "Build a leads board" }, { role: "assistant", content: "A board of leads.\n\nFiles: src/App.vue" }],
    model: "claude-sonnet-5-5", summaryModel: "claude-haiku-5-5", fileStore: "blobs", contextTools: true,
    context: { full: ["src/App.vue"], indexed: ["src/components/Leads.vue"], chars: 61_000, activePath: "src/App.vue", openPaths: [], recentPaths: [] },
    rounds: [
      { n: 1, startedAt: T0 + 1000, ms: 4000, responseMs: 3500, toolMs: 500, firstTokenMs: null, usage: usage(10, 40, 6641, 23_800), thinkingTokens: 0, stopReason: "tool_use",
        toolCalls: [{ name: "read_files", paths: ["src/components/Leads.vue", "src/nope.vue"], read: ["src/components/Leads.vue"], isError: false, result: "read 1" }] },
      { n: 2, startedAt: T0 + 5200, ms: 9000, responseMs: 8800, toolMs: 200, firstTokenMs: 800, usage: usage(3100, 2100, 30_441), thinkingTokens: 600, stopReason: "tool_use",
        toolCalls: [
          { name: "edit_file", paths: ["src/components/Leads.vue"], read: [], isError: false, result: "Edited src/components/Leads.vue." },
          { name: "write_file", paths: ["src/components/Stats.vue"], read: [], isError: true, result: "Not saved: you haven't been shown src/components/Stats.vue: read it with read_files first." },
        ] },
      { n: 3, startedAt: T0 + 14_300, ms: 900, responseMs: 900, toolMs: 0, firstTokenMs: 400, usage: usage(200, 30, 34_000), thinkingTokens: 0, stopReason: "end_turn", toolCalls: [] },
    ],
    actions: {
      written: [{ path: "src/components/Leads.vue", bytes: 4100 }], deleted: [],
      rejected: [{ path: "src/components/Stats.vue", reason: "you haven't been shown src/components/Stats.vue: read it with read_files first" }], snapshotId: "snap1", summary: "Shows lead phone numbers",
    },
    toolErrors: [{ tool: "write_file", path: "src/components/Stats.vue", error: "Not saved: you haven't been shown src/components/Stats.vue: read it with read_files first." }],
    problems: [],
    codeInText: false,
    credits: { held: 250, extraHolds: 90, charged: 101 },
    summaryUsage: usage(600, 12),
    timings: { checksMs: 300, contextMs: 400, holdMs: 300, firstTokenMs: 5000, streamMs: 14_200, saveMs: 1500 },
    steps: { verifyUser: 120, readFiles: 210, uploadFiles: 400, summary: 700 },
    coldStart: false,
    ...over,
  };
}

const attr = (s: ReadableSpan, k: string) => s.attributes[k];
const json = (s: ReadableSpan, k: string) => JSON.parse(String(attr(s, k) ?? "null"));
const byName = (spans: ReadableSpan[], name: string) => spans.filter((s) => s.name === name);
const ms = (t: [number, number]) => t[0] * 1000 + Math.round(t[1] / 1e6);

test("one trace per build: an agent root with context, a generation per request, a tool per read, and saving", async () => {
  const traceId = await sendBuildTrace(build());
  const spans = exporter.getFinishedSpans();
  assert.deepEqual(spans.map((s) => s.name).sort(),
    ["build-app", "edit-file", "generate-changes", "generate-changes", "generate-changes", "prepare-context", "read-files", "save-changes", "summarize-change", "write-file"]);
  assert.ok(traceId && spans.every((s) => s.spanContext().traceId === traceId), "one trace");

  const types = Object.fromEntries(spans.map((s) => [s.name, attr(s, "langfuse.observation.type")]));
  assert.deepEqual(types, {
    "build-app": "agent", "prepare-context": "span", "generate-changes": "generation", "read-files": "tool", "edit-file": "tool", "write-file": "tool",
    "save-changes": "span", "summarize-change": "generation",
  });

  // Tool calls are siblings of the generation that asked for them, under the build.
  const root = byName(spans, "build-app")[0]!;
  for (const name of ["prepare-context", "generate-changes", "read-files", "save-changes"]) {
    for (const s of byName(spans, name)) assert.equal(s.parentSpanContext?.spanId, root.spanContext().spanId, name);
  }
  assert.equal(byName(spans, "summarize-change")[0]!.parentSpanContext?.spanId, byName(spans, "save-changes")[0]!.spanContext().spanId);
});

test("user, app session, name and tags are on every observation, so filters work at any level", async () => {
  await sendBuildTrace(build());
  for (const s of exporter.getFinishedSpans()) {
    assert.equal(attr(s, "user.id"), "user1", s.name);
    assert.equal(attr(s, "session.id"), "app1", s.name);
    assert.equal(attr(s, "langfuse.trace.name"), "build-app", s.name);
    assert.deepEqual([...(attr(s, "langfuse.trace.tags") as string[])].sort(), ["follow-up", "large-app", "partial", "read-files"], s.name);
  }
});

test("generations carry the model, tokens with cache detail, our own cost, and the time to first token", async () => {
  await sendBuildTrace(build());
  const [first, second, third] = byName(exporter.getFinishedSpans(), "generate-changes").sort((a, b) => ms(a.startTime) - ms(b.startTime));
  assert.equal(attr(first!, "langfuse.observation.model.name"), "claude-sonnet-5-5");
  assert.deepEqual(json(first!, "langfuse.observation.usage_details"),
    { input: 10, output: 40, output_reasoning_tokens: 0, cache_read_input_tokens: 6641, cache_creation_input_tokens: 23_800 });
  const firstCost = json(first!, "langfuse.observation.cost_details");
  assert.equal(firstCost.total, costUsd("claude-sonnet-5-5", usage(10, 40, 6641, 23_800)).total);
  // Thinking is split out of output into its own bucket, for tokens and cost, so nothing is counted twice.
  assert.deepEqual(json(second!, "langfuse.observation.usage_details"),
    { input: 3100, output: 1500, output_reasoning_tokens: 600, cache_read_input_tokens: 30_441, cache_creation_input_tokens: 0 });
  const cost = json(second!, "langfuse.observation.cost_details");
  const full = costUsd("claude-sonnet-5-5", usage(3100, 2100, 30_441));
  assert.ok(Math.abs(cost.output + cost.output_reasoning_tokens - full.output) < 1e-12);
  assert.ok(Math.abs(cost.output_reasoning_tokens - full.output * 600 / 2100) < 1e-12);
  assert.equal(cost.total, full.total);
  assert.equal(json(first!, "langfuse.observation.output").tool_calls[0].function.name, "read_files");
  assert.equal(ms(first!.startTime), T0 + 1000);
  assert.equal(ms(first!.endTime), T0 + 4500, "the response, not the tool call that followed");
  // Each generation's input is the conversation it saw: earlier turns, the request with file names, earlier reads.
  const seen = json(second!, "langfuse.observation.input");
  assert.deepEqual(seen.map((m: { role: string }) => m.role), ["system", "user", "assistant", "user", "assistant", "tool"]);
  assert.equal(seen[1].content, "Build a leads board");
  assert.match(seen[3].content, /sent in full \(not traced\): src\/App\.vue\nListed only, readable with read_files: src\/components\/Leads\.vue\n\nRequest: Show each lead's phone number/);
  assert.equal(seen[4].tool_calls[0].id, seen[5].tool_call_id, "a read's call and result are paired");
  assert.equal(json(first!, "langfuse.observation.input").length, 4, "the first request had no reads yet");
  assert.deepEqual(json(second!, "langfuse.observation.output").tool_calls.map((c: { function: { name: string } }) => c.function.name), ["edit_file", "write_file"]);
  const last = json(third!, "langfuse.observation.input");
  assert.equal(last.at(-1).content, "Not saved: you haven't been shown src/components/Stats.vue: read it with read_files first.", "write results are traced (no content in them)");
  assert.match(json(third!, "langfuse.observation.output").content, /Add the phone under the name\.\n\nFiles: src\/components\/Leads\.vue/);
  assert.ok(attr(second!, "langfuse.observation.completion_start_time"));

  const read = byName(exporter.getFinishedSpans(), "read-files")[0]!;
  assert.deepEqual(json(read, "langfuse.observation.output"), { read: ["src/components/Leads.vue"], notRead: ["src/nope.vue"] });
  assert.equal(ms(read.startTime), T0 + 4500);
});

test("a request cut off by the output limit is a warning that says so", async () => {
  const b = build();
  b.rounds[2] = { ...b.rounds[2]!, stopReason: "max_tokens" };
  await sendBuildTrace(b);
  const last = byName(exporter.getFinishedSpans(), "generate-changes").sort((a, c) => ms(c.startTime) - ms(a.startTime))[0]!;
  assert.equal(attr(last, "langfuse.observation.level"), "WARNING");
  assert.match(String(attr(last, "langfuse.observation.status_message")), /output limit/);
});

test("the build shows the prompt, the plan, failures and rejected files", async () => {
  await sendBuildTrace(build());
  const spans = exporter.getFinishedSpans();
  const root = byName(spans, "build-app")[0]!;
  assert.deepEqual(json(root, "langfuse.observation.input"), { prompt: "Show each lead's phone number" });
  assert.equal(json(root, "langfuse.observation.output").plan, "Add the phone under the name.");
  assert.equal(attr(root, "langfuse.observation.level"), "ERROR");
  assert.match(String(attr(root, "langfuse.observation.status_message")), /^validate: invalid_output/);
  const save = byName(spans, "save-changes")[0]!;
  assert.equal(attr(save, "langfuse.observation.level"), "WARNING");
  assert.match(json(save, "langfuse.observation.output").rejected[0].reason, /read it with read_files first/);
  assert.equal(json(save, "langfuse.observation.output").toolErrors[0].tool, "write_file");
  const write = byName(spans, "write-file")[0]!;
  assert.deepEqual(json(write, "langfuse.observation.input"), { path: "src/components/Stats.vue" }, "paths only, never content");
  assert.equal(attr(write, "langfuse.observation.level"), "WARNING");
  const asked = json(byName(spans, "generate-changes").sort((a, c) => ms(a.startTime) - ms(c.startTime))[1]!, "langfuse.observation.output");
  assert.deepEqual(asked.tool_calls.map((c: { function: { arguments: string } }) => JSON.parse(c.function.arguments)),
    [{ path: "src/components/Leads.vue" }, { path: "src/components/Stats.vue" }]);
});

test("a declined request is traced without its prompt", async () => {
  await sendBuildTrace(build({ status: "declined", error: null, plan: "", rounds: [build().rounds[1]!], actions: { written: [], deleted: [], rejected: [], snapshotId: null, summary: null }, summaryUsage: null }));
  const text = JSON.stringify(exporter.getFinishedSpans().map((s) => s.attributes));
  assert.doesNotMatch(text, /Show each lead/);
  assert.match(text, /declined/);
});

test("file contents never reach a trace, even if one slips into a field", async () => {
  await sendBuildTrace(build({ plan: "Here it is: <document_content>\n<template>secret</template>\n</document_content>" }));
  assert.doesNotMatch(JSON.stringify(exporter.getFinishedSpans().map((s) => s.attributes)), /secret/, "masked by the processor");
  const leaked = JSON.stringify({ content: "<source>src/App.vue</source>\n<document_content>\n<template>secret</template>\n</document_content>" });
  assert.equal(stripFileContent(leaked), JSON.stringify({ content: "<source>src/App.vue</source>\n<document_content>[content not traced]</document_content>" }));
  assert.equal(stripFileContent("no files here"), "no files here");
});

test("tracing off: nothing is sent and the build goes on", async () => {
  useTraceProcessor(null);
  assert.equal(await sendBuildTrace(build()), null);
  useTraceProcessor(inMemory());
});

test("Langfuse failing or hanging never throws and never holds a build up more than a few seconds", async () => {
  const failing = { export: (_s: unknown, done: (r: { code: number; error?: Error }) => void) => done({ code: 1, error: new Error("503 from Langfuse") }), shutdown: async () => {}, forceFlush: async () => { throw new Error("network down"); } };
  useTraceProcessor(langfuseProcessor({ publicKey: "pk-lf-x", secretKey: "sk-lf-x", baseUrl: "http://localhost:1", exporter: failing as never }));
  const t0 = Date.now();
  await assert.doesNotReject(sendBuildTrace(build()));
  assert.ok(Date.now() - t0 < 1000, "a failure returns at once");

  const hanging = { export: () => {}, shutdown: async () => {}, forceFlush: () => new Promise<void>(() => {}) };
  useTraceProcessor(langfuseProcessor({ publicKey: "pk-lf-x", secretKey: "sk-lf-x", baseUrl: "http://localhost:1", exporter: hanging as never }));
  const t1 = Date.now();
  await sendBuildTrace(build());
  const waited = Date.now() - t1;
  assert.ok(waited >= 2900 && waited < 4000, `a hang is cut off at the 3 s cap (waited ${waited} ms)`);
  useTraceProcessor(inMemory());
});
