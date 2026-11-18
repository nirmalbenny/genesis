import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolCall } from "./assemble";
import { streamOf, turnEvents, type FakeTurn } from "./testStream";
import { runTurns, withCachePoint, type StreamFn, type TurnsOptions } from "./turns";
import { createWorkspace } from "./workspace";
import { runBuildTool } from "./tools";

const valid = (path: string) => (path.endsWith(".vue") ? `<template>${path}</template>` : `export const p = "${path}";`);
const write = (path: string, content = valid(path)) => ({ type: "tool" as const, name: "write_file", input: { path, content } });
const text = (t: string) => ({ type: "text" as const, text: t });
const done = (t = "Done."): FakeTurn => ({ blocks: [text(t)], usage: { input: 50, output: 10 } });

/** A fake Claude playing scripted turns, recording each request; a real workspace runs the tools. */
function harness(script: FakeTurn[], over: Partial<TurnsOptions> = {}) {
  const requests: Anthropic.MessageCreateParamsStreaming[] = [];
  const stream: StreamFn = async (params, signal) => {
    requests.push(structuredClone(params));
    const turn = script[requests.length - 1];
    if (!turn) throw new Error(`no scripted turn ${requests.length}`);
    return streamOf(turn, signal);
  };
  const workspace = createWorkspace({});
  const ran: string[] = [];
  const held: number[] = [];
  const options: TurnsOptions = {
    stream,
    request: { model: "m", system: "s", tools: [], messages: [{ role: "user", content: "files + request" }] },
    maxOutputTokens: 16_000,
    maxTurns: 6,
    signal: new AbortController().signal,
    handlers: {},
    runTool: (c: ToolCall) => { ran.push(c.name); return runBuildTool(c, { workspace, readFiles: null }); },
    beforeTurn: async (turn) => { held.push(turn); },
    stopped: () => false,
    ...over,
  };
  return { requests, workspace, ran, held, run: () => runTurns(options) };
}

const refused = write("package.json", "{}"); // a change the workspace refuses, so the loop continues

test("all changes in one response, all accepted: the build ends after one request", async () => {
  const h = harness([
    { blocks: [{ type: "thinking", thinking: "t", signature: "sig" }, text("Plan."), write("src/App.vue"), write("src/main.js")], usage: { input: 100, output: 900, thinking: 30 } },
  ]);
  const r = await h.run();
  assert.equal(r.error, null);
  assert.equal(r.message?.stop_reason, "tool_use");
  assert.deepEqual(h.workspace.ops().map((o) => o.path), ["src/App.vue", "src/main.js"]);
  assert.equal(h.requests.length, 1, "no closing turn: it would only re-send the files just written");
  assert.deepEqual(r.usage, { inputTokens: 100, outputTokens: 900, cacheWriteTokens: 0, cacheReadTokens: 0 });
  assert.deepEqual(h.held, []);
  assert.equal(r.rounds[0]!.thinkingTokens, 30);
  assert.deepEqual(r.rounds[0]!.toolCalls.map((c) => [c.name, c.paths, c.isError, c.result]), [
    ["write_file", ["src/App.vue"], false, "Created src/App.vue (32 bytes)."],
    ["write_file", ["src/main.js"], false, "Created src/main.js (31 bytes)."],
  ]);
});

test("a refused change goes back with every result, and the model fixes it in the next turn", async () => {
  const h = harness([
    { blocks: [{ type: "thinking", thinking: "t", signature: "sig" }, text("Plan."), refused, write("src/App.vue")], usage: { input: 100, output: 900 } },
    { blocks: [write("src/deps.js", "export const x = 1;")], usage: { input: 50, output: 40 } },
  ]);
  const r = await h.run();
  assert.equal(h.requests.length, 2);
  const second = h.requests[1]!.messages;
  const assistant = second[1]!.content as Anthropic.ContentBlockParam[];
  assert.deepEqual(assistant.map((b) => b.type), ["thinking", "text", "tool_use", "tool_use"], "the response goes back whole, thinking included");
  const results = second[2]!.content as Anthropic.ToolResultBlockParam[];
  assert.deepEqual(results.map((b) => [b.tool_use_id, b.is_error]), [["toolu_2", true], ["toolu_3", false]]);
  assert.match(String(results[0]!.content), /Not saved: path is system-owned/);
  assert.deepEqual(h.workspace.ops().map((o) => o.path), ["src/App.vue", "src/deps.js"]);
  assert.deepEqual(h.held, [1], "the extra turn is held for first");
  assert.equal(h.requests[1]!.max_tokens, 16_000 - 900, "the output cap is for the whole build");
  assert.deepEqual(r.usage, { inputTokens: 150, outputTokens: 940, cacheWriteTokens: 0, cacheReadTokens: 0 });
});

