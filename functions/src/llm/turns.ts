import type Anthropic from "@anthropic-ai/sdk";
import { addUsage, toTokenUsage, type TokenUsage } from "../credits";
import { assemble, type AssembleHandlers, type ToolCall } from "./assemble";
import type { ToolResult } from "./workspace";

/**
 * A build as a tool loop (docs/plans/tool-protocol.md): each turn streams one response; its tool calls run once
 * the response is complete, and their results go back to the model in the next turn, until the model ends its
 * turn, declines, or a limit is reached. The stream is injectable so the loop can be tested without Claude.
 */
export type StreamFn = (
  params: Anthropic.MessageCreateParamsStreaming,
  signal: AbortSignal,
) => Promise<AsyncIterable<Anthropic.RawMessageStreamEvent>>;

export type TurnsOptions = {
  stream: StreamFn;
  /** The first request without max_tokens: model, system, tools and messages. */
  request: Omit<Anthropic.MessageCreateParamsStreaming, "max_tokens" | "stream">;
  maxOutputTokens: number; // for the whole build, across turns
  /** Requests per build; the last one may not call tools (tool_choice none), so the model has to finish. */
  maxTurns: number;
  /** Aborts the current request (cancel or disconnect). */
  signal: AbortSignal;
  /** Live stream callbacks (text, tool input as it arrives). */
  handlers: AssembleHandlers;
  /** Runs one tool call (never decline). */
  runTool(call: ToolCall): Promise<ToolResult & { read?: string[] }>;
  /** Problems across the app after a response's calls ran (e.g. imports that don't resolve), or null. */
  review?(): string | null;
  /** Called before each extra turn with its request (e.g. to hold credits for it); throwing ends the build. */
  beforeTurn(turn: number, params: Anthropic.MessageCreateParamsStreaming): Promise<void>;
  /** Cancel or disconnect, checked between turns. */
  stopped(): boolean;
};

export type TurnsResult = {
  /** The last turn's response, when it completed. */
  message: Anthropic.Message | null;
  /** All turns' usage, including a turn cut off by an error (estimated from its streamed output if needed). */
  usage: TokenUsage;
  /** Set when a turn failed or a beforeTurn refused (e.g. 402); the changes already made are kept. */
  error: unknown;
  /** Stopped between turns (cancel or disconnect) without an error. */
  stoppedBetweenTurns: boolean;
  /** The model's reason when it called decline, or "" for a refusal by the API; null otherwise. */
  declined: string | null;
  /** The output cap ended a tool call mid-input (that call was not run). */
  truncated: boolean;
  /** The tool call still being written when the build ended (cut off, cancelled or failed), by its block index. */
  unfinished: { name: string; index: number } | null;
  /** One entry per model request, for observability (observability/buildTrace.ts). */
  rounds: Round[];
};

export type ToolCallRecord = { name: string; paths: string[]; read: string[]; isError: boolean; result: string };
export type Round = {
  n: number;
  startedAt: number; // epoch ms
  ms: number; // request start to its end (including the tool calls that followed it)
  responseMs: number; // request start to the end of the response
  toolMs: number; // time spent running this round's tool calls
  firstTokenMs: number | null; // request start to the first text or tool input, if any
  usage: TokenUsage;
  /** Output tokens spent on thinking (part of usage.outputTokens; Sonnet 5.5 thinks by default). 0 when unknown. */
  thinkingTokens: number;
  stopReason: string | null; // null when the request failed
  toolCalls: ToolCallRecord[];
  /** Problems across the app reported to the model after this round's calls (never code), or null. */
  problems?: string | null;
};

// Rough chars-per-token, used only when a cut-off stream reported less output than it delivered.
const CHARS_PER_TOKEN = 3.5;
const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
const FILE_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);

/** The messages with a cache point on the last block of the latest user turn (earlier points stay readable). */
export function withCachePoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages.length - 1;
  return messages.map((m, i) => {
    if (i !== last || m.role !== "user") return m;
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    const end = blocks.length - 1;
    return { ...m, content: blocks.map((b, j) => (j === end ? { ...b, cache_control: { type: "ephemeral" as const } } : b)) };
  });
}

/** The paths a call names (for observability; never its content). */
const pathsOf = (c: ToolCall): string[] => {
  const v = c.name === "read_files" ? c.input.paths : [c.input.path];
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
};

