import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { createParser, type ParseEvent } from "./parser";
import { runTurns, withCachePoint, type StreamFn, type TurnsOptions, type TurnStream } from "./turns";
import { validateOps } from "./validate";

type Script = { text?: string; reads?: string[][]; stop?: Anthropic.Message["stop_reason"]; fail?: Error; usage?: [number, number] };

/** A fake Claude: each call plays the next scripted turn (text deltas, then tool calls) and records the request. */
function fakeClaude(script: Script[]) {
  const requests: Anthropic.MessageStreamParams[] = [];
  const stream: StreamFn = (params) => {
    requests.push(structuredClone(params));
    const turn = script[requests.length - 1]!;
    let onText: (t: string) => void = () => {};
    let aborted = false;
    const s: TurnStream = {
      on: (_e, l) => { onText = l; return s; },
      abort: () => { aborted = true; },
      currentMessage: { usage: { input_tokens: 100, output_tokens: 7 } },
      async finalMessage() {
        for (const chunk of (turn.text ?? "").match(/.{1,5}/gs) ?? []) onText(chunk);
        if (turn.fail || aborted) throw turn.fail ?? new Error("aborted");
        const calls = (turn.reads ?? []).map((paths, i) => ({ type: "tool_use", id: `t${requests.length}-${i}`, name: "read_files", input: { paths } }));
        const [input, output] = turn.usage ?? [100, 50];
        return {
          content: [...(turn.text ? [{ type: "text", text: turn.text }] : []), ...calls],
          stop_reason: turn.stop ?? (calls.length ? "tool_use" : "end_turn"),
          usage: { input_tokens: input, output_tokens: output, output_tokens_details: { thinking_tokens: Math.floor(output / 2) } },
        } as unknown as Anthropic.Message;
      },
    };
    return s;
  };
  return { stream, requests };
}

const TOOL = { name: "read_files", description: "d", input_schema: { type: "object" as const } };

function harness(script: Script[], over: Partial<TurnsOptions> = {}) {
  const claude = fakeClaude(script);
  const events: ParseEvent[] = [];
  const parser = createParser((e) => events.push(e));
  const seen = new Set(["src/App.vue"]);
  const reads: { paths: string[]; open: string | null }[] = [];
  const held: number[] = [];
  const options: TurnsOptions = {
    stream: claude.stream,
    request: { model: "m", system: "s", tools: [TOOL], messages: [{ role: "user", content: "files + request" }] },
    maxOutputTokens: 16_000,
    maxReadTurns: 2,
    cacheConversation: false,
    onText: (t) => parser.push(t),
    onStream: () => {},
    runTool: async (b) => {
      const paths = (b.input as { paths: string[] }).paths;
      paths.forEach((p) => seen.add(p));
      return { content: paths.map((p) => `<file path="${p}">\n…\n</file>`).join("\n"), is_error: false, read: paths };
    },
    beforeTurn: async (turn) => { held.push(turn); },
    onRead: (paths, open) => { reads.push({ paths, open }); },
    discardOpenFile: () => parser.discardOpenFile(),
    stopped: () => false,
    ...over,
  };
  return { claude, events, parser, seen, reads, held, run: () => runTurns(options) };
}

const writes = (events: ParseEvent[]) =>
  events.flatMap((e) => (e.type === "file_end" ? [{ type: "write" as const, path: e.path, content: e.content }] : []));

test("read, then write: tool results go back to the model, only text reaches the parser, usage adds up", async () => {
  const h = harness([
    { reads: [["src/components/List.vue"]], usage: [1000, 40] },
    { text: '<plan>Add a column.</plan>\n<file path="src/components/List.vue">\nnew\n</file>', usage: [1200, 300] },
  ]);
  const r = await h.run();
  assert.equal(r.error, null);
  assert.equal(r.readTurns, 1);
  assert.deepEqual(r.usage, { inputTokens: 2200, outputTokens: 340, cacheWriteTokens: 0, cacheReadTokens: 0 });
  assert.deepEqual(h.reads, [{ paths: ["src/components/List.vue"], open: null }]);
  assert.deepEqual(h.held, [1], "the extra turn was held for before it started");
  const second = h.claude.requests[1]!;
  assert.equal(second.max_tokens, 16_000 - 40, "the output cap is for the whole build");
  assert.equal(second.tool_choice, undefined, "the model may still read once more");
  assert.deepEqual(second.messages.map((m) => m.role), ["user", "assistant", "user"]);
  const result = (second.messages[2]!.content as Anthropic.ToolResultBlockParam[])[0]!;
  assert.equal(result.type, "tool_result");
  assert.equal(result.tool_use_id, "t1-0");
  // The guard accepts the rewrite because the file was read.
  assert.equal(h.parser.end(), null);
  assert.deepEqual(validateOps(writes(h.events), new Set(["src/App.vue", "src/components/List.vue"]), h.seen).rejected, []);
});

test("after two read turns the model must answer: tool_choice none on the last turn", async () => {
  const h = harness([{ reads: [["src/A.vue"]] }, { reads: [["src/B.vue"]] }, { text: "<plan>Done.</plan>" }]);
  const r = await h.run();
  assert.equal(r.readTurns, 2);
  assert.equal(h.claude.requests.length, 3);
  assert.deepEqual(h.claude.requests[2]!.tool_choice, { type: "none" });
  assert.deepEqual(h.claude.requests[2]!.tools, [TOOL], "tools stay identical, so the cached prefix survives");
  assert.equal(r.message?.stop_reason, "end_turn");
});