test("reads always continue: the model gets the files and then makes its changes", async () => {
  const h = harness([
    { blocks: [{ type: "tool", name: "read_files", input: { paths: ["src/A.vue"] } }] },
    { blocks: [text("Plan."), write("src/A.vue")] },
  ], { runTool: async (c) => (c.name === "read_files" ? { content: "<documents>…</documents>", isError: false, read: ["src/A.vue"] } : { content: "Saved.", isError: false }) });
  const r = await h.run();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(r.rounds[0]!.toolCalls[0]!.read, ["src/A.vue"]);
  assert.equal(r.rounds[0]!.toolCalls[0]!.result, "Read src/A.vue", "file contents are never recorded");
});

test("invalid JSON in a call is answered with an error result; the others run", async () => {
  const h = harness([
    { blocks: [{ type: "tool", name: "write_file", input: null, raw: '{"path":"src/A.vue","content":"x' }, write("src/App.vue")] },
    { blocks: [write("src/A.vue")] },
  ]);
  const r = await h.run();
  const results = h.requests[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[];
  assert.match(String(results[0]!.content), /Invalid input: invalid JSON/);
  assert.equal(results[1]!.is_error, false);
  assert.deepEqual(h.workspace.ops().map((o) => o.path), ["src/App.vue", "src/A.vue"]);
  assert.equal(r.error, null);
});

test("decline ends the build: nothing in that response runs", async () => {
  const h = harness([{ blocks: [{ type: "tool", name: "decline", input: { reason: "Not about this app." } }, write("src/App.vue")] }]);
  const r = await h.run();
  assert.equal(r.declined, "Not about this app.");
  assert.deepEqual(h.ran, []);
  assert.equal(h.requests.length, 1);
});

test("an API refusal: no tool of that response runs", async () => {
  const h = harness([{ blocks: [text("Plan."), write("src/App.vue")], stop: "refusal" }]);
  const r = await h.run();
  assert.equal(r.declined, "");
  assert.deepEqual(h.ran, []);
});

test("the output cap cuts the last call off: it never runs, the earlier ones do", async () => {
  const h = harness([{
    blocks: [write("src/App.vue"), { type: "tool", name: "write_file", input: null, raw: '{"path":"src/B.vue","content":"<temp' }],
    stop: "max_tokens",
  }]);
  const r = await h.run();
  assert.equal(r.truncated, true);
  assert.deepEqual(r.unfinished, { name: "write_file", index: 1 });
  assert.deepEqual(h.ran, ["write_file"]);
  assert.deepEqual(h.workspace.ops().map((o) => o.path), ["src/App.vue"]);
  assert.equal(h.requests.length, 1);
});

test("a dropped connection keeps the completed changes of that response", async () => {
  const blocks = [write("src/App.vue"), write("src/B.vue", "x".repeat(300))];
  // Fail a few deltas into the second file.
  const failAfter = turnEvents({ blocks }).findIndex((e) => e.type === "content_block_start" && e.index === 1) + 4;
  const h = harness([{ blocks, failAfter }]);
  const r = await h.run();
  assert.match(String(r.error), /socket hang up/);
  assert.deepEqual(h.workspace.ops().map((o) => o.path), ["src/App.vue"]);
  assert.deepEqual(r.unfinished, { name: "write_file", index: 1 });
  assert.equal(r.rounds[0]!.stopReason, null);
  assert.ok(r.usage.outputTokens > 0, "a cut-off response is still counted");
});

test("cancel mid-response aborts the stream; between turns it stops before the next request", async () => {
  const abort = new AbortController();
  const h = harness([{ blocks: [write("src/App.vue"), write("src/B.vue", "x".repeat(300))] }], {
    signal: abort.signal,
    handlers: { onToolStart: (i) => { if (i === 1) abort.abort(); } },
  });
  const r = await h.run();
  assert.match(String(r.error), /aborted/);
  assert.deepEqual(h.workspace.ops().map((o) => o.path), ["src/App.vue"]);

  let stopped = false;
  const h2 = harness([{ blocks: [refused] }, done()], { stopped: () => stopped, runTool: async () => { stopped = true; return { content: "Not saved.", isError: true }; } });
  const r2 = await h2.run();
  assert.equal(r2.stoppedBetweenTurns, true);
  assert.equal(h2.requests.length, 1);
});

test("a refused extra hold (402) ends the build with what was done", async () => {
  const h = harness([{ blocks: [write("src/App.vue"), refused] }, done()], {
    beforeTurn: async () => { throw Object.assign(new Error("Not enough AI credits"), { status: 402 }); },
  });
  const r = await h.run();
  assert.equal((r.error as { status: number }).status, 402);
  assert.deepEqual(h.workspace.ops().map((o) => o.path), ["src/App.vue"]);
  assert.equal(h.requests.length, 1);
});

test("the last allowed turn may not call tools, so the model has to finish", async () => {
  const loop = (i: number): FakeTurn => ({ blocks: [write(`src/F${i}.vue`), refused] });
  const h = harness([loop(1), loop(2), loop(3)], { maxTurns: 3 });
  const r = await h.run();
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[0]!.tool_choice, undefined);
  assert.deepEqual(h.requests[2]!.tool_choice, { type: "none" });
  assert.equal(r.error, null);
});

