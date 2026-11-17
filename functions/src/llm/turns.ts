import type Anthropic from "@anthropic-ai/sdk";
import { addUsage, toTokenUsage, type TokenUsage } from "../credits";

/**
 * A build as up to three model turns: the model may call read_files (llm/tools.ts) up to `maxReadTurns` times,
 * then must answer. Text streams to `onText` (the output parser) as it arrives; tool calls never reach it.
 * The stream is injectable so the loop can be tested without Claude.
 */
export type TurnStream = {
  on(event: "text", listener: (text: string) => void): unknown;
  finalMessage(): Promise<Anthropic.Message>;
  abort(): void;
  readonly currentMessage?: { usage?: Partial<Anthropic.Usage> } | undefined;
};
export type StreamFn = (params: Anthropic.MessageStreamParams) => TurnStream;

export type TurnsOptions = {
  stream: StreamFn;
  /** The first request without max_tokens: model, system, tools (if any) and messages. */
  request: Omit<Anthropic.MessageStreamParams, "max_tokens">;
  maxOutputTokens: number; // for the whole build, across turns
  maxReadTurns: number;
  /** Adds a moving cache point on the latest user turn (worth it only when a read turn is likely). */
  cacheConversation: boolean;
  onText(text: string): void;
  /** The current stream, so cancellation and disconnects can abort it. */
  onStream(stream: TurnStream): void;
  /** Runs one tool call; reads that change nothing still return a result for the model. */
  runTool(block: Anthropic.ToolUseBlock): Promise<{ content: string; is_error: boolean; read: string[] }>;
  /** Called before each extra turn with its request (e.g. to hold credits for it); throwing ends the build. */
  beforeTurn(turn: number, params: Anthropic.MessageStreamParams): Promise<void>;
  /** Called when the model reads files, after the reads ran (`paths` read) and with the file left open, if any. */
  onRead(paths: string[], openFile: string | null): void;
  /** The output parser's open file at a tool call (dropped: it can't continue in the next turn). */
  discardOpenFile(): string | null;
  /** Cancel or disconnect, checked between turns. */
  stopped(): boolean;
};

export type TurnsResult = {
  /** The last turn's message, when it completed. */
  message: Anthropic.Message | null;
  /** All turns' usage, including a turn cut off by an error (estimated from its streamed text if needed). */
  usage: TokenUsage;
  readTurns: number;
  /** Set when a turn failed or a beforeTurn refused (e.g. 402); the build keeps what completed. */
  error: unknown;
  /** Stopped between turns (cancel or disconnect) without an error. */
  stoppedBetweenTurns: boolean;
  /** One entry per model request, for observability (observability/buildTrace.ts). */
  rounds: Round[];
};

export type ToolCallRecord = { name: string; paths: string[]; read: string[]; isError: boolean };
export type Round = {
  n: number;
  startedAt: number; // epoch ms
  ms: number; // request start to its end (including tool calls that followed it)
  responseMs: number; // request start to the model's final message
  toolMs: number; // time spent running this round's tool calls
  firstTokenMs: number | null; // request start to the first text, if any
  usage: TokenUsage;
  /** Output tokens spent on thinking (part of usage.outputTokens; Sonnet 5.5 thinks by default). 0 when unknown. */
  thinkingTokens: number;
  stopReason: string | null; // null when the request failed
  toolCalls: ToolCallRecord[];
};

// Rough chars-per-token, used only when a cut-off stream reported less output than the text it delivered.
const CHARS_PER_TOKEN = 3.5;

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

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

export async function runTurns(o: TurnsOptions): Promise<TurnsResult> {
  const messages = [...o.request.messages];
  let usage = ZERO;
  let readTurns = 0;
  const rounds: Round[] = [];
  const done = (message: Anthropic.Message | null, error: unknown = null, stoppedBetweenTurns = false): TurnsResult =>
    ({ message, usage, readTurns, error, stoppedBetweenTurns, rounds });
  for (let turn = 0; ; turn++) {
    const remaining = o.maxOutputTokens - usage.outputTokens;
    const lastTurn = readTurns >= o.maxReadTurns;
    const params: Anthropic.MessageStreamParams = {
      ...o.request,
      // No cache point on the last turn: nothing comes after it to read the cache back.
      messages: o.cacheConversation && !lastTurn ? withCachePoint(messages) : messages,
      max_tokens: remaining,
      // After the read turns the model must answer with what it has (tools and system stay cached).
      ...(o.request.tools && lastTurn && turn > 0 ? { tool_choice: { type: "none" as const } } : {}),
    };
    let chars = 0;
    let stream: TurnStream | null = null;
    let round: Round | null = null;
    let started = 0;
    try {
      if (turn > 0) {
        if (o.stopped()) return done(null, null, true);
        await o.beforeTurn(turn, params);
      }
      started = Date.now();
      round = {
        n: turn + 1, startedAt: started, ms: 0, responseMs: 0, toolMs: 0, firstTokenMs: null, usage: ZERO, thinkingTokens: 0, stopReason: null, toolCalls: [],
      };
      rounds.push(round);
      const r = round;
      stream = o.stream(params);
      o.onStream(stream);
      stream.on("text", (t) => {
        if (r.firstTokenMs === null) r.firstTokenMs = Date.now() - started;
        chars += t.length;
        o.onText(t);
      });
      const message = await stream.finalMessage();
      r.usage = toTokenUsage(message.usage);
      r.thinkingTokens = message.usage.output_tokens_details?.thinking_tokens ?? 0;
      r.stopReason = message.stop_reason;
      r.ms = r.responseMs = Date.now() - started;
      usage = addUsage(usage, r.usage);
      const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      // Answer, refusal, output cap (a truncated tool input is never run), or read limit reached.
      if (message.stop_reason !== "tool_use" || !calls.length || lastTurn) return done(message);
      const openFile = o.discardOpenFile();
      const toolsStarted = Date.now();
      const results = await Promise.all(calls.map((c) => o.runTool(c)));
      r.toolMs = Date.now() - toolsStarted;
      r.toolCalls = calls.map((c, i) => ({
        name: c.name,
        paths: ((c.input as { paths?: unknown })?.paths as unknown[] | undefined ?? []).filter((p): p is string => typeof p === "string"),
        read: results[i]!.read,
        isError: results[i]!.is_error,
      }));
      r.ms = Date.now() - started;
      readTurns++;
      o.onRead(results.flatMap((r) => r.read), openFile);
      messages.push({ role: "assistant", content: message.content });
      messages.push({
        role: "user",
        content: calls.map((c, i) => ({ type: "tool_result" as const, tool_use_id: c.id, content: results[i]!.content, is_error: results[i]!.is_error })),
      });
      if (usage.outputTokens >= o.maxOutputTokens) return done(message);
    } catch (error) {
      // A cut-off turn has no final usage: take what its stream reported, and at least its streamed text.
      // A round that already finished (e.g. a tool call failed afterwards) is counted once, from its final usage.
      if (stream && round && round.stopReason === null) {
        const cut = toTokenUsage(stream.currentMessage?.usage);
        cut.outputTokens = Math.max(cut.outputTokens, Math.ceil(chars / CHARS_PER_TOKEN));
        usage = addUsage(usage, cut);
        round.usage = cut;
        round.ms = round.responseMs = Date.now() - started;
      }
      return done(null, error);
    }
  }
}
