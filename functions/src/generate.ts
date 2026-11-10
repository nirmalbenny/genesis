import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_SUMMARY_MODEL } from "./config";
import { chargeable, creditsFor, holdCredits, settleCredits, toTokenUsage, type TokenUsage } from "./credits";
import { applyOps, createSnapshot, projectRef, readFiles } from "./files";
import { httpError, sendError, verifyUser } from "./http";
import { createParser } from "./llm/parser";
import { summarizeChange } from "./llm/summary";
import { buildSystemPrompt, RECENT_MESSAGES, renderFiles } from "./llm/prompt";
import { validateOps, type FileOp, type Rejection } from "./llm/validate";
import { assertEditable, getOwnedProject, getUserHl, useConnectedLocation } from "./projects";

const MAX_PROMPT_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 16000;
const HEARTBEAT_MS = 15_000;
// Worst case for the one-line Haiku snapshot summary, included in every build's hold.
const SUMMARY_ALLOWANCE: TokenUsage = { inputTokens: 1000, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 };
// Rough chars-per-token, used only when token counting is unavailable or a stream is cut off.
const CHARS_PER_TOKEN = 3.5;

type Status = "done" | "partial" | "error";

const DECLINED_MESSAGE =
  "I can't fulfill this request. Genesis only builds and edits apps that show your HighLevel data, and it can't help with harmful or unrelated requests. Describe a change to your app and I'll take it from there.";

async function precheck(req: Request) {
  if (req.method !== "POST") throw httpError(405, "method_not_allowed", "POST only");
  const { uid, emailVerified } = await verifyUser(req);
  if (!emailVerified) {
    throw httpError(403, "email_not_verified", "Verify your email address to unlock your AI credits, then try again.");
  }
  const pid = String(req.body?.projectId ?? "");
  const prompt = String(req.body?.prompt ?? "").trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    throw httpError(400, "invalid_prompt", `Prompt must be 1-${MAX_PROMPT_CHARS} characters`);
  }
  const project = await getOwnedProject(uid, pid);
  assertEditable(project);
  const hl = await getUserHl(uid);
  if (!hl) throw httpError(409, "hl_not_connected", "HighLevel is not connected. Connect it before generating.");
  await useConnectedLocation(pid, project, hl.locationId);
  return { uid, pid, prompt, hl };
}