export async function runTurns(o: TurnsOptions): Promise<TurnsResult> {
  const messages = [...o.request.messages];
  let usage = ZERO;
  const rounds: Round[] = [];
  const result = (r: Partial<TurnsResult>): TurnsResult => ({
    message: null, usage, error: null, stoppedBetweenTurns: false, declined: null, truncated: false, unfinished: null, rounds, ...r,
  });

  /** Runs calls in order and records them on the round. */
  async function run(round: Round, calls: ToolCall[]) {
    const started = Date.now();
    const results: (ToolResult & { read?: string[] })[] = [];
    for (const c of calls) results.push(await o.runTool(c));
    round.toolMs = Date.now() - started;
    round.toolCalls = calls.map((c, i) => ({
      name: c.name, paths: pathsOf(c), read: results[i]!.read ?? [], isError: results[i]!.isError,
      // Read results carry file contents, which are never recorded; other results are short messages.
      result: c.name === "read_files" ? `Read ${(results[i]!.read ?? []).join(", ") || "nothing"}` : results[i]!.content.slice(0, 200),
    }));
    return results;
  }

  for (let turn = 0; ; turn++) {
    const lastTurn = turn >= o.maxTurns - 1;
    const params: Anthropic.MessageCreateParamsStreaming = {
      ...o.request,
      messages: withCachePoint(messages),
      max_tokens: Math.max(1, o.maxOutputTokens - usage.outputTokens),
      stream: true,
      ...(lastTurn ? { tool_choice: { type: "none" as const } } : {}),
    };
    if (turn > 0) {
      if (o.stopped()) return result({ stoppedBetweenTurns: true });
      try {
        await o.beforeTurn(turn, params);
      } catch (error) {
        return result({ error });
      }
    }
    const started = Date.now();
    const round: Round = {
      n: turn + 1, startedAt: started, ms: 0, responseMs: 0, toolMs: 0, firstTokenMs: null, usage: ZERO, thinkingTokens: 0, stopReason: null, toolCalls: [],
    };
    rounds.push(round);
    const first = () => { round.firstTokenMs ??= Date.now() - started; };
    const handlers: AssembleHandlers = {
      onText: (t) => { first(); o.handlers.onText?.(t); },
      onToolStart: (i, name) => { first(); o.handlers.onToolStart?.(i, name); },
      onToolInput: o.handlers.onToolInput,
      onToolEnd: o.handlers.onToolEnd,
    };
    let a;
    try {
      a = await assemble(await o.stream(params, o.signal), handlers);
    } catch (error) {
      round.ms = round.responseMs = Date.now() - started;
      return result({ error });
    }
    const m = a.message;
    round.responseMs = round.ms = Date.now() - started;
    round.usage = toTokenUsage(m.usage);
    if (a.error) round.usage.outputTokens = Math.max(round.usage.outputTokens, Math.ceil(a.chars / CHARS_PER_TOKEN));
    round.thinkingTokens = m.usage.output_tokens_details?.thinking_tokens ?? 0;
    round.stopReason = a.error ? null : m.stop_reason;
    usage = addUsage(usage, round.usage);
    const unfinished = a.openTool;

    // Failed, cancelled or disconnected mid-response: keep the file changes that were completed, nothing else.
    if (a.error) {
      await run(round, a.calls.filter((c) => FILE_TOOLS.has(c.name)));
      return result({ error: a.error, unfinished });
    }
    if (m.stop_reason === "refusal") return result({ message: m, declined: "" });
    const decline = a.calls.find((c) => c.name === "decline");
    if (decline) return result({ message: m, declined: typeof decline.input.reason === "string" ? decline.input.reason : "" });

    // At the output cap the last call's input is cut off (invalid JSON): it is never run.
    const truncated = m.stop_reason === "max_tokens" && a.calls.at(-1)?.error != null;
    const calls = truncated ? a.calls.slice(0, -1) : a.calls;
    const results = await run(round, calls);
    round.ms = Date.now() - started;
    if (truncated) return result({ message: m, truncated: true, unfinished: { name: a.calls.at(-1)!.name, index: a.calls.at(-1)!.index } });
    if (m.stop_reason !== "tool_use" || !calls.length) return result({ message: m, truncated: m.stop_reason === "max_tokens" });
    // Every change went through and nothing was read: the build is done. Another turn would only re-send the files
    // just written (measured: ~4,300 tokens of cache writes and a closing sentence, about +80% on a new app's cost).
    // Refused changes and reads go back to the model.
    // Problems across the app (imports) go back too, after the results.
    const problems = o.review?.() ?? null;
    round.problems = problems;
    const settled = !problems && calls.every((c) => c.name !== "read_files") && results.every((r) => !r.isError);
    if (settled || lastTurn || usage.outputTokens >= o.maxOutputTokens) return result({ message: m });

    messages.push({ role: "assistant", content: m.content as Anthropic.ContentBlockParam[] });
    const toolResults: Anthropic.ContentBlockParam[] = calls.map((c, i) => ({ type: "tool_result" as const, tool_use_id: c.id, content: results[i]!.content, is_error: results[i]!.isError }));
    messages.push({ role: "user", content: problems ? [...toolResults, { type: "text" as const, text: problems }] : toolResults });
  }
}
