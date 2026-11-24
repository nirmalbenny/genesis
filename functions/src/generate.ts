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
import { countInput } from "./llm/count";
import { recordBuild } from "./buildHistory";
import { notify } from "./notifications";
import { summarizeChange } from "./llm/summary";
import type { ToolCall } from "./llm/assemble";
import { renderContext, selectContext } from "./llm/context";
import { selectGuides } from "./llm/guides";
import { RECENT_MESSAGES, systemBlocks, uiOf } from "./llm/prompt";
import { buildTools, runBuildTool, runReadFiles } from "./llm/tools";
import { createFieldReader } from "./llm/toolInput";
import { runTurns } from "./llm/turns";
import { checkPath, type FileOp, type Rejection } from "./llm/validate";
import { createWorkspace } from "./llm/workspace";
import { logBuild, stepTimer, type BuildTraceInput } from "./observability/buildTrace";
import { ensureLangfuse, sendBuildTrace } from "./observability/langfuse";
import { assertEditable, getOwnedProject, getUserHl, useConnectedLocation } from "./projects";

const MAX_PROMPT_CHARS = 4000;
const MAX_HINT_PATHS = 10; // active + open editor tabs sent as context hints
const RECENT_GENERATIONS = 2; // files changed by these rank first in a large app's context
export const MAX_OUTPUT_TOKENS = 16000; // for the whole build, across its turns
export const MAX_READ_CALLS = 2; // read_files calls per build; later ones are answered with an error
export const MAX_TURNS = 6; // requests per build; the last one can't call tools, so the model has to finish
const HEARTBEAT_MS = 15_000;
// Worst case for the one-line Haiku snapshot summary, included in every build's hold.
const SUMMARY_ALLOWANCE: TokenUsage = { inputTokens: 1000, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 };
type Status = "done" | "partial" | "error" | "cancelled";

