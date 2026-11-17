import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import {
  ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_SUMMARY_MODEL, APP_ORIGINS, CONTEXT_TOOLS, FILE_STORE, LANGFUSE_BASE_URL,
  LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, TRACING,
} from "./config";
import {
  chargeable, creditsFor, extendHold, holdCredits, releaseBuildSlot, reserveBuildSlot, settleCredits, toTokenUsage,
  worstCaseCredits,
  type TokenUsage,
} from "./credits";
import { fileStore, projectRef } from "./files";
import { httpError, requireVerifiedUser, sendError } from "./http";
import { createParser } from "./llm/parser";
import { summarizeChange } from "./llm/summary";
import { renderContext, selectContext } from "./llm/context";
import { RECENT_MESSAGES, SINGLE_FILE_LIMIT_CHARS, systemBlocks } from "./llm/prompt";
import { READ_FILES_TOOL, runReadFiles } from "./llm/tools";
import { runTurns, type TurnStream } from "./llm/turns";
import { checkPath, NOT_READ, validateOps, type FileOp, type Rejection } from "./llm/validate";
import { logBuild, stepTimer, type BuildTraceInput } from "./observability/buildTrace";
import { ensureLangfuse, sendBuildTrace } from "./observability/langfuse";
import { assertEditable, getOwnedProject, getUserHl, useConnectedLocation } from "./projects";

const MAX_PROMPT_CHARS = 4000;
const MAX_HINT_PATHS = 10; // active + open editor tabs sent as context hints
const RECENT_GENERATIONS = 2; // files changed by these rank first in a large app's context
const MAX_OUTPUT_TOKENS = 16000; // for the whole build, across its turns
const MAX_READ_TURNS = 2; // read_files calls per build; the turn after the last one must answer
const HEARTBEAT_MS = 15_000;
// Worst case for the one-line Haiku snapshot summary, included in every build's hold.
const SUMMARY_ALLOWANCE: TokenUsage = { inputTokens: 1000, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 };
// Rough chars-per-token, used only when token counting is unavailable. Low on purpose: code tokenizes densely,
// and an estimate that is too low would under-hold credits.
const CHARS_PER_TOKEN = 2.5;

type Status = "done" | "partial" | "error" | "cancelled";

const DECLINED_MESSAGE =
  "I can't fulfill this request. Genesis only builds and edits apps that show your HighLevel data, and it can't help with harmful or unrelated requests. Describe a change to your app and I'll take it from there.";

/** Exact input tokens of a request (free API call), or a conservative estimate when counting fails. */
function countInput(client: Anthropic, p: Pick<Anthropic.MessageCountTokensParams, "model" | "system" | "tools" | "tool_choice" | "messages">): Promise<number> {
  const params = { model: p.model, system: p.system, tools: p.tools, tool_choice: p.tool_choice, messages: p.messages };
  return client.messages.countTokens(params)
    .then((r) => r.input_tokens)
    .catch(() => Math.ceil(JSON.stringify(params).length / CHARS_PER_TOKEN));
}

type Time = ReturnType<typeof stepTimer>["time"];

async function precheck(req: Request, time: Time) {
  if (req.method !== "POST") throw httpError(405, "method_not_allowed", "POST only");
  const uid = await time("verifyUser", () => requireVerifiedUser(req));
  const pid = String(req.body?.projectId ?? "");
  const prompt = String(req.body?.prompt ?? "").trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    throw httpError(400, "invalid_prompt", `Prompt must be 1-${MAX_PROMPT_CHARS} characters`);
  }
  const project = await time("loadProject", () => getOwnedProject(uid, pid));
  assertEditable(project);
  const hl = await time("loadConnection", () => getUserHl(uid));
  if (!hl) throw httpError(409, "hl_not_connected", "HighLevel is not connected. Connect it before generating.");
  await time("updateLocation", () => useConnectedLocation(pid, project, hl.locationId));
  return { uid, pid, prompt, projectName: project.name, ...editorHints(req.body) };
}

