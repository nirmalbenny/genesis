import Anthropic from "@anthropic-ai/sdk";
import { FieldValue } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_SUMMARY_MODEL } from "./config";
import { applyOps, createSnapshot, projectRef, readFiles } from "./files";
import { httpError, requireUser, sendError } from "./http";
import { createParser } from "./llm/parser";
import { summarizeChange } from "./llm/summary";
import { buildSystemPrompt, RECENT_MESSAGES, renderFiles } from "./llm/prompt";
import { validateOps, type FileOp, type Rejection } from "./llm/validate";
import { assertEditable, getOwnedProject, getUserHl, useConnectedLocation } from "./projects";

const MAX_PROMPT_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 16000;
const HEARTBEAT_MS = 15_000;

type Status = "done" | "partial" | "error";

const DECLINED_MESSAGE =
  "I can't fulfill this request. Genesis only builds and edits apps that show your HighLevel data, and it can't help with harmful or unrelated requests. Describe a change to your app and I'll take it from there.";

async function precheck(req: Request) {
  if (req.method !== "POST") throw httpError(405, "method_not_allowed", "POST only");
  const uid = await requireUser(req);
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
  return { pid, prompt, hl };
}

export const generate = onRequest(
  { cors: true, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    // ---- Pre-stream checks: plain JSON errors, no SSE yet ----
    let checked;
    try {
      checked = await precheck(req);
    } catch (err) {
      sendError(res, err);
      return;
    }
    const { pid, prompt, hl } = checked;

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

    // ---- Context + generation record ----
    const proj = projectRef(pid);
    const genRef = proj.collection("generations").doc();
    const generationId = genRef.id;
    const [files, recent] = await Promise.all([
      readFiles(pid),
      proj.collection("messages").orderBy("createdAt", "desc").limit(RECENT_MESSAGES).get(),
    ]);
    const history = recent.docs
      .reverse()
      .map((d) => ({ role: d.get("role") as "user" | "assistant", content: d.get("content") as string }));

    // The prompt and chat messages are saved only after the model accepts the request,
    // so declined (off-topic or harmful) requests never enter history or later model context.
    await genRef.set({ status: "streaming", createdAt: FieldValue.serverTimestamp() });
    send("start", { generationId });

    // ---- Stream ----
    const ops: FileOp[] = [];
    const planParts: string[] = [];
    let refused = false;
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

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const stream = client.messages.stream({
      model: ANTHROPIC_MODEL.value(),
      max_tokens: MAX_OUTPUT_TOKENS,
      system: buildSystemPrompt({ id: hl.locationId, name: hl.locationName }),
      messages: [
        ...history,
        { role: "user", content: `Current project files:\n${renderFiles(files)}\n\nRequest: ${prompt}` },
      ],
    });
    res.on("close", () => {
      if (!res.writableFinished) { clientGone = true; stream.abort(); }
    });
    stream.on("text", (t) => parser.push(t));

    let failure: { code: string; message: string } | null = null;
    try {
      const final = await stream.finalMessage();
      // Harmful requests can be refused by the API itself: empty content with this stop reason.
      if ((final.stop_reason as string) === "refusal") refused = true;
      if (final.stop_reason === "max_tokens") {
        failure = { code: "truncated", message: "The model hit its output limit; the last file was cut off." };
      }
    } catch (err) {
      failure = clientGone
        ? { code: "disconnected", message: "Connection to the client was lost." }
        : { code: "llm_error", message: err instanceof Error ? err.message : "The model request failed." };
    }
    console.info("generate: stream ended", { generationId, clientGone, failure: failure?.code ?? null });
    const unclosed = parser.end();
    const rejected: Rejection[] = [];
    if (unclosed) rejected.push({ path: unclosed, reason: "file was never closed (output incomplete)" });

    // ---- Declined: nothing is stored in history; the client shows a transient notice ----
    if (refused && !ops.length && !unclosed) {
      await genRef.update({ status: "declined" }).catch(() => {});
      send("error", { code: "declined", message: DECLINED_MESSAGE, partial: false });
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
        const summary = await summarizeChange(client, ANTHROPIC_SUMMARY_MODEL.value(), {
          prompt, plan: planParts.join("").trim(), files: applied,
        });
        snapshotId = await createSnapshot(pid, generationId, "generation", summary);
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

    console.info("generate: persisted", { generationId, status, applied: applied.length });
    if (failure) send("error", { ...failure, partial: applied.length > 0 });
    else send("done", { generationId, snapshotId, files: applied });
    clearInterval(heartbeat);
    if (!clientGone) res.end();
  },
);
