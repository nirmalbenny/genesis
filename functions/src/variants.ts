import Anthropic from "@anthropic-ai/sdk";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "./admin";
import {
  ANTHROPIC_API_KEY, ANTHROPIC_MODEL, CONTEXT_TOOLS, GRADER_MODEL, LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY,
  SECURITY_MODEL, TRACING, VARIANT_BUILDS, VARIANTS,
} from "./config";
import {
  addUsage, chargeable, creditsFor, holdCredits, releaseBuildSlot, reserveBuildSlot, settleCredits, toTokenUsage,
  worstCaseCredits, type TokenUsage,
} from "./credits";
import { fileStore, projectRef, SEED_FILES, writeOps } from "./files";
import { DECLINED_MESSAGE, MAX_READ_CALLS, MAX_TURNS } from "./generate";
import { httpError } from "./http";
import type { ToolCall } from "./llm/assemble";
import { describeContext, type BuildContext } from "./llm/buildContext";
import { renderContext, selectContext } from "./llm/context";
import { countInput } from "./llm/count";
import { parseQuality, parseSecurity, qualityRequest, securityRequest } from "./llm/grade";
import { selectGuides } from "./llm/guides";
import { fill, parsePlan, planRequest, textOf, versionRequest, type VersionPrompt } from "./llm/plan";
import { systemBlocks, uiOf } from "./llm/prompt";
import { buildTools, runBuildTool, runReadFiles } from "./llm/tools";
import { runTurns, type StreamFn } from "./llm/turns";
import type { FileOp } from "./llm/validate";
import {
  assignBuilds, configKey, isEligible, keepTwo, levelsOf, parseBuildConfigs, securityRemoves, total, VARIANT_COUNT,
  type BuildStatus, type Candidate,
} from "./llm/variants";
import { createWorkspace } from "./llm/workspace";
import { recordBuild, updateBuild } from "./buildHistory";
import { notify } from "./notifications";
import { ensureLangfuse } from "./observability/langfuse";
import { sendScores } from "./observability/scores";
import { sendVariantTrace, variantScores, type VariantTraceInput, type VersionTrace } from "./observability/variantTrace";
import { DRAFT_DAYS, getUserHl } from "./projects";

/**
 * Variant builds (docs/plans/build-variants.md). The customer pays only for the version they keep: the job holds and
 * charges one build (the applied version; adjusted at save if they keep the other), and Genesis absorbs the planner,
 * the grader and the other builds (recorded as `absorbed` on the charge). `POST /variants` creates a hidden draft app and a job; the
 * `buildVariants` trigger runs it in the background, so it finishes whether or not the customer keeps the page open:
 * planner → 4 builds in parallel → automated findings and the grader → the 2 best become snapshots of the draft
 * (the best is applied). The customer previews them and saves one (`POST /projects/:id/save`). Nothing about the
 * scoring reaches the browser: scores live in variantScores/{gid}, which no client can read.
 */

const MAX_PROMPT_CHARS = 4000;
// A version prompt's longest form (plan.ts clips at 3,000 characters), held as part of each build's input.
const VERSION_ALLOWANCE = "x".repeat(3000);
// Builds 2-4 start when build 1's first stream event arrives (its cached prefix is then readable), or after this.
const STAGGER_CAP_MS = 20_000;
// Output cap per version, across its turns. Higher than a single build's (16,000): thinking counts as output, and Opus
// at high effort thinks more. The customer's hold is one build at this cap, so a kept version is never under-held.
export const VARIANT_MAX_OUTPUT_TOKENS = 30_000;

type Job = { uid: string; projectId: string; prompt: string };
/** `credits`: what keeping this version costs (its build's usage, at most the hold); `style`: the look the planner gave it. */
export type Finalist = { snapshotId: string; title: string; summary: string; style: string; plan: string; files: string[]; credits: number };

const jobs = db.collection("variantJobs");
const scoresDoc = (gid: string) => db.doc(`variantScores/${gid}`);

// ---- API: start ----