export const DECLINED_MESSAGE =
  "I can't fulfill this request. Genesis only builds and edits apps that show your HighLevel data, and it can't help with harmful or unrelated requests. Describe a change to your app and I'll take it from there.";

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
      // Every change comes back as a tool call (docs/plans/tool-protocol.md). The tool set is the same for every
      // build, so tools and system prompt are one shared cache entry; read_files is in it unless CONTEXT_TOOLS=off.
      const contextTools = CONTEXT_TOOLS.value() === "on";
      const history = recent.docs
        .reverse()
        .map((d) => ({ role: d.get("role") as "user" | "assistant", content: d.get("content") as string }));
      const filesText = renderContext(files, manifest, selection.index, contextTools);
      // The HighLevel guides this build needs: what the app uses already, and what the request mentions.
      const guides = selectGuides({
        prompt,
        helpers: Object.values(manifest).flatMap((e) => e.hlHelpers),
        sources: files.map((f) => f.content),
      });
      const request = {
        model,
        // The UI library the app is built with (Element Plus, or the older kit for apps that use it).
        system: systemBlocks(guides, uiOf(files.map((f) => f.content))),
        tools: buildTools(contextTools),
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
        projectName, fileStore: FILE_STORE.value(), contextTools,
        followUp: { previousGenerationId: lastBuilds.docs[0]?.id ?? null, historyMessages: history.length },
        history,
        context: { guides, full: selection.full, indexed: selection.index, chars: filesText.length, activePath, openPaths, recentPaths },
        checksMs: checksDone - startedAt, contextMs: contextDone - checksDone, holdMs: Date.now() - contextDone,
      };
      ctx = { uid, pid, prompt, proj, store, manifest, files, contextTools, request, genRef, held, trace };
    } catch (err) {
      if (slot) await releaseBuildSlot(slot.uid, slot.generationId).catch((e) => console.error("generate: slot release failed", e));
      sendError(res, err);
      return;
    }
    const { uid, pid, prompt, proj, store, manifest, files, contextTools, request, genRef, trace } = ctx;
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
    // The working copy: context files are known to the model; tool calls change it; it's persisted at the end.
    const workspace = createWorkspace(manifest);
    for (const f of files) workspace.show(f.path, f.content);
    const planParts: string[] = [];
    /** Refused changes the model hasn't fixed since, by path (or tool name when the input had no path). */
    const unresolved = new Map<string, Rejection & { tool: string }>();
    const toolErrors: { tool: string; path: string; error: string }[] = [];

    // write_file inputs stream into the editor as they arrive: file_start once the path is known, then the content.
    let firstTokenAt: number | null = null;
    const live = new Map<number, { path: string | null; reader: ReturnType<typeof createFieldReader> }>();
    const callPaths = new Map<number, string>(); // this turn's write_file paths by block index, as streamed
    let afterTool = false; // text after tool calls starts a new paragraph of the chat
    const handlers = {
      onText: (text: string) => {
        firstTokenAt ??= Date.now();
        if (afterTool && planParts.length) { planParts.push("\n\n"); send("token", { text: "\n\n", path: null }); }
        afterTool = false;
        planParts.push(text);
        send("token", { text, path: null });
      },
      onToolStart: (index: number, name: string) => {
        firstTokenAt ??= Date.now();
        afterTool = true;
        callPaths.delete(index);
        if (name !== "write_file") return;
        let pathText = "";
        let early = ""; // content that arrived before the path
        const file = {
          path: null as string | null,
          reader: createFieldReader((key, text, done) => {
            if (key === "path" && file.path === null) {
              pathText += text;
              if (!done) return;
              if (checkPath(pathText) !== null) { live.delete(index); return; } // refused when it runs; never shown
              file.path = pathText;
              callPaths.set(index, pathText);
              send("file_start", { path: file.path });
              if (early) send("token", { text: early, path: file.path });
            } else if (key === "content" && text) {
              if (file.path) send("token", { text, path: file.path });
              else early += text;
            }
          }),
        };
        live.set(index, file);
      },
      onToolInput: (index: number, json: string) => live.get(index)?.reader.push(json),
      onToolEnd: (call: ToolCall) => {
        const file = live.get(call.index);
        live.delete(call.index);
        // An input that didn't parse (cut off at the output cap, or malformed) is not a finished file.
        if (file?.path && !call.error) send("file_end", { path: file.path, bytes: typeof call.input.content === "string" ? Buffer.byteLength(call.input.content) : 0 });
      },
    };

    let readCalls = 0;
    const readFiles = (input: unknown) => runReadFiles(
      input, manifest, (paths) => store.read(pid, paths), (p) => workspace.shown(p), (f) => workspace.show(f.path, f.content),
    );
    const runTool = async (call: ToolCall) => {
      if (call.name === "read_files") {
        const allowed = contextTools && readCalls < MAX_READ_CALLS;
        if (allowed) {
          readCalls++;
          const paths = Array.isArray(call.input.paths) ? call.input.paths.filter((p): p is string => typeof p === "string") : [];
          send("status", { phase: "reading", paths });
        }
        return runBuildTool(call, { workspace, readFiles: allowed ? readFiles : null });
      }
      const r = await runBuildTool(call, { workspace, readFiles: null });
      const path = typeof call.input.path === "string" ? call.input.path : callPaths.get(call.index) ?? "";
      const key = path || `(${call.name})`;
      if (r.isError) {
        toolErrors.push({ tool: call.name, path, error: r.content });
        unresolved.set(key, { tool: call.name, path: key, reason: r.content.replace(/^Not \w+: /, "").replace(/\.$/, "") });
      } else {
        unresolved.delete(key);
        if (call.name === "edit_file") { // the edited file, whole, for the editor
          send("file_start", { path });
          send("token", { text: workspace.content(path) ?? "", path });
          send("file_end", { path, bytes: Buffer.byteLength(workspace.content(path) ?? "") });
        }
      }
      return r;
    };

    // Stop requests (POST .../generations/:gid/cancel) arrive as a flag on the generation doc, so they reach
    // this instance whichever instance served them. Once the model has finished, a late stop is ignored.
    const abort = new AbortController();
    let cancelled = false;
    let streamEnded = false;
    res.on("close", () => {
      if (!res.writableFinished) { clientGone = true; abort.abort(); }
    });
    const stopWatching = genRef.onSnapshot((s) => {
      if (s.get("cancelRequested") && !streamEnded && !cancelled) { cancelled = true; abort.abort(); }
    }, () => {});

    const streamStarted = Date.now();
    const turns = await runTurns({
      stream: (params, signal) => client.messages.create(params, { signal }),
      request,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxTurns: MAX_TURNS,
      signal: abort.signal,
      handlers,
      runTool,
      review: () => {
        const problems = workspace.problems();
        return problems.length
          ? `These changes leave problems in the app:\n${problems.map((p) => `- ${p}`).join("\n")}\nFix them with further calls.`
          : null;
      },
      // Each extra turn re-sends the conversation: hold its input at the dearest rate (the output cap is already held).
      beforeTurn: async (turn, params) => {
        const extra = chargeable(worstCaseCredits(model, await countInput(client, params), 0));
        await extendHold(uid, generationId, turn, extra);
        held += extra;
      },
      stopped: () => cancelled || clientGone,
    });
    const streamMs = Date.now() - streamStarted;
    const buildUsage = turns.usage;
    let failure: { code: string; message: string } | null = null;
    let summaryUsage: TokenUsage | null = null;
    const refused = turns.declined !== null;
    if (refused) console.info("generate: request declined by model:", (turns.declined || "API refusal").slice(0, 200)); // never the prompt
    if (turns.error || turns.stoppedBetweenTurns) {
      const e = turns.error as { status?: number; code?: string; message?: string } | null;
      failure = cancelled
        ? { code: "cancelled", message: "Stopped." }
        : clientGone
        ? { code: "disconnected", message: "Connection to the client was lost." }
        : e?.status === 402
        ? { code: "insufficient_credits", message: e.message ?? "Not enough AI credits to continue this build." }
        : { code: "llm_error", message: turns.error instanceof Error ? turns.error.message : "The model request failed." };
    } else if (turns.truncated) {
      failure = { code: "truncated", message: "The model hit its output limit; the last file was cut off." };
    }
    // The file being written when the build ended (cut off, stopped or failed) is not saved.
    const unclosed = turns.unfinished ? callPaths.get(turns.unfinished.index) ?? null : null;
    const rejected: Rejection[] = [...unresolved.values()].map(({ path, reason }) => ({ path, reason }));
    if (unclosed) rejected.push({ path: unclosed, reason: "cut off before it was finished" });
    const ops: FileOp[] = workspace.ops();
    const problems = workspace.problems(); // left after the model's last turn
    const plan = planParts.join("").trim();
    const codeInText = /```|<template[\s>]|<script[\s>]/.test(plan);
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
        status, error: failure, prompt, plan, followUp: trace.followUp, history: trace.history,
        model, summaryModel, fileStore: trace.fileStore, contextTools: trace.contextTools, context: trace.context,
        rounds: turns.rounds, actions, toolErrors, problems, codeInText, credits: { held, extraHolds: held - ctx.held, charged }, summaryUsage,
        timings: {
          checksMs: trace.checksMs, contextMs: trace.contextMs, holdMs: trace.holdMs,
          firstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt, streamMs, saveMs: Date.now() - saveStarted,
        },
        steps, coldStart,
      };
      const traceId = await sendBuildTrace(input);
      logBuild(input, traceId);
    };
    // ---- Declined: nothing is stored in history; the client shows a transient notice ----
    if (refused && !ops.length) {
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
    let summaryText: string | null = null;
    saveStarted = Date.now();
    try {
      if (ops.length) {
        await time("uploadFiles", () => store.apply(pid, ops));
        applied = ops.map((o) => o.path);
        // A stopped build gets a fixed label instead of a model-written summary: no extra wait or cost.
        const summarized = cancelled
          ? { summary: "Stopped before finishing", usage: null }
          : await time("summary", () => summarizeChange(client, summaryModel, { prompt, plan: plan, files: applied }));
        if (summarized.usage) summaryUsage = toTokenUsage(summarized.usage);
        summaryText = summarized.summary;
        snapshotId = await time("snapshot", () => store.snapshot(pid, generationId, "generation", summarized.summary));
      }

      if (!failure && problems.length) {
        failure = { code: "invalid_output", message: `Saved, but some files have problems: ${problems.join("; ")}` };
      } else if (!failure && rejected.length) {
        failure = {
          code: "invalid_output",
          message: `Some changes were rejected: ${rejected.map((r) => `${r.path} (${r.reason})`).join("; ")}`,
        };
      } else if (!failure && !applied.length && (!plan || codeInText)) {
        failure = { code: "malformed_output", message: "The model returned no valid file changes." };
      }
      status = cancelled ? "cancelled" : !failure ? "done" : applied.length ? "partial" : "error";

      await time("saveMessages", () => proj.collection("messages").add({
        role: "user", content: prompt, generationId, createdAt: FieldValue.serverTimestamp(),
      }));
      const stopped = !cancelled ? ""
        : !applied.length ? "Stopped before any files were written."
        : `Stopped. Kept the files below${unclosed ? `; ${unclosed} was not finished` : ""}.`;
      const prose = [plan, stopped].filter(Boolean).join("\n\n");
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
      written: ops.flatMap((o) => (o.type === "write" ? [{ path: o.path, bytes: Buffer.byteLength(o.content) }] : [])),
      deleted: ops.flatMap((o) => (o.type === "delete" ? [o.path] : [])),
      rejected,
      snapshotId,
      summary: summaryText,
    }, credits.charged);
    await recordBuild(uid, generationId, {
      projectId: pid, mode: "single", appName: trace.projectName, request: prompt, href: `/p/${pid}`, credits: credits.charged,
      outcome: status === "done" ? "updated" : status === "partial" ? "partial" : status === "cancelled" ? "stopped" : "failed",
    });
    // A stopped build was the user's own doing; every other ending is worth telling them about, wherever they are.
    if (status !== "cancelled") {
      await notify(uid, {
        kind: status === "done" ? "build_done" : status === "partial" ? "build_partial" : "build_failed",
        title: status === "done" ? `${trace.projectName} is updated` : status === "partial" ? `${trace.projectName} was updated with problems` : `${trace.projectName} couldn't be updated`,
        body: status === "done" ? summaryText ?? "Your changes are ready." : failure?.message ?? "",
        href: `/p/${pid}`, projectId: pid, generationId,
      });
    }
    if (status === "cancelled") {
      send("cancelled", { generationId, snapshotId, files: applied, unfinished: unclosed, credits });
    } else if (failure) send("error", { ...failure, partial: applied.length > 0, credits });
    else send("done", { generationId, snapshotId, files: applied, credits });
    clearInterval(heartbeat);
    if (!clientGone) res.end();
  },
);