test("the output cap is shared by every turn", async () => {
  const h = harness([{ blocks: [refused], usage: { input: 10, output: 15_990 } }, done()], { maxOutputTokens: 16_000 });
  await h.run();
  assert.equal(h.requests[1]!.max_tokens, 10);
  const h2 = harness([{ blocks: [refused], usage: { input: 10, output: 16_000 } }], { maxOutputTokens: 16_000 });
  await h2.run();
  assert.equal(h2.requests.length, 1, "no turn once the cap is used up");
});

test("a request that fails to start is an error with no rounds lost", async () => {
  const h = harness([], { stream: async () => { throw Object.assign(new Error("overloaded"), { status: 529 }); } });
  const r = await h.run();
  assert.match(String(r.error), /overloaded/);
  assert.equal(r.rounds.length, 1);
  assert.equal(r.rounds[0]!.stopReason, null);
});

test("every request carries a cache point on the latest user turn", async () => {
  const h = harness([{ blocks: [refused] }, done()]);
  await h.run();
  assert.equal(h.requests.length, 2);
  for (const req of h.requests) {
    const last = req.messages.at(-1)!.content as { cache_control?: unknown }[];
    assert.deepEqual(last.at(-1)!.cache_control, { type: "ephemeral" });
  }
  const plain = withCachePoint([{ role: "user", content: "x" }]);
  assert.deepEqual(plain[0]!.content, [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }]);
});

test("problems across the app go back after the results, and the build continues until they're fixed", async () => {
  let fixed = false;
  const h = harness([
    { blocks: [write("src/App.vue")] },
    { blocks: [write("src/components/List.vue")] },
  ], {
    runTool: async (c) => { if (c.input.path === "src/components/List.vue") fixed = true; return { content: "Saved.", isError: false }; },
    review: () => (fixed ? null : "These changes leave problems in the app:\n- src/App.vue: imports \"./components/List.vue\", but src/components/List.vue doesn't exist"),
  });
  const r = await h.run();
  assert.equal(h.requests.length, 2);
  const sent = h.requests[1]!.messages.at(-1)!.content as Anthropic.ContentBlockParam[];
  assert.deepEqual(sent.map((b) => b.type), ["tool_result", "text"], "results first, then the problems");
  assert.match((sent[1] as { text: string }).text, /List.vue doesn't exist/);
  assert.match(String(r.rounds[0]!.problems), /List.vue/);
  assert.equal(r.rounds[1]!.problems, null);
});
