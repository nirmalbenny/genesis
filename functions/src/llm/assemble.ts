import type Anthropic from "@anthropic-ai/sdk";

/**
 * Builds one model response from the raw stream events, instead of the SDK's MessageStream: that one parses tool
 * input tolerantly (a truncated or malformed input can come back as a plausible object, or reject the whole
 * response). Here every tool input is parsed strictly when its block ends; a block that fails to parse is kept with
 * `input: {}` and its error, so the turn's other blocks survive and the model can be told what went wrong.
 */
export type ToolCall = {
  index: number;
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Why the input could not be used (invalid JSON); null when it parsed. */
  error: string | null;
};

export type AssembleHandlers = {
  onText?(text: string): void;
  onToolStart?(index: number, name: string): void;
  onToolInput?(index: number, partialJson: string): void;
  /** A tool block finished streaming (its input is final). */
  onToolEnd?(call: ToolCall): void;
};

export type Assembled = {
  /** The response so far: complete blocks only (a block cut off mid-stream is left out). */
  message: Anthropic.Message;
  /** Completed tool calls, in order. */
  calls: ToolCall[];
  /** The tool block still open when the stream ended or failed, if any. */
  openTool: { index: number; name: string } | null;
  /** Characters of text and tool input received (for estimating the output of a cut-off response). */
  chars: number;
  /** Set when the stream failed or was aborted; everything above is what arrived before. */
  error: unknown;
};

type Open = { block: Record<string, unknown>; json: string };

const EMPTY_USAGE = {
  input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
} as unknown as Anthropic.Usage;

export async function assemble(events: AsyncIterable<Anthropic.RawMessageStreamEvent>, h: AssembleHandlers = {}): Promise<Assembled> {
  let message = { id: "", type: "message", role: "assistant", model: "", content: [], stop_reason: null, stop_sequence: null, usage: { ...EMPTY_USAGE } } as unknown as Anthropic.Message;
  const done: (Anthropic.ContentBlock | undefined)[] = [];
  const open = new Map<number, Open>();
  const calls: ToolCall[] = [];
  let chars = 0;
  let error: unknown = null;
  try {
    for await (const e of events) {
      switch (e.type) {
        case "message_start":
          message = { ...e.message, content: [], usage: { ...EMPTY_USAGE, ...e.message.usage } };
          break;
        case "content_block_start": {
          const block = { ...(e.content_block as unknown as Record<string, unknown>) };
          if (block.type === "tool_use") {
            block.input = {};
            h.onToolStart?.(e.index, String(block.name));
          }
          open.set(e.index, { block, json: "" });
          break;
        }
        case "content_block_delta": {
          const o = open.get(e.index);
          if (!o) break;
          const d = e.delta;
          if (d.type === "text_delta") {
            o.block.text = String(o.block.text ?? "") + d.text;
            chars += d.text.length;
            h.onText?.(d.text);
          } else if (d.type === "input_json_delta") {
            o.json += d.partial_json;
            chars += d.partial_json.length;
            h.onToolInput?.(e.index, d.partial_json);
          } else if (d.type === "thinking_delta") {
            o.block.thinking = String(o.block.thinking ?? "") + d.thinking;
          } else if (d.type === "signature_delta") {
            o.block.signature = d.signature;
          } else if (d.type === "citations_delta") {
            o.block.citations = [...((o.block.citations as unknown[]) ?? []), d.citation];
          }
          break;
        }
        case "content_block_stop": {
          const o = open.get(e.index);
          if (!o) break;
          open.delete(e.index);
          if (o.block.type === "tool_use") {
            const call: ToolCall = { index: e.index, id: String(o.block.id), name: String(o.block.name), input: {}, error: null };
            try {
              const parsed: unknown = JSON.parse(o.json || "{}");
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) call.input = parsed as Record<string, unknown>;
              else call.error = "the input is not a JSON object";
            } catch (err) {
              call.error = `invalid JSON (${(err as Error).message})`;
            }
            o.block.input = call.input;
            calls.push(call);
            h.onToolEnd?.(call);
          }
          done[e.index] = o.block as unknown as Anthropic.ContentBlock;
          break;
        }
        case "message_delta": {
          message.stop_reason = e.delta.stop_reason;
          message.stop_sequence = e.delta.stop_sequence ?? null;
          const u = Object.fromEntries(Object.entries(e.usage).filter(([, v]) => v !== null && v !== undefined));
          message.usage = { ...message.usage, ...u } as Anthropic.Usage;
          break;
        }
        case "message_stop":
          break;
      }
    }
  } catch (err) {
    error = err;
  }
  message.content = done.filter((b): b is Anthropic.ContentBlock => b !== undefined);
  if (!error && message.stop_reason === null) error = new Error("The response ended before it was complete.");
  const toolOpen = [...open.entries()].find(([, o]) => o.block.type === "tool_use");
  return {
    message, calls, chars, error,
    openTool: toolOpen ? { index: toolOpen[0], name: String(toolOpen[1].block.name) } : null,
  };
}