/** Validates the request, takes every build slot, and creates the draft app and the job (the trigger runs it). */
export async function startVariants(uid: string, body: Record<string, unknown> | undefined): Promise<{ projectId: string; generationId: string }> {
  if (VARIANTS.value() !== "on") throw httpError(404, "variants_off", "Building several versions isn't available.");
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) throw httpError(400, "invalid_prompt", `Prompt must be 1-${MAX_PROMPT_CHARS} characters`);
  const hl = await getUserHl(uid);
  if (!hl) throw httpError(409, "hl_not_connected", "HighLevel is not connected. Connect it before building.");

  const ref = db.collection("projects").doc();
  const genRef = ref.collection("generations").doc();
  await reserveBuildSlot(uid, ref.id, genRef.id, { exclusive: true, starts: VARIANT_COUNT });
  try {
    await ref.set({
      ownerId: uid,
      name: prompt.split(/[.\n]/)[0]!.slice(0, 60).trim() || "New app",
      description: prompt.slice(0, 500),
      category: "other",
      icon: null,
      locationId: hl.locationId,
      kind: "user",
      draft: { generationId: genRef.id, expiresAt: Timestamp.fromMillis(Date.now() + DRAFT_DAYS * 86_400_000) },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deletedAt: null,
    });
    await fileStore().apply(ref.id, writeOps(SEED_FILES));
    await genRef.set({ mode: "variants", status: "queued", createdAt: FieldValue.serverTimestamp() });
    await jobs.doc(genRef.id).set({ uid, projectId: ref.id, prompt, createdAt: FieldValue.serverTimestamp() } satisfies Job & { createdAt: unknown });
  } catch (err) {
    await releaseBuildSlot(uid, genRef.id).catch(() => {});
    throw err;
  }
  return { projectId: ref.id, generationId: genRef.id };
}

// ---- One version's build (the build loop of generate, without streaming to a browser) ----

type VersionResult = {
  status: BuildStatus;
  ops: FileOp[];
  plan: string;
  usage: TokenUsage;
  /** The whole app after this build: path → content. */
  files: Record<string, string>;
  problems: string[];
};

async function buildVersion(o: {
  client: Anthropic;
  request: Omit<Anthropic.MessageCreateParamsStreaming, "max_tokens" | "stream">;
  manifest: Awaited<ReturnType<ReturnType<typeof fileStore>["manifest"]>>;
  context: { path: string; content: string }[];
  readFile: (paths: string[]) => Promise<{ path: string; content: string }[]>;
  contextTools: boolean;
  signal: AbortSignal;
  stopped: () => boolean;
  beforeTurn: (turn: number, params: Anthropic.MessageCreateParamsStreaming) => Promise<void>;
  onFirstEvent?: () => void;
}): Promise<VersionResult> {
  const workspace = createWorkspace(o.manifest);
  for (const f of o.context) workspace.show(f.path, f.content);
  const unresolved = new Set<string>();
  const planParts: string[] = [];
  let readCalls = 0;
  const readFiles = (input: unknown) => runReadFiles(input, o.manifest, o.readFile, (p) => workspace.shown(p), (f) => workspace.show(f.path, f.content));
  const runTool = async (call: ToolCall) => {
    if (call.name === "read_files") {
      const allowed = o.contextTools && readCalls < MAX_READ_CALLS;
      if (allowed) readCalls++;
      return runBuildTool(call, { workspace, readFiles: allowed ? readFiles : null });
    }
    const r = await runBuildTool(call, { workspace, readFiles: null });
    const key = typeof call.input.path === "string" ? call.input.path : `(${call.name})`;
    if (r.isError) unresolved.add(key);
    else unresolved.delete(key);
    return r;
  };
  let first = o.onFirstEvent;
  const stream: StreamFn = async (params, signal) => {
    const s = await o.client.messages.create(params, { signal });
    if (!first) return s;
    return (async function* () {
      for await (const ev of s) {
        first?.();
        first = undefined;
        yield ev;
      }
    })();
  };
  const turns = await runTurns({
    stream,
    request: o.request,
    maxOutputTokens: VARIANT_MAX_OUTPUT_TOKENS,
    maxTurns: MAX_TURNS,
    signal: o.signal,
    handlers: { onText: (t) => planParts.push(t) },
    runTool,
    review: () => {
      const problems = workspace.problems();
      return problems.length ? `These changes leave problems in the app:\n${problems.map((p) => `- ${p}`).join("\n")}\nFix them with further calls.` : null;
    },
    beforeTurn: o.beforeTurn,
    stopped: o.stopped,
  });
  const ops = workspace.ops();
  const problems = workspace.problems();
  const status: BuildStatus = turns.declined !== null ? "declined"
    : o.stopped() ? "cancelled"
    : turns.error || turns.stoppedBetweenTurns ? "error"
    : turns.truncated ? "truncated"
    : problems.length || unresolved.size || !ops.length ? "problems"
    : "done";
  const files = Object.fromEntries(o.context.map((f) => [f.path, f.content]));
  for (const op of ops) {
    if (op.type === "write") files[op.path] = op.content;
    else delete files[op.path];
  }
  return { status, ops, plan: planParts.join("").trim(), usage: turns.usage, files, problems };
}

