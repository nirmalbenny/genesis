// Test helper (used by assemble.test.ts and turns.test.ts): raw stream events in the API's shape, so the loop is
// tested on exactly what Claude sends, chunked like a real stream.
import type Anthropic from "@anthropic-ai/sdk";

export type FakeBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "tool"; name: string; input: unknown; id?: string; raw?: string };

export type FakeTurn = {
  blocks: FakeBlock[];
  stop?: Anthropic.Message["stop_reason"];
  usage?: { input: number; output: number; thinking?: number };
  /** Fail after this many events (a dropped connection or an abort). */
  failAfter?: number;
  /** Cut the last block off: no content_block_stop for it, then end the message (the output cap). */
  cutLast?: boolean;
  /** Characters per delta (default 7). */
  chunk?: number;
};

const split = (s: string, n: number) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")) ?? [];

export function turnEvents(t: FakeTurn): Anthropic.RawMessageStreamEvent[] {
  const n = t.chunk ?? 7;
  const u = t.usage ?? { input: 100, output: 50 };
  const ev: unknown[] = [{
    type: "message_start",
    message: { id: "msg", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: u.input, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  }];
  t.blocks.forEach((b, index) => {
    const last = index === t.blocks.length - 1;
    if (b.type === "text") {
      ev.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } });
      for (const c of split(b.text, n)) ev.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: c } });
    } else if (b.type === "thinking") {
      ev.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
      for (const c of split(b.thinking, n)) ev.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: c } });
      ev.push({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: b.signature } });
    } else {
      ev.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: b.id ?? `toolu_${index}`, name: b.name, input: {} } });
      const json = b.raw ?? JSON.stringify(b.input);
      for (const c of split(json, n)) ev.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: c } });
    }
    if (!(last && t.cutLast)) ev.push({ type: "content_block_stop", index });
  });
  const stop = t.stop ?? (t.blocks.some((b) => b.type === "tool") ? "tool_use" : "end_turn");
  ev.push({
    type: "message_delta", delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: u.output, input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null,
      output_tokens_details: { thinking_tokens: u.thinking ?? 0 } },
  });
  ev.push({ type: "message_stop" });
  return ev as Anthropic.RawMessageStreamEvent[];
}

/** The events as an async stream; fails after `failAfter` events, or when `signal` aborts. */
export async function* streamOf(t: FakeTurn, signal?: AbortSignal): AsyncGenerator<Anthropic.RawMessageStreamEvent> {
  let i = 0;
  for (const e of turnEvents(t)) {
    if (signal?.aborted) throw new Error("Request was aborted.");
    if (t.failAfter !== undefined && i >= t.failAfter) throw new Error("socket hang up");
    i++;
    await Promise.resolve();
    yield e;
  }
}