/** The editor's active and open tabs: hints for ranking context only, so invalid paths are dropped, not refused. */
function editorHints(body: Record<string, unknown> | undefined): { activePath: string | null; openPaths: string[] } {
  const valid = (p: unknown): p is string => typeof p === "string" && p.length <= 300 && checkPath(p) === null;
  const activePath = valid(body?.activePath) ? body.activePath : null;
  const open = Array.isArray(body?.openPaths) ? body.openPaths.filter(valid) : [];
  return { activePath, openPaths: [...new Set(open)].filter((p) => p !== activePath).slice(0, MAX_HINT_PATHS - (activePath ? 1 : 0)) };
}

// Builds served by this instance: the first one paid the cold start (loading code, opening connections).
let buildsServed = 0;

export const generate = onRequest(
  {
    cors: APP_ORIGINS, secrets: [ANTHROPIC_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY], timeoutSeconds: 540, memory: "512MiB",
  },
  async (req, res) => {
    const startedAt = Date.now();
    const coldStart = buildsServed++ === 0;
    const { steps, time } = stepTimer();
    if (TRACING.value() === "langfuse") {
      ensureLangfuse({ publicKey: LANGFUSE_PUBLIC_KEY.value(), secretKey: LANGFUSE_SECRET_KEY.value(), baseUrl: LANGFUSE_BASE_URL.value() });
    }
    // ---- Pre-stream: checks, context and the credit hold. Failures here are plain JSON errors. ----
    // The SDK's own OpenTelemetry spans are off: they would duplicate the Langfuse trace and carry file contents.
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), openTelemetry: false });
    const model = ANTHROPIC_MODEL.value();
    const summaryModel = ANTHROPIC_SUMMARY_MODEL.value();
    let ctx;
    let slot: { uid: string; generationId: string } | null = null;
    try {
      const { uid, pid, prompt, projectName, activePath, openPaths } = await precheck(req, time);
      const proj = projectRef(pid);
      const checksDone = Date.now();
      // Rate limit first, so a refused build costs no token count, no credit hold and no Claude call.
      const genRef = proj.collection("generations").doc();
      await time("reserveSlot", () => reserveBuildSlot(uid, pid, genRef.id));
      slot = { uid, generationId: genRef.id };
      const store = fileStore();
      const [manifest, recent, lastBuilds] = await Promise.all([
        time("loadManifest", () => store.manifest(pid)),
        time("loadHistory", () => proj.collection("messages").orderBy("createdAt", "desc").limit(RECENT_MESSAGES).get()),
        time("loadRecentBuilds", () => proj.collection("generations").orderBy("createdAt", "desc").limit(RECENT_GENERATIONS).get()),
      ]);
      const recentPaths = lastBuilds.docs.flatMap((d) => (d.get("files") as string[] | undefined) ?? []);
      // Content is read only for the files sent in full.
      const selection = selectContext(manifest, { activePath, openPaths, recentPaths, prompt });
      const files = await time("readFiles", () => store.read(pid, selection.full));
      // With context tools, every build sends the same tool (one shared prompt cache); the conversation itself is
      // cached only when files were left out, i.e. when a read turn is likely (docs/plans/filestore-and-context.md R3).
      const tools = CONTEXT_TOOLS.value() === "on";
      const cacheConversation = tools && selection.index.length > 0;
      const history = recent.docs
        .reverse()
        .map((d) => ({ role: d.get("role") as "user" | "assistant", content: d.get("content") as string }));
      const filesText = renderContext(files, manifest, selection.index, tools);
      const request = {
        model,
        system: systemBlocks(),
        ...(tools ? { tools: [READ_FILES_TOOL] } : {}),
        messages: [
          ...history,
          { role: "user" as const, content: `Current project files:\n${filesText}\n\nRequest: ${prompt}` },
        ],
      };
      const contextDone = Date.now();

      // Hold the worst case: exact input tokens priced as a cache miss, the full output cap and the summary allowance.
      const inputTokens = await time("countTokens", () => countInput(client, request));
      const held = chargeable(
        worstCaseCredits(model, inputTokens, MAX_OUTPUT_TOKENS) + creditsFor(summaryModel, SUMMARY_ALLOWANCE),
      );
      await time("holdCredits", () => holdCredits(uid, genRef.id, held));
      // The prompt and chat messages are saved only after the model accepts the request,
      // so declined (off-topic or harmful) requests never enter history or later model context.
      await time("createGeneration", () => genRef.set({ status: "streaming", createdAt: FieldValue.serverTimestamp() }));
      const trace = {
        projectName, fileStore: FILE_STORE.value(), contextTools: tools,
        followUp: { previousGenerationId: lastBuilds.docs[0]?.id ?? null, historyMessages: history.length },
        history,
        context: { full: selection.full, indexed: selection.index, chars: filesText.length, activePath, openPaths, recentPaths },
        checksMs: checksDone - startedAt, contextMs: contextDone - checksDone, holdMs: Date.now() - contextDone,
      };
      ctx = { uid, pid, prompt, proj, store, manifest, seen: new Set(selection.full), request, cacheConversation, genRef, held, trace };
    } catch (err) {
      if (slot) await releaseBuildSlot(slot.uid, slot.generationId).catch((e) => console.error("generate: slot release failed", e));
      sendError(res, err);
      return;
    }
    const { uid, pid, prompt, proj, store, manifest, seen, request, cacheConversation, genRef, trace } = ctx;
    let held = ctx.held; // grows when a read turn holds more
    const generationId = genRef.id;

    // ---- SSE setup ----
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    let clientGone = false;
    const send = (event: string, data: unknown) => {
      if (!clientGone) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => { if (!clientGone) res.write(": ping\n\n"); }, HEARTBEAT_MS);
    send("start", { generationId });

    // ---- Stream ----
    const ops: FileOp[] = [];
    const planParts: string[] = [];
    let refused = false;
    const rejected: Rejection[] = [];
    const parser = createParser((e) => {
      if (e.type === "token") {
        send("token", { text: e.text, path: e.path });
        if (e.path === null) planParts.push(e.text);
      } else if (e.type === "file_start") send("file_start", { path: e.path });
      else if (e.type === "file_end") {
        ops.push({ type: "write", path: e.path, content: e.content });
        send("file_end", { path: e.path, bytes: Buffer.byteLength(e.content) });
      } else if (e.type === "refuse") {
        refused = true;
        console.info("generate: request declined by model:", e.reason.slice(0, 200)); // the reason, never the prompt
      } else ops.push({ type: "delete", path: e.path });
    });

    // Stop requests (POST .../generations/:gid/cancel) arrive as a flag on the generation doc, so they reach
    // this instance whichever instance served them. Once the model has finished, a late stop is ignored.
    let current: TurnStream | null = null;
    let cancelled = false;
    let streamEnded = false;
    res.on("close", () => {
      if (!res.writableFinished) { clientGone = true; current?.abort(); }
    });
    const stopWatching = genRef.onSnapshot((s) => {
      if (s.get("cancelRequested") && !streamEnded && !cancelled) { cancelled = true; current?.abort(); }
    }, () => {});

    let firstTokenAt: number | null = null;
    const streamStarted = Date.now();
    const turns = await runTurns({
      stream: (params) => client.messages.stream(params),
      request,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxReadTurns: MAX_READ_TURNS,
      cacheConversation,
      onText: (t) => {
        firstTokenAt ??= Date.now();
        parser.push(t);
      },
      onStream: (s) => { current = s; },
      runTool: (block) => block.name === READ_FILES_TOOL.name
        ? runReadFiles(block.input, manifest, (paths) => store.read(pid, paths), seen)
        : Promise.resolve({ content: `Unknown tool ${block.name}.`, is_error: true, read: [] }),
      // Each extra turn re-sends the conversation: hold its input at the dearest rate (the output cap is already held).
      beforeTurn: async (turn, params) => {
        const extra = chargeable(worstCaseCredits(model, await countInput(client, params), 0));
        await extendHold(uid, generationId, turn, extra);
        held += extra;
      },
      onRead: (paths, openFile) => {
        if (openFile) rejected.push({ path: openFile, reason: "the model stopped writing it to read files" });
        send("status", { phase: "reading", paths });
      },
      discardOpenFile: () => parser.discardOpenFile(),
      stopped: () => cancelled || clientGone,
    });
    const streamMs = Date.now() - streamStarted;
    const buildUsage = turns.usage;
    let failure: { code: string; message: string } | null = null;
    let summaryUsage: TokenUsage | null = null;
    const final = turns.message;
    if (turns.error || turns.stoppedBetweenTurns) {
      const e = turns.error as { status?: number; code?: string; message?: string } | null;
      failure = cancelled
        ? { code: "cancelled", message: "Stopped." }
        : clientGone
        ? { code: "disconnected", message: "Connection to the client was lost." }
        : e?.status === 402
        ? { code: "insufficient_credits", message: e.message ?? "Not enough AI credits to read more files." }
        : { code: "llm_error", message: turns.error instanceof Error ? turns.error.message : "The model request failed." };
    } else if (final) {
      // Harmful requests can be refused by the API itself: empty content with this stop reason.
      if ((final.stop_reason as string) === "refusal") refused = true;
      if (final.stop_reason === "max_tokens") {
        failure = { code: "truncated", message: "The model hit its output limit; the last file was cut off." };
      }
    }
    streamEnded = true;
    stopWatching();

    /** Releases the hold, charges what this build used, and reports both to the client. */
    const settle = async (usage: TokenUsage) => {
      const exact = creditsFor(model, usage) + (summaryUsage ? creditsFor(summaryModel, summaryUsage) : 0);
      const charged = Math.min(held, chargeable(exact));
      const balance = await time("settleCredits", () => settleCredits(uid, generationId, held, charged, {
        model, usage, summaryModel, summaryUsage, projectId: pid,
      })).catch((err) => {
        console.error("generate: credit settlement failed", err);
        return null;
      });
      await time("recordCharge", () => genRef.update({ credits: charged, usage: { model, ...usage }, ...(summaryUsage ? { summaryUsage } : {}) })).catch(() => {});
      return { charged, balance };
    };
    /** Logs the build and sends its trace (observability/), before the response ends. Never throws. */
    let saveStarted = Date.now();
    const observe = async (status: string, failure: { code: string; message: string } | null, actions: BuildTraceInput["actions"], charged: number) => {
      const input: BuildTraceInput = {
        generationId, uid, projectId: pid, projectName: trace.projectName, startedAt, endedAt: Date.now(),
        status, error: failure, prompt, plan: planParts.join("").trim(), followUp: trace.followUp, history: trace.history,
        model, summaryModel, fileStore: trace.fileStore, contextTools: trace.contextTools, context: trace.context,
        rounds: turns.rounds, actions, credits: { held, extraHolds: held - ctx.held, charged }, summaryUsage,
        timings: {
          checksMs: trace.checksMs, contextMs: trace.contextMs, holdMs: trace.holdMs,
          firstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt, streamMs, saveMs: Date.now() - saveStarted,
        },
        steps, coldStart,
      };
      const traceId = await sendBuildTrace(input);
      logBuild(input, traceId);
    };
    const unclosed = parser.end();
    if (unclosed) rejected.push({ path: unclosed, reason: "file was never closed (output incomplete)" });

    // ---- Declined: nothing is stored in history; the client shows a transient notice ----
    if (refused && !ops.length && !unclosed) {
      await genRef.update({ status: "declined" }).catch(() => {});
      const credits = await settle({ ...buildUsage, outputTokens: 0 }); // declined requests pay for input only
      await observe("declined", null, { written: [], deleted: [], rejected: [], snapshotId: null, summary: null }, credits.charged);
      send("error", { code: "declined", message: DECLINED_MESSAGE, partial: false, credits });
      clearInterval(heartbeat);
      if (!clientGone) res.end();
      return;
    }

    // ---- Persist whatever completed ----
    let status: Status = "error";
    let snapshotId: string | null = null;
    let applied: string[] = [];
    let validOps: FileOp[] = [];
    let summaryText: string | null = null;
    saveStarted = Date.now();
    try {
      const existing = new Set(Object.keys(manifest));
      const tooLarge = new Set(Object.keys(manifest).filter((p) => manifest[p]!.size > SINGLE_FILE_LIMIT_CHARS));
      const result = validateOps(ops, existing, seen);
      rejected.push(...result.rejected.map((r) =>
        r.reason === NOT_READ && tooLarge.has(r.path) ? { ...r, reason: "too large for the AI to edit; split it or edit it by hand" } : r));
      validOps = result.valid;
      if (result.valid.length) {
        await time("uploadFiles", () => store.apply(pid, result.valid));
        applied = result.valid.map((o) => o.path);
        // A stopped build gets a fixed label instead of a model-written summary: no extra wait or cost.
        const summarized = cancelled
          ? { summary: "Stopped before finishing", usage: null }
          : await time("summary", () => summarizeChange(client, summaryModel, { prompt, plan: planParts.join("").trim(), files: applied }));
        if (summarized.usage) summaryUsage = toTokenUsage(summarized.usage);
        summaryText = summarized.summary;
        snapshotId = await time("snapshot", () => store.snapshot(pid, generationId, "generation", summarized.summary));
      }

      if (!failure && rejected.length) {
        failure = {
          code: "invalid_output",
          message: `Some changes were rejected: ${rejected.map((r) => `${r.path} (${r.reason})`).join("; ")}`,
        };
      } else if (!failure && !applied.length && !planParts.join("").trim()) {
        failure = { code: "malformed_output", message: "The model returned no valid file changes." };
      }
      status = cancelled ? "cancelled" : !failure ? "done" : applied.length ? "partial" : "error";

      await time("saveMessages", () => proj.collection("messages").add({
        role: "user", content: prompt, generationId, createdAt: FieldValue.serverTimestamp(),
      }));
      const stopped = !cancelled ? ""
        : !applied.length ? "Stopped before any files were written."
        : `Stopped. Kept the files below${unclosed ? `; ${unclosed} was not finished` : ""}.`;
      const prose = [planParts.join("").trim(), stopped].filter(Boolean).join("\n\n");
      const summary = applied.length ? `${prose}\n\nFiles: ${applied.join(", ")}` : prose || failure?.message || "";
      await time("saveMessages", () => proj.collection("messages").add({
        role: "assistant", content: summary, generationId, createdAt: FieldValue.serverTimestamp(),
      }));
      await time("updateGeneration", () => genRef.update({
        prompt,
        status,
        snapshotId,
        files: applied, // ranks the next builds' context (recently changed files first)
        ...(failure && !cancelled ? { error: failure.message } : {}),
      }));
      if (applied.length) await time("updateProject", () => proj.update({ updatedAt: FieldValue.serverTimestamp() }));
    } catch (err) {
      console.error("generate: persistence failed", err);
      failure = { code: "persist_failed", message: "Could not save the generated files." };
      await genRef.update({ status: "error", error: failure.message }).catch(() => {});
    }

    const credits = await settle(buildUsage);
    await observe(status, failure, {
      written: validOps.flatMap((o) => (o.type === "write" ? [{ path: o.path, bytes: Buffer.byteLength(o.content) }] : [])),
      deleted: validOps.flatMap((o) => (o.type === "delete" ? [o.path] : [])),
      rejected,
      snapshotId,
      summary: summaryText,
    }, credits.charged);
    if (status === "cancelled") {
      send("cancelled", { generationId, snapshotId, files: applied, unfinished: unclosed, credits });
    } else if (failure) send("error", { ...failure, partial: applied.length > 0, credits });
    else send("done", { generationId, snapshotId, files: applied, credits });
    clearInterval(heartbeat);
    if (!clientGone) res.end();
  },
);
