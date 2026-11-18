import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes, setLangfuseTracerProvider, startObservation } from "@langfuse/tracing";
import { context, trace, type Span } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import type { SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { logger } from "firebase-functions";
import { costUsd, type TokenUsage } from "../credits";
import { errorStep, type BuildTraceInput } from "./buildTrace";

/**
 * Build traces in Langfuse: one trace per build (`build-app`), grouped into a session per app (follow-ups read as
 * a conversation) and tagged with the user. Each model request is a `generation` with its tokens and cost; each
 * read_files call is a `tool` beside the generation that asked for it; preparing the context and saving are spans.
 *
 * The trace is built after the build ends, from the timings `generate` recorded, so tracing never delays or breaks
 * a stream. Content rule: the prompt and Claude's plan only; no file contents or code (the mask below is a second
 * line of defence). The tracer provider is isolated (never global), so the Anthropic SDK emits no spans of its own.
 */
let processor: SpanProcessor | null = null;
const FLUSH_TIMEOUT_MS = 3000;

/** Installs the span processor (once per instance in production; tests pass an in-memory one). */
export function useTraceProcessor(next: SpanProcessor | null): void {
  // propagateAttributes keeps user and session in the OpenTelemetry context; that needs a context manager.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  processor = next;
  setLangfuseTracerProvider(next ? new NodeTracerProvider({ spanProcessors: [next] }) : null);
}

/** File contents never belong in a trace: replaces any `<document_content>…</document_content>` that slipped into a field. */
export const stripFileContent = (data: string): string =>
  data.replace(/(<document_content>)[\s\S]*?(<\/document_content>)/g, "$1[content not traced]$2");

/**
 * The Langfuse span processor as Genesis configures it. It also applies the propagated user, session and tags to
 * each span as it starts. Tests pass an in-memory `exporter` instead of the network.
 */
export function langfuseProcessor(cfg: { publicKey: string; secretKey: string; baseUrl: string; exporter?: SpanExporter }): SpanProcessor {
  return new LangfuseSpanProcessor({
    ...cfg,
    environment: process.env.FUNCTIONS_EMULATOR === "true" ? "development" : "production",
    mask: ({ data }) => stripFileContent(typeof data === "string" ? data : JSON.stringify(data)),
    ...(cfg.exporter ? { exportMode: "immediate" as const } : {}),
  });
}

/** Langfuse, configured from the functions' params and secrets. Idempotent. */
export function ensureLangfuse(cfg: { publicKey: string; secretKey: string; baseUrl: string }): void {
  if (!processor) useTraceProcessor(langfuseProcessor(cfg));
}

/**
 * Runs `create` with `parent` as the active span, so the new observation is its child AND keeps the user, session
 * and tags propagated in the current context (an explicit parentSpanContext would drop them).
 */
const under = <T>(parent: { otelSpan: Span }, create: () => T): T =>
  context.with(trace.setSpan(context.active(), parent.otelSpan), create);

/**
 * Usage in Langfuse's buckets, which must not overlap: `output` excludes the thinking tokens, reported as
 * `output_reasoning_tokens` (Anthropic counts thinking inside output_tokens).
 */
const usageDetails = (u: TokenUsage, thinkingTokens = 0) => ({
  input: u.inputTokens,
  output: u.outputTokens - thinkingTokens,
  output_reasoning_tokens: thinkingTokens,
  cache_read_input_tokens: u.cacheReadTokens,
  cache_creation_input_tokens: u.cacheWriteTokens,
});

/** Cost in the same buckets as usageDetails (thinking is billed at the output rate). */
function costDetails(model: string, u: TokenUsage, thinkingTokens = 0) {
  const c = costUsd(model, u);
  const reasoning = u.outputTokens ? c.output * (thinkingTokens / u.outputTokens) : 0;
  return { ...c, output: c.output - reasoning, output_reasoning_tokens: reasoning };
}

type Round = BuildTraceInput["rounds"][number];
const NOT_TRACED = "(not traced)";

/**
 * A round's tool calls in the OpenAI message shape Langfuse renders as cards; ids pair them with their results.
 * Only the paths a call names are shown, never the content it writes.
 */
const toolCallMessages = (r: Round) => r.toolCalls.map((c, i) => ({
  id: `call_${r.n}_${i}`, type: "function",
  function: { name: c.name, arguments: JSON.stringify(c.name === "read_files" ? { paths: c.paths } : { path: c.paths[0] ?? null }) },
}));
/** What a tool call returned, as traced: read results by name only (they carry file contents). */
const toolResultText = (c: Round["toolCalls"][number]) =>
  c.name === "read_files" ? `Returned ${c.read.join(", ") || "nothing"} ${NOT_TRACED}${c.isError ? " (error)" : ""}` : c.result;

/**
 * The messages round `n` was sent: the system prompt and file contents as placeholders, the earlier chat turns
 * (prompts and plan summaries), the request with the names of the files it carried, and every earlier read
 * (call and result, paired by id). Mirrors what Claude saw without carrying code.
 */
export function conversationUpTo(t: BuildTraceInput, n: number) {
  const files = [
    `Current project files, sent in full ${NOT_TRACED}: ${t.context.full.join(", ") || "none"}`,
    ...(t.context.indexed.length ? [`Listed only, readable with read_files: ${t.context.indexed.join(", ")}`] : []),
  ].join("\n");
  const messages: unknown[] = [
    { role: "system", content: `Genesis build rules, UI kit and HighLevel API reference ${NOT_TRACED}` },
    ...t.history,
    { role: "user", content: `${files}\n\nRequest: ${t.prompt}` },
  ];
  for (const r of t.rounds.slice(0, n - 1)) {
    messages.push({ role: "assistant", content: "", tool_calls: toolCallMessages(r) });
    r.toolCalls.forEach((c, i) => messages.push({
      role: "tool", tool_call_id: `call_${r.n}_${i}`,
      content: toolResultText(c),
    }));
    if (r.problems) messages.push({ role: "user", content: r.problems }); // paths and messages, never code
  }
  return messages;
}

/** Sends the build's trace and returns its id (null when tracing is off or sending failed). Never throws. */
export async function sendBuildTrace(t: BuildTraceInput): Promise<string | null> {
  if (!processor) return null;
  try {
    const declined = t.status === "declined";
    const at = (ms: number) => new Date(ms);
    const streamStart = t.startedAt + t.timings.checksMs + t.timings.contextMs + t.timings.holdMs;
    const saveStart = streamStart + t.timings.streamMs;
    const failed = t.error && t.status !== "cancelled";
    const files = t.actions.written.map((w) => w.path);
    let traceId: string | null = null;

    await propagateAttributes({
      userId: t.uid,
      sessionId: t.projectId, // one session per app: its builds in order are the conversation of follow-ups
      traceName: "build-app",
      tags: [
        t.status,
        t.followUp.previousGenerationId ? "follow-up" : "first-build",
        ...(t.context.indexed.length ? ["large-app"] : []),
        ...(t.rounds.some((r) => r.toolCalls.some((c) => c.name === "read_files")) ? ["read-files"] : []),
      ],
      metadata: { generationId: t.generationId, projectName: t.projectName },
    }, async () => {
      const root = startObservation("build-app", {
        // A declined prompt is never stored anywhere, including here.
        input: declined ? { prompt: null, note: "declined: the request is not kept" } : { prompt: t.prompt },
        output: declined ? null : { plan: t.plan, filesChanged: [...files, ...t.actions.deleted] },
        level: failed ? "ERROR" : t.actions.rejected.length ? "WARNING" : "DEFAULT",
        statusMessage: t.error ? `${errorStep(t.error.code)}: ${t.error.code}: ${t.error.message}` : undefined,
        metadata: {
          status: t.status, model: t.model, fileStore: t.fileStore, contextTools: t.contextTools,
          previousGenerationId: t.followUp.previousGenerationId, historyMessages: t.followUp.historyMessages,
          credits: t.credits, timings: t.timings, steps: t.steps, coldStart: t.coldStart,
        },
      }, { asType: "agent", startTime: at(t.startedAt) });
      traceId = root.traceId;

      const contextStart = t.startedAt + t.timings.checksMs;
      under(root, () => startObservation("prepare-context", {
        input: { activePath: t.context.activePath, openPaths: t.context.openPaths, recentPaths: t.context.recentPaths },
        output: { sentInFull: t.context.full, listedOnly: t.context.indexed, characters: t.context.chars, guides: t.context.guides },
      }, { startTime: at(contextStart) })).end(at(contextStart + t.timings.contextMs));

      for (const r of t.rounds) {
        const asked = toolCallMessages(r);
        const final = !r.toolCalls.length;
        under(root, () => startObservation("generate-changes", {
          model: t.model,
          // What the model saw, as role-labelled messages, minus the parts that are never traced.
          input: declined ? null : conversationUpTo(t, r.n),
          output: final
            ? (declined ? null : { role: "assistant", content: [t.plan, files.length ? `Files: ${files.join(", ")}` : ""].filter(Boolean).join("\n\n") })
            : { role: "assistant", content: "", tool_calls: asked },
          usageDetails: usageDetails(r.usage, r.thinkingTokens),
          costDetails: costDetails(t.model, r.usage, r.thinkingTokens),
          completionStartTime: r.firstTokenMs !== null ? at(r.startedAt + r.firstTokenMs) : undefined,
          level: r.stopReason === null ? "ERROR" : r.stopReason === "max_tokens" || r.stopReason === "refusal" ? "WARNING" : "DEFAULT",
          statusMessage: r.stopReason === null ? "request failed or was stopped"
            : r.stopReason === "max_tokens" ? "stopped at the output limit (max_tokens): the file being written was cut off"
            : r.stopReason === "refusal" ? "refused by the API" : undefined,
          metadata: { round: r.n, stopReason: r.stopReason, thinkingTokens: r.thinkingTokens },
        }, { asType: "generation", startTime: at(r.startedAt) })).end(at(r.startedAt + r.responseMs));

        const toolStart = r.startedAt + r.responseMs;
        for (const c of r.toolCalls) {
          const read = c.name === "read_files";
          under(root, () => startObservation(c.name.replace(/_/g, "-"), {
            input: read ? { paths: c.paths } : { path: c.paths[0] ?? null },
            output: read ? { read: c.read, notRead: c.paths.filter((p) => !c.read.includes(p)) } : { result: c.result },
            level: c.isError ? "WARNING" : "DEFAULT",
            metadata: { round: r.n },
          }, { asType: "tool", startTime: at(toolStart) })).end(at(toolStart + r.toolMs));
        }
      }

      const save = under(root, () => startObservation("save-changes", {
        input: { proposed: [...files, ...t.actions.deleted, ...t.actions.rejected.map((x) => x.path)] },
        output: { written: t.actions.written, deleted: t.actions.deleted, rejected: t.actions.rejected, toolErrors: t.toolErrors, problems: t.problems, snapshotId: t.actions.snapshotId },
        level: t.actions.rejected.length || t.toolErrors.length || t.problems.length || t.codeInText ? "WARNING" : "DEFAULT",
      }, { startTime: at(saveStart) }));
      const summaryUsage = t.summaryUsage;
      if (summaryUsage) {
        under(save, () => startObservation("summarize-change", {
          model: t.summaryModel,
          input: { request: t.prompt, plan: t.plan, files: files },
          output: t.actions.summary,
          usageDetails: usageDetails(summaryUsage),
          costDetails: costDetails(t.summaryModel, summaryUsage),
        }, { asType: "generation", startTime: at(saveStart) })).end(at(saveStart + t.timings.saveMs));
      }
      save.end(at(saveStart + t.timings.saveMs));
      root.end(at(t.endedAt));
    });
    // Cloud Functions throttle CPU once the response ends, so flush now, but never hold a build up for long.
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS).unref());
    await Promise.race([processor.forceFlush(), timeout]);
    return traceId;
  } catch (err) {
    logger.warn("build.trace_send_failed", { generationId: t.generationId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
