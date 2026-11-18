import { logger } from "firebase-functions";
import type { TokenUsage } from "../credits";
import type { Round } from "../llm/turns";

/**
 * Everything observability needs to know about one build, collected by `generate` and used twice: as structured
 * log events in Cloud Logging (metadata only, never text) and as a Langfuse trace (observability/langfuse.ts).
 * Content rule (docs/plans/observability.md): the user's prompt and Claude's plan text may be traced; file
 * contents and generated code never are; a declined prompt is never kept anywhere.
 */
export type BuildTraceInput = {
  generationId: string;
  uid: string;
  projectId: string;
  projectName: string;
  startedAt: number; // epoch ms
  endedAt: number;
  status: string; // done | partial | error | cancelled | declined
  error: { code: string; message: string } | null;
  prompt: string;
  plan: string;
  followUp: { previousGenerationId: string | null; historyMessages: number };
  /** The chat turns sent before this request (stored prompts and plan summaries; never code). */
  history: { role: "user" | "assistant"; content: string }[];
  model: string;
  summaryModel: string;
  fileStore: string;
  /** Whether this build offered the read_files tool (CONTEXT_TOOLS). */
  contextTools: boolean;
  context: { full: string[]; indexed: string[]; chars: number; activePath: string | null; openPaths: string[]; recentPaths: string[] };
  rounds: Round[];
  actions: { written: { path: string; bytes: number }[]; deleted: string[]; rejected: { path: string; reason: string }[]; snapshotId: string | null; summary: string | null };
  /** Tool calls refused when they ran (the model was told why and could correct them). */
  toolErrors: { tool: string; path: string; error: string }[];
  /** Import problems left in the app when the build ended (the files were saved). */
  problems: string[];
  /** The model wrote code in its text instead of a tool call (that code is never saved). */
  codeInText: boolean;
  credits: { held: number; extraHolds: number; charged: number };
  summaryUsage: TokenUsage | null;
  /** Durations of the steps before the stream, and of saving; firstTokenMs is from the request start. */
  timings: { checksMs: number; contextMs: number; holdMs: number; firstTokenMs: number | null; streamMs: number; saveMs: number };
  /** Each step inside those phases (e.g. verifyUser, readFiles, countTokens, uploadFiles, summary, settleCredits). */
  steps: StepTimes;
  /** The first build this instance served (it paid the cold start). */
  coldStart: boolean;
};

/** Milliseconds per named step of a build (a step run several times adds up). */
export type StepTimes = Record<string, number>;

/** Times named steps: `await time("upload", () => …)`. Steps run in parallel are each timed on their own. */
export function stepTimer() {
  const steps: StepTimes = {};
  const time = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      steps[name] = (steps[name] ?? 0) + (Date.now() - started);
    }
  };
  return { steps, time };
}

/** Which step an error code comes from, so a reader can tell where a build failed. */
export function errorStep(code: string): string {
  if (["llm_error", "disconnected", "cancelled", "truncated"].includes(code)) return "stream";
  if (code === "insufficient_credits") return "read hold";
  if (["invalid_output", "malformed_output"].includes(code)) return "validate";
  if (code === "persist_failed") return "save";
  return "build";
}

export const totalUsage = (rounds: Round[]): TokenUsage => rounds.reduce(
  (a, r) => ({
    inputTokens: a.inputTokens + r.usage.inputTokens,
    outputTokens: a.outputTokens + r.usage.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + r.usage.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + r.usage.cacheReadTokens,
  }),
  { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
);

/** A structured log line (Cloud Logging `jsonPayload`). Never put prompt, plan or file content in `fields`. */
export function logEvent(event: string, fields: Record<string, unknown>): void {
  logger.info(event, { event, ...fields });
}

/** The build's log events: one per round, one per rejected file, and `build.end` (the source for log metrics). */
export function logBuild(t: BuildTraceInput, traceId: string | null): void {
  const ids = { generationId: t.generationId, uid: t.uid, projectId: t.projectId };
  for (const r of t.rounds) {
    logEvent("build.round", {
      ...ids, n: r.n, ms: r.ms, responseMs: r.responseMs, toolMs: r.toolMs, firstTokenMs: r.firstTokenMs, stopReason: r.stopReason,
      ...r.usage, thinkingTokens: r.thinkingTokens,
      toolCalls: r.toolCalls.map((c) => ({ name: c.name, paths: c.paths, read: c.read, isError: c.isError })),
      problems: r.problems ?? null,
    });
  }
  for (const r of t.actions.rejected) logEvent("build.rejected", { ...ids, path: r.path, reason: r.reason });
  for (const e of t.toolErrors) logEvent("build.tool_error", { ...ids, tool: e.tool, path: e.path, error: e.error });
  if (t.codeInText) logEvent("build.code_in_text", { ...ids });
  for (const p of t.problems) logEvent("build.problem", { ...ids, problem: p });
  logEvent("build.end", {
    ...ids,
    status: t.status, errorCode: t.error?.code ?? null, errorStep: t.error ? errorStep(t.error.code) : null,
    model: t.model, fileStore: t.fileStore, contextTools: t.contextTools,
    rounds: t.rounds.length, readRounds: t.rounds.filter((r) => r.toolCalls.some((c) => c.name === "read_files")).length,
    ...totalUsage(t.rounds),
    thinkingTokens: t.rounds.reduce((n, r) => n + r.thinkingTokens, 0),
    systemCacheHit: t.rounds[0] ? t.rounds[0].usage.cacheReadTokens > 0 : null,
    creditsHeld: t.credits.held, creditsCharged: t.credits.charged,
    filesInFull: t.context.full.length, filesIndexed: t.context.indexed.length, contextChars: t.context.chars,
    written: t.actions.written.length, deleted: t.actions.deleted.length, rejected: t.actions.rejected.length, toolErrors: t.toolErrors.length, problems: t.problems.length, codeInText: t.codeInText,
    followUp: t.followUp.previousGenerationId !== null,
    ...t.timings, totalMs: t.endedAt - t.startedAt,
    steps: t.steps, coldStart: t.coldStart,
    traceId,
  });
}