export const generate = onRequest(
  { cors: true, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    // ---- Pre-stream: checks, context and the credit hold. Failures here are plain JSON errors. ----
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const model = ANTHROPIC_MODEL.value();
    const summaryModel = ANTHROPIC_SUMMARY_MODEL.value();
    let ctx;
    try {
      const { uid, pid, prompt, hl } = await precheck(req);
      const proj = projectRef(pid);
      const [files, recent] = await Promise.all([
        readFiles(pid),
        proj.collection("messages").orderBy("createdAt", "desc").limit(RECENT_MESSAGES).get(),
      ]);
      const history = recent.docs
        .reverse()
        .map((d) => ({ role: d.get("role") as "user" | "assistant", content: d.get("content") as string }));
      const request = {
        model,
        system: buildSystemPrompt({ id: hl.locationId, name: hl.locationName }),
        messages: [
          ...history,
          { role: "user" as const, content: `Current project files:\n${renderFiles(files)}\n\nRequest: ${prompt}` },
        ],
      };

      // Hold the worst case: exact input tokens plus the full output cap and the summary allowance.
      const inputTokens = await client.messages.countTokens(request)
        .then((r) => r.input_tokens)
        .catch(() => Math.ceil(JSON.stringify(request).length / CHARS_PER_TOKEN));
      const held = chargeable(
        creditsFor(model, { inputTokens, outputTokens: MAX_OUTPUT_TOKENS, cacheWriteTokens: 0, cacheReadTokens: 0 }) +
        creditsFor(summaryModel, SUMMARY_ALLOWANCE),
      );
      const genRef = proj.collection("generations").doc();
      await holdCredits(uid, genRef.id, held);
      // The prompt and chat messages are saved only after the model accepts the request,
      // so declined (off-topic or harmful) requests never enter history or later model context.
      await genRef.set({ status: "streaming", createdAt: FieldValue.serverTimestamp() });
      ctx = { uid, pid, prompt, proj, files, request, genRef, held };
    } catch (err) {
      sendError(res, err);
      return;
    }
    const { uid, pid, prompt, proj, files, request, genRef, held } = ctx;
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
    let streamedChars = 0;
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
        console.info("generate: request declined by model:", e.reason.slice(0, 200));
      } else ops.push({ type: "delete", path: e.path });
    });

    const stream = client.messages.stream({ ...request, max_tokens: MAX_OUTPUT_TOKENS });
    res.on("close", () => {
      if (!res.writableFinished) { clientGone = true; stream.abort(); }
    });
    stream.on("text", (t) => {
      streamedChars += t.length;
      parser.push(t);
    });

    let failure: { code: string; message: string } | null = null;
    let buildUsage: TokenUsage;
    let summaryUsage: TokenUsage | null = null;
    try {
      const final = await stream.finalMessage();
      buildUsage = toTokenUsage(final.usage);
      // Harmful requests can be refused by the API itself: empty content with this stop reason.
      if ((final.stop_reason as string) === "refusal") refused = true;
      if (final.stop_reason === "max_tokens") {
        failure = { code: "truncated", message: "The model hit its output limit; the last file was cut off." };
      }
    } catch (err) {
      failure = clientGone
        ? { code: "disconnected", message: "Connection to the client was lost." }
        : { code: "llm_error", message: err instanceof Error ? err.message : "The model request failed." };
      // A cut-off stream has no final usage: take what the stream reported and estimate output from the text received.
      buildUsage = toTokenUsage(stream.currentMessage?.usage);
      buildUsage.outputTokens = Math.max(buildUsage.outputTokens, Math.ceil(streamedChars / CHARS_PER_TOKEN));
    }

    /** Releases the hold, charges what this build used, and reports both to the client. */
    const settle = async (usage: TokenUsage) => {
      const exact = creditsFor(model, usage) + (summaryUsage ? creditsFor(summaryModel, summaryUsage) : 0);
      const charged = Math.min(held, chargeable(exact));
      const balance = await settleCredits(uid, generationId, held, charged, {
        model, usage, summaryModel, summaryUsage, projectId: pid,
      }).catch((err) => {
        console.error("generate: credit settlement failed", err);
        return null;
      });
      await genRef.update({ credits: charged, usage: { model, ...usage }, ...(summaryUsage ? { summaryUsage } : {}) }).catch(() => {});
      return { charged, balance };
    };
    console.info("generate: stream ended", { generationId, clientGone, failure: failure?.code ?? null });
    const unclosed = parser.end();
    const rejected: Rejection[] = [];
    if (unclosed) rejected.push({ path: unclosed, reason: "file was never closed (output incomplete)" });

    // ---- Declined: nothing is stored in history; the client shows a transient notice ----
    if (refused && !ops.length && !unclosed) {
      await genRef.update({ status: "declined" }).catch(() => {});
      const credits = await settle({ ...buildUsage, outputTokens: 0 }); // declined requests pay for input only
      send("error", { code: "declined", message: DECLINED_MESSAGE, partial: false, credits });
      clearInterval(heartbeat);
      if (!clientGone) res.end();
      return;
    }

    // ---- Persist whatever completed ----
    let status: Status = "error";
    let snapshotId: string | null = null;
    let applied: string[] = [];
    try {
      const existing = new Set(files.map((f) => f.path));
      const result = validateOps(ops, existing);
      rejected.push(...result.rejected);
      if (result.valid.length) {
        await applyOps(pid, result.valid);
        applied = result.valid.map((o) => o.path);
        const summarized = await summarizeChange(client, summaryModel, {
          prompt, plan: planParts.join("").trim(), files: applied,
        });
        if (summarized.usage) summaryUsage = toTokenUsage(summarized.usage);
        snapshotId = await createSnapshot(pid, generationId, "generation", summarized.summary);
      }

      if (!failure && rejected.length) {
        failure = {
          code: "invalid_output",
          message: `Some changes were rejected: ${rejected.map((r) => `${r.path} (${r.reason})`).join("; ")}`,
        };
      } else if (!failure && !applied.length && !planParts.join("").trim()) {
        failure = { code: "malformed_output", message: "The model returned no valid file changes." };
      }
      status = !failure ? "done" : applied.length ? "partial" : "error";

      await proj.collection("messages").add({
        role: "user", content: prompt, generationId, createdAt: FieldValue.serverTimestamp(),
      });
      const plan = planParts.join("").trim();
      const summary = applied.length ? `${plan}\n\nFiles: ${applied.join(", ")}` : plan || failure?.message || "";
      await proj.collection("messages").add({
        role: "assistant", content: summary, generationId, createdAt: FieldValue.serverTimestamp(),
      });
      await genRef.update({
        prompt,
        status,
        snapshotId,
        ...(failure ? { error: failure.message } : {}),
      });
      if (applied.length) await proj.update({ updatedAt: FieldValue.serverTimestamp() });
    } catch (err) {
      console.error("generate: persistence failed", err);
      failure = { code: "persist_failed", message: "Could not save the generated files." };
      await genRef.update({ status: "error", error: failure.message }).catch(() => {});
    }

    const credits = await settle(buildUsage);
    console.info("generate: persisted", { generationId, status, applied: applied.length, credits: credits.charged });
    if (failure) send("error", { ...failure, partial: applied.length > 0, credits });
    else send("done", { generationId, snapshotId, files: applied, credits });
    clearInterval(heartbeat);
    if (!clientGone) res.end();
  },
);