// ---- The job ----

const describeOps = (ops: FileOp[]) => ops.filter((o) => o.type === "write").map((o) => o.path);

async function runJob(gid: string, job: Job): Promise<void> {
  const { uid, projectId: pid, prompt } = job;
  const startedAt = Date.now();
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), openTelemetry: false });
  const model = ANTHROPIC_MODEL.value();
  const graderModel = GRADER_MODEL.value();
  const proj = projectRef(pid);
  const genRef = proj.collection("generations").doc(gid);
  // What the job's Langfuse trace shows (observability/variantTrace.ts), filled in as it runs.
  let finalStatus = "queued";
  let finalError: string | null = null;
  const traced: Pick<VariantTraceInput, "planner" | "versions" | "finalists"> = { planner: null, versions: [], finalists: [] };
  let buildContext: BuildContext | null = null;
  const setStatus = (status: string, extra: Record<string, unknown> = {}) => {
    finalStatus = status;
    if (typeof extra.error === "string") finalError = extra.error;
    return genRef.update({ status, ...extra });
  };
  const discardDraft = () => proj.update({ deletedAt: FieldValue.serverTimestamp() });
  let appName = String((await proj.get()).get("name") ?? "New app");
  /** The build history's record of this job (users/{uid}/builds/{gid}). */
  const record = (outcome: "ready" | "partial" | "failed" | "stopped", href: string, versions?: string[]) =>
    recordBuild(uid, gid, { projectId: pid, mode: "variants", appName, request: prompt, outcome, href, ...(versions ? { versions } : {}) });

  let held = 0;
  const calls: { model: string; usage: TokenUsage }[] = [];
  /** The usage the customer pays for: the build they get (or, when stopped, the first build so far). */
  let kept: TokenUsage | null = null;
  const costOf = (usage: TokenUsage) => Math.min(held, chargeable(creditsFor(model, usage)));
  const abort = new AbortController();
  let cancelled = false;
  const stopWatching = genRef.onSnapshot((s) => {
    if (s.get("cancelRequested") && !cancelled) { cancelled = true; abort.abort(); }
  }, () => {});
  /** Ends a stopped job: nothing offered, the draft goes; like a stopped build, what one build used so far is paid. */
  const stopped = async (usage?: TokenUsage) => {
    kept = usage ?? null;
    await setStatus("cancelled"); await discardDraft(); await record("stopped", "/");
  };

  try {
    // ---- Context, shared by every build: the starter files, guides and system blocks (unchanged) ----
    const store = fileStore();
    const manifest = await store.manifest(pid);
    const selection = selectContext(manifest, { prompt });
    const context = await store.read(pid, selection.full);
    const contextTools = CONTEXT_TOOLS.value() === "on";
    const filesText = renderContext(context, manifest, selection.index, contextTools);
    const guides = selectGuides({ prompt, helpers: [], sources: context.map((f) => f.content) });
    const ui = uiOf(context.map((f) => f.content));
    const base = { model, system: systemBlocks(guides, ui), tools: buildTools(contextTools) };
    // What every build and review was given, by content hash, so each score can be tied to the exact texts.
    buildContext = describeContext({ guides, ui, contextTools });
    const userTurn = (text: string): Anthropic.MessageParam => ({ role: "user", content: `Current project files:\n${filesText}\n\n${text}` });

    // ---- The customer pays for one build (the version they keep): hold one build's worst case ----
    const planReq = planRequest(model, prompt);
    const buildIn = await countInput(client, { ...base, messages: [userTurn(versionRequest(prompt, { title: "", summary: "", style: "", prompt: VERSION_ALLOWANCE }))] });
    const hold = chargeable(worstCaseCredits(model, buildIn, VARIANT_MAX_OUTPUT_TOKENS));
    try {
      await holdCredits(uid, gid, hold);
    } catch (err) {
      const message = (err as Error).message.replace("This build", "Building several versions");
      await setStatus("error", { error: message, code: "insufficient_credits" });
      await discardDraft();
      return;
    }
    held = hold;
    if (cancelled) return stopped();

    // ---- Planner: 4 prompts, or a decline ----
    await setStatus("planning");
    const plannerStarted = Date.now();
    let plannerUsage = toTokenUsage(null);
    const runPlanner = async () => {
      const m = await client.messages.stream(planReq, { signal: abort.signal }).finalMessage();
      calls.push({ model, usage: toTokenUsage(m.usage) });
      plannerUsage = addUsage(plannerUsage, toTokenUsage(m.usage));
      return { refused: m.stop_reason === "refusal", plan: parsePlan(textOf(m)) };
    };
    let planned = await runPlanner().catch(() => null);
    const tracePlanner = () => {
      traced.planner = {
        startedAt: plannerStarted, endedAt: Date.now(), usage: plannerUsage, name: planned?.plan?.name ?? appName,
        declined: planned?.refused ? "refused by the API" : planned?.plan?.declined ?? null,
      };
    };
    if (cancelled) return stopped();
    if (planned?.refused || planned?.plan?.declined) {
      tracePlanner();
      console.info("variants: request declined by the planner:", (planned.plan?.declined ?? "API refusal").slice(0, 200)); // never the prompt
      await setStatus("declined", { error: DECLINED_MESSAGE });
      await discardDraft();
      return;
    }
    // Too few usable prompts (unparseable, or dropped for mentioning evaluation): one more try.
    if (!planned?.plan || planned.plan.prompts.length < VARIANT_COUNT) planned = (await runPlanner().catch(() => null)) ?? planned;
    if (cancelled) return stopped();
    tracePlanner();
    const versions: VersionPrompt[] = fill(planned?.plan?.declined ? [] : planned?.plan?.prompts ?? [], prompt);
    // A short name from the planner replaces the clipped request until the customer names the app.
    if (planned?.plan?.name) {
      appName = planned.plan.name;
      await proj.update({ name: appName });
    }

    // ---- 4 builds in parallel, each with its own model and effort (VARIANT_BUILDS, rotated per build) ----
    await setStatus("building");
    const builds = assignBuilds(parseBuildConfigs(VARIANT_BUILDS.value(), model), gid);
    const buildTimes: { startedAt: number; endedAt: number }[] = [];
    const runBuild = (v: VersionPrompt, i: number, onFirstEvent?: () => void) => buildVersion({
      client,
      request: { ...base, model: builds[i]!.model, output_config: { effort: builds[i]!.effort }, messages: [userTurn(versionRequest(prompt, v))] },
      manifest,
      context,
      readFile: (paths) => store.read(pid, paths),
      contextTools,
      signal: abort.signal,
      stopped: () => cancelled,
      // Extra turns aren't held: the customer pays at most the one-build hold, and Genesis absorbs the rest.
      beforeTurn: async () => {},
      onFirstEvent,
    });
    // The cache is per model and effort: a version sharing an earlier version's setting waits for that build's first
    // stream event (its cached prefix is then readable), at most STAGGER_CAP_MS; a new setting starts at once.
    const firstEvents = new Map<string, Promise<void>>();
    const results = await Promise.all(versions.map(async (v, i) => {
      const key = configKey(builds[i]!);
      const earlier = firstEvents.get(key);
      let release!: () => void;
      if (!earlier) firstEvents.set(key, new Promise<void>((r) => { release = r; }));
      if (earlier) await Promise.race([earlier, new Promise((r) => setTimeout(r, STAGGER_CAP_MS))]);
      const startedAt = Date.now();
      try {
        return await runBuild(v, i, earlier ? undefined : release);
      } finally {
        release?.();
        buildTimes[i] = { startedAt, endedAt: Date.now() };
      }
    }));
    results.forEach((r, i) => calls.push({ model: builds[i]!.model, usage: r.usage }));
    if (cancelled) return stopped(results[0]?.usage);

    // ---- Checking (docs/plans/build-variants-evaluation.md): every build past Gate 1 gets two AI reviews, in parallel:
    // Gate 2, the security reviewer (a critical or high finding removes the version), and the quality judge ----
    await setStatus("checking");
    const securityModel = SECURITY_MODEL.value();
    type Run<T> = { value: T | null; usage: TokenUsage; startedAt: number; endedAt: number };
    /** One structured review, retried once; `value` is null when it couldn't be completed. */
    const review = async <T>(req: Anthropic.MessageCreateParamsNonStreaming, reviewModel: string, read: (text: string) => T | null): Promise<Run<T>> => {
      const startedAt = Date.now();
      let usage = toTokenUsage(null);
      for (let attempt = 0; attempt < 2 && !cancelled; attempt++) {
        try {
          const m = await client.messages.stream(req, { signal: abort.signal }).finalMessage();
          calls.push({ model: reviewModel, usage: toTokenUsage(m.usage) });
          usage = addUsage(usage, toTokenUsage(m.usage));
          const parsed = read(textOf(m));
          if (parsed) return { value: parsed, usage, startedAt, endedAt: Date.now() };
        } catch (err) {
          console.warn("variants: review failed", (err as Error).message);
        }
      }
      return { value: null, usage, startedAt, endedAt: Date.now() };
    };
    const reviewed = await Promise.all(results.map(async (r, i) => {
      if (!isEligible(r.status)) return null; // Gate 1
      const input = { request: prompt, version: versions[i]!.prompt, files: r.files };
      const [securityRun, qualityRun] = await Promise.all([
        review(securityRequest(securityModel, input), securityModel, parseSecurity),
        review(qualityRequest(graderModel, input), graderModel, (text) => {
          const q = parseQuality(text);
          return Object.keys(q).length ? q : null;
        }),
      ]);
      const security = securityRun.value;
      // A version that couldn't be reviewed for security counts as not passing: nothing is offered unreviewed.
      return {
        index: i, security, securityRun, qualityRun,
        levels: security ? levelsOf(qualityRun.value ?? {}, security) : null, removed: securityRemoves(security),
      };
    }));
    if (cancelled) return stopped(results[0]?.usage);
    const candidates: Candidate[] = reviewed.flatMap((r) => (r && !r.removed && r.levels ? [{ index: r.index, levels: r.levels }] : []));
    const keep = keepTwo(candidates);
    const removedForSecurity = new Set(reviewed.flatMap((r) => (r?.removed ? [r.index] : [])));
    const gateOf = (i: number) => (!isEligible(results[i]!.status) ? "builds" : removedForSecurity.has(i) ? "secure" : "passed");
    traced.finalists = keep;
    traced.versions = versions.map((v, i): VersionTrace => {
      const r = reviewed[i];
      const { securityRun, qualityRun } = r ?? {};
      return {
        title: v.title, summary: v.summary, prompt: v.prompt, style: v.style, model: builds[i]!.model, effort: builds[i]!.effort,
        status: results[i]!.status, gate: gateOf(i),
        files: describeOps(results[i]!.ops), problems: results[i]!.problems.slice(0, 20),
        build: { ...buildTimes[i]!, usage: results[i]!.usage },
        security: securityRun ? { startedAt: securityRun.startedAt, endedAt: securityRun.endedAt, usage: securityRun.usage, review: securityRun.value } : null,
        quality: qualityRun ? { startedAt: qualityRun.startedAt, endedAt: qualityRun.endedAt, usage: qualityRun.usage, levels: r?.levels ?? null } : null,
        total: r?.levels && !r.removed ? total(r.levels) : null,
      };
    });

    // For us only: what each build did, how it was reviewed and scored (never readable by the client).
    await scoresDoc(gid).set({
      uid, projectId: pid, createdAt: FieldValue.serverTimestamp(), graderModel, securityModel, context: buildContext,
      versions: versions.map((v, i) => {
        const r = reviewed[i];
        return {
          ...v, model: builds[i]!.model, effort: builds[i]!.effort, status: results[i]!.status, gate: gateOf(i), problems: results[i]!.problems.slice(0, 20), files: describeOps(results[i]!.ops),
          usage: results[i]!.usage, security: r?.security ?? null, levels: r?.levels ?? null, total: r?.levels && !r.removed ? total(r.levels) : null,
        };
      }),
      finalists: keep,
    });
    console.info(JSON.stringify({
      event: "build.variants", generationId: gid, projectId: pid, uid, ms: Date.now() - startedAt,
      gates: versions.map((_, i) => gateOf(i)),
      totals: reviewed.map((r) => (r?.levels && !r.removed ? total(r.levels) : null)),
      finalists: keep,
    }));

    // ---- None passed: the most complete build that didn't fail security becomes the app, opened with its problems (Fix with AI) ----
    if (!keep.length) {
      // Never a version the security review removed: only builds that failed Gate 1 can be opened to fix.
      const best = results.map((r, i) => ({ r, i })).filter((x) => x.r.ops.length && !removedForSecurity.has(x.i)).sort((a, b) => b.r.ops.length - a.r.ops.length)[0];
      if (!best) {
        await setStatus("error", { error: "None of the versions could be built. Try again, or describe the app differently." });
        await notify(uid, { kind: "build_failed", title: "Your new app couldn't be built", body: "None of the versions could be built. Try again, or describe the app differently.", href: "/", projectId: pid, generationId: gid });
        await record("failed", "/");
        await discardDraft();
        return;
      }
      kept = best.r.usage;
      await store.apply(pid, best.r.ops);
      const snapshotId = await store.snapshot(pid, gid, "generation", versions[best.i]!.title);
      await proj.collection("messages").add({ role: "user", content: prompt, generationId: gid, createdAt: FieldValue.serverTimestamp() });
      await proj.collection("messages").add({ role: "assistant", content: `${best.r.plan}\n\nFiles: ${describeOps(best.r.ops).join(", ")}`, generationId: gid, createdAt: FieldValue.serverTimestamp() });
      await proj.update({ draft: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      await record("partial", `/p/${pid}`);
      await notify(uid, {
        kind: "build_partial", title: "Your new app needs a fix", body: "It was built with problems. Open it to fix them with AI.",
        href: `/p/${pid}`, projectId: pid, generationId: gid,
      });
      await setStatus("partial", {
        prompt, snapshotId, files: describeOps(best.r.ops),
        error: `The app was built with problems: ${best.r.problems.slice(0, 3).join("; ") || "some changes were not finished"}. Open it to fix them.`,
      });
      return;
    }

    // ---- The finalists: a snapshot each; the best is applied, so the draft runs it ----
    const finalists: Finalist[] = [];
    for (const i of keep) {
      const r = results[i]!;
      const snapshotId = await store.stageSnapshot(pid, r.ops, gid, versions[i]!.title);
      finalists.push({ snapshotId, title: versions[i]!.title, summary: versions[i]!.summary, style: versions[i]!.style, plan: r.plan, files: describeOps(r.ops), credits: costOf(r.usage) });
    }
    kept = results[keep[0]!]!.usage; // the applied version; saving the other one adjusts the charge (api.ts)
    await store.apply(pid, results[keep[0]!]!.ops);
    await proj.update({ updatedAt: FieldValue.serverTimestamp() });
    await setStatus("ready", { prompt, finalists, snapshotId: finalists[0]!.snapshotId, files: finalists[0]!.files });
    await record("ready", `/choose/${pid}`, finalists.map((f) => f.title));
    await notify(uid, {
      kind: "versions_ready",
      title: finalists.length > 1 ? "Your app versions are ready" : "Your app is ready",
      body: finalists.length > 1 ? `Choose between ${finalists.map((f) => f.title).join(" and ")}.` : `Preview ${finalists[0]!.title} and save it.`,
      href: `/choose/${pid}`, projectId: pid, generationId: gid,
    });
  } catch (err) {
    console.error("variants: job failed", err);
    await setStatus("error", { error: "Something went wrong while building. Try again." }).catch(() => {});
    await notify(uid, { kind: "build_failed", title: "Your new app couldn't be built", body: "Something went wrong while building. Try again.", href: "/", projectId: pid, generationId: gid });
    await record("failed", "/");
    await discardDraft().catch(() => {});
  } finally {
    stopWatching();
    // Settle once, whatever happened: the customer pays the kept build's usage (never more than held), Genesis the
    // rest (`absorbed`); the slot is freed.
    const exact = chargeable(calls.reduce((sum, c) => sum + creditsFor(c.model, c.usage), 0));
    const charged = kept ? costOf(kept) : 0;
    if (held) {
      await settleCredits(uid, gid, held, charged, { kind: "variants", model, graderModel, calls: calls.length, projectId: pid, absorbed: Math.max(0, exact - charged) })
        .catch((e) => console.error("variants: credit settlement failed", e));
      await genRef.update({ credits: charged }).catch(() => {});
      await updateBuild(uid, gid, { credits: charged });
    } else {
      await releaseBuildSlot(uid, gid).catch(() => {});
    }
    // The job in Langfuse: one trace with the planner, each version's build and reviews, and the evaluation as
    // scores; its ids are kept so saving a version can score which one the customer kept (api.ts).
    const traceInput: VariantTraceInput = {
      generationId: gid, uid, projectId: pid, appName,
      // A declined request is never kept anywhere, traces included.
      request: finalStatus === "declined" ? "(declined: the request is not kept)" : prompt,
      status: finalStatus, error: finalError, startedAt, endedAt: Date.now(),
      models: { build: model, security: SECURITY_MODEL.value(), quality: graderModel },
      ...traced,
      context: buildContext,
      credits: { held, charged, absorbed: Math.max(0, exact - charged) },
    };
    const sent = await sendVariantTrace(traceInput);
    if (sent) {
      await sendScores({ publicKey: LANGFUSE_PUBLIC_KEY.value(), secretKey: LANGFUSE_SECRET_KEY.value(), baseUrl: LANGFUSE_BASE_URL.value() }, variantScores(traceInput, sent));
      if (traced.versions.length) await scoresDoc(gid).update({ trace: sent }).catch(() => {});
    }
    await jobs.doc(gid).delete().catch(() => {});
  }
}

/** Runs a variant job in the background (created by startVariants). Not retried: a failed job is settled and reported. */
export const buildVariants = onDocumentCreated(
  { document: "variantJobs/{gid}", secrets: [ANTHROPIC_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY], timeoutSeconds: 540, memory: "1GiB" },
  async (event) => {
    if (TRACING.value() === "langfuse") {
      ensureLangfuse({ publicKey: LANGFUSE_PUBLIC_KEY.value(), secretKey: LANGFUSE_SECRET_KEY.value(), baseUrl: LANGFUSE_BASE_URL.value() });
    }
    const job = event.data?.data() as Job | undefined;
    if (job) await runJob(event.params.gid, job);
  },
);
