import { test } from "node:test";
import assert from "node:assert/strict";
import { assemble, type ToolCall } from "./assemble";
import { streamOf, type FakeTurn } from "./testStream";

const run = (t: FakeTurn) => {
  const log: string[] = [];
  return assemble(streamOf(t), {
    onText: (x) => log.push(`text:${x}`),
    onToolStart: (i, name) => log.push(`start:${i}:${name}`),
    onToolInput: (i, json) => log.push(`input:${i}:${json}`),
    onToolEnd: (c: ToolCall) => log.push(`end:${c.index}:${c.name}`),
  }).then((a) => ({ ...a, log }));
};

test("rebuilds the response: thinking with its signature, text, and tool calls with strictly parsed input", async () => {
  const a = await run({
    blocks: [
      { type: "thinking", thinking: "Plan the app.", signature: "sig-123" },
      { type: "text", text: "Building a contact list." },
      { type: "tool", name: "write_file", input: { path: "src/App.vue", content: "<template>\n  <p>\"hi\"</p>\n</template>" } },
      { type: "tool", name: "delete_file", input: { path: "src/old.vue" } },
    ],
    usage: { input: 120, output: 900, thinking: 40 },
  });
  assert.equal(a.error, null);
  assert.equal(a.message.stop_reason, "tool_use");
  assert.deepEqual(a.message.content.map((b) => b.type), ["thinking", "text", "tool_use", "tool_use"]);
  assert.deepEqual(a.message.content[0], { type: "thinking", thinking: "Plan the app.", signature: "sig-123" }, "sent back as is in the next turn");
  assert.equal((a.message.content[1] as { text: string }).text, "Building a contact list.");
  assert.deepEqual(a.calls.map((c) => [c.name, c.input, c.error]), [
    ["write_file", { path: "src/App.vue", content: "<template>\n  <p>\"hi\"</p>\n</template>" }, null],
    ["delete_file", { path: "src/old.vue" }, null],
  ]);
  assert.deepEqual((a.message.content[2] as { input: unknown }).input, a.calls[0]!.input);
  assert.equal(a.message.usage.input_tokens, 120);
  assert.equal(a.message.usage.output_tokens, 900);
  assert.equal(a.message.usage.output_tokens_details?.thinking_tokens, 40);
  assert.equal(a.openTool, null);
  assert.ok(a.log.indexOf("start:2:write_file") < a.log.findIndex((l) => l.startsWith("input:2:")), "input streams after the start");
  assert.ok(a.log.includes("end:3:delete_file"));
});

test("invalid tool JSON is kept as an error on that call only", async () => {
  const a = await run({
    blocks: [
      { type: "tool", name: "write_file", input: null, raw: '{"path":"src/A.vue","content":"unterminated}' },
      { type: "tool", name: "write_file", input: null, raw: '["not","an","object"]' },
      { type: "tool", name: "delete_file", input: { path: "src/B.vue" } },
    ],
  });
  assert.equal(a.error, null);
  assert.match(a.calls[0]!.error!, /^invalid JSON/);
  assert.deepEqual(a.calls[0]!.input, {});
  assert.equal(a.calls[1]!.error, "the input is not a JSON object");
  assert.equal(a.calls[2]!.error, null, "the other calls survive");
  assert.deepEqual((a.message.content[0] as { input: unknown }).input, {}, "an object, so the turn can be sent back");
});

test("a dropped stream keeps the completed blocks and reports the open tool call", async () => {
  const a = await run({
    blocks: [
      { type: "text", text: "Plan." },
      { type: "tool", name: "write_file", input: { path: "src/A.vue", content: "done" } },
      { type: "tool", name: "write_file", input: { path: "src/B.vue", content: "x".repeat(200) } },
    ],
    failAfter: 14,
  });
  assert.match(String(a.error), /socket hang up/);
  assert.deepEqual(a.calls.map((c) => c.input.path), ["src/A.vue"]);
  assert.deepEqual(a.openTool, { index: 2, name: "write_file" });
  assert.deepEqual(a.message.content.map((b) => b.type), ["text", "tool_use"], "the open block is left out");
  assert.ok(a.chars > 0);
});

test("a stream that ends without its final event is an error", async () => {
  async function* cut() {
    yield* (async function* () {})();
    yield { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } } as never;
  }
  const a = await assemble(cut());
  assert.match(String(a.error), /ended before it was complete/);
});

test("at the output cap, the cut-off input fails to parse and is reported", async () => {
  const a = await run({
    blocks: [{ type: "tool", name: "write_file", input: null, raw: '{"path":"src/A.vue","content":"<template>' }],
    stop: "max_tokens",
  });
  assert.equal(a.error, null);
  assert.equal(a.message.stop_reason, "max_tokens");
  assert.match(a.calls[0]!.error!, /^invalid JSON/);
});