test("the conversation gets a cache point on every turn except the last, which nothing reads back", async () => {
  const h = harness([{ reads: [["src/A.vue"]] }, { reads: [["src/B.vue"]] }, { text: "<plan>Done.</plan>" }], { cacheConversation: true });
  await h.run();
  const marked = h.claude.requests.map((r) => JSON.stringify(r.messages).includes('"cache_control"'));
  assert.deepEqual(marked, [true, true, false]);
});

test("a stop between turns ends the build before the next turn starts", async () => {
  let stopped = false;
  const h = harness([{ reads: [["src/A.vue"]] }, { text: "never" }], { stopped: () => stopped, onRead: () => { stopped = true; } });
  const r = await h.run();
  assert.equal(r.stoppedBetweenTurns, true);
  assert.equal(h.claude.requests.length, 1);
  assert.deepEqual(h.held, [], "nothing more is held");
});

test("a refused extra hold (402) ends the build cleanly with the usage so far", async () => {
  const refuse = Object.assign(new Error("Reading more files needs up to 30 more AI credits"), { status: 402 });
  const h = harness([{ reads: [["src/A.vue"]], usage: [800, 20] }], { beforeTurn: async () => { throw refuse; } });
  const r = await h.run();
  assert.equal(r.error, refuse);
  assert.deepEqual(r.usage, { inputTokens: 800, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 });
});

test("a refusal on the second turn is returned as the final message", async () => {
  const h = harness([{ reads: [["src/A.vue"]] }, { stop: "refusal" as Anthropic.Message["stop_reason"] }]);
  const r = await h.run();
  assert.equal(r.message?.stop_reason, "refusal");
  assert.equal(r.readTurns, 1);
});

test("a file left open at a tool call is dropped; writing an unread existing file is still rejected", async () => {
  const h = harness([
    { text: '<file path="src/App.vue">\nhalf', reads: [["src/A.vue"]] },
    { text: '<file path="src/Other.vue">\nblind\n</file>' },
  ]);
  await h.run();
  assert.deepEqual(h.reads, [{ paths: ["src/A.vue"], open: "src/App.vue" }]);
  assert.equal(h.parser.end(), null);
  const { valid, rejected } = validateOps(writes(h.events), new Set(["src/App.vue", "src/Other.vue"]), h.seen);
  assert.deepEqual(valid, []);
  assert.deepEqual(rejected.map((x) => x.path), ["src/Other.vue"], "Other.vue exists and was never read");
});

test("a cut-off turn counts what its stream reported, or at least its streamed text", async () => {
  const h = harness([{ reads: [["src/A.vue"]], usage: [500, 10] }, { text: "x".repeat(70), fail: new Error("socket hang up") }]);
  const r = await h.run();
  assert.match(String(r.error), /socket hang up/);
  // 500 + 100 input; output 10 + max(7 reported, 70 chars / 3.5 = 20).
  assert.deepEqual(r.usage, { inputTokens: 600, outputTokens: 30, cacheWriteTokens: 0, cacheReadTokens: 0 });
});

test("the moving cache point marks only the last block of the latest user turn", () => {
  const marked = withCachePoint([
    { role: "user", content: "first" },
    { role: "assistant", content: [{ type: "text", text: "a" }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x" }, { type: "tool_result", tool_use_id: "u", content: "y" }] },
  ]);
  assert.equal(marked[0]!.content, "first", "earlier turns are untouched (their cache entries stay readable)");
  const last = marked[2]!.content as Anthropic.ToolResultBlockParam[];
  assert.equal(last[0]!.cache_control, undefined);
  assert.deepEqual(last[1]!.cache_control, { type: "ephemeral" });
  const single = withCachePoint([{ role: "user", content: "only" }]);
  assert.deepEqual(single[0]!.content, [{ type: "text", text: "only", cache_control: { type: "ephemeral" } }]);
});

test("every round is reported with its tokens, stop reason, timing and tool calls; a failed tool call isn't counted twice", async () => {
  const h = harness([{ text: "x", reads: [["src/A.vue", 7 as unknown as string]], usage: [900, 30] }, { text: "<plan>Ok.</plan>", usage: [1000, 200] }]);
  const r = await h.run();
  assert.equal(r.rounds.length, 2);
  assert.deepEqual(r.rounds.map((x) => [x.n, x.stopReason, x.usage.inputTokens, x.usage.outputTokens, x.thinkingTokens]),
    [[1, "tool_use", 900, 30, 15], [2, "end_turn", 1000, 200, 100]], "thinking is read from output_tokens_details");
  assert.deepEqual(r.rounds[0]!.toolCalls, [{ name: "read_files", paths: ["src/A.vue"], read: ["src/A.vue", 7 as unknown as string], isError: false }]);
  assert.ok(r.rounds.every((x) => x.ms >= 0 && x.firstTokenMs !== null));

  const failing = harness([{ reads: [["src/A.vue"]], usage: [500, 10] }], { runTool: async () => { throw new Error("storage down"); } });
  const f = await failing.run();
  assert.match(String(f.error), /storage down/);
  assert.deepEqual(f.usage, { inputTokens: 500, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 }, "counted once");
  assert.equal(f.rounds[0]!.stopReason, "tool_use");
});
