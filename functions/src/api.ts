import { FieldValue } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { db } from "./admin";
import { APP_ORIGINS, LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, PREVIEW_TOKEN_SECRET, TRACING } from "./config";
import { fileStore, projectRef, SEED_FILES, writeOps } from "./files";
import { adjustCharge, grantSignupCredits } from "./credits";
import { httpError, rateLimited, requireVerifiedUser, sendError } from "./http";
import { createLimiter, LIMITS } from "./rateLimits";
import { checkPath, MAX_FILE_BYTES } from "./llm/validate";
import { signPreviewToken } from "./previewToken";
import { assertEditable, getOwnedProject, getUserHl, toCategory, useConnectedLocation } from "./projects";
import { seedTemplates } from "./templates";
import { syncGrantedScopes } from "./hl/scopes";
import { startVariants, type Finalist } from "./variants";
import { markRead } from "./notifications";
import { updateBuild } from "./buildHistory";
import { sendScores } from "./observability/scores";
import { keptScores, type SentTrace } from "./observability/variantTrace";

type Handler = (uid: string, req: Request, m: string[]) => Promise<unknown>;

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Every app is created with a name and a description the user provides. */
function requireDetails(body: Record<string, unknown> | undefined) {
  const name = text(body?.name, 100);
  const description = text(body?.description, 500);
  if (!name) throw httpError(400, "invalid_name", "App name is required");
  if (!description) throw httpError(400, "invalid_description", "App description is required");
  return { name, description };
}

const createProject: Handler = async (uid, req) => {
  const { name, description } = requireDetails(req.body);
  const hl = await getUserHl(uid);
  if (!hl) throw httpError(409, "hl_not_connected", "Connect HighLevel before creating a project");

  const ref = db.collection("projects").doc();
  await ref.set({
    ownerId: uid,
    name,
    description,
    category: toCategory(req.body?.category),
    icon: null,
    locationId: hl.locationId,
    kind: "user",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deletedAt: null,
  });
  await fileStore().apply(ref.id, writeOps(SEED_FILES));
  return { id: ref.id };
};

/** Copies an app (including a locked prebuilt one) into a new, editable user app. */
const duplicateProject: Handler = async (uid, req, [pid]) => {
  const source = await getOwnedProject(uid, pid);
  const { name, description } = requireDetails(req.body);
  const hl = await getUserHl(uid);

  const ref = db.collection("projects").doc();
  await ref.set({
    ownerId: uid,
    name,
    description,
    category: req.body?.category !== undefined ? toCategory(req.body.category) : toCategory(source.category),
    icon: source.icon ?? null,
    locationId: hl?.locationId ?? null,
    kind: "user",
    forkedFrom: { projectId: pid, name: source.name },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deletedAt: null,
  });
  const store = fileStore();
  await store.copy(pid, ref.id);
  await store.snapshot(ref.id, null, "copy", `Created from ${source.name}`);
  return { id: ref.id };
};

const getProject: Handler = async (uid, _req, [pid]) => ({ id: pid, ...(await getOwnedProject(uid, pid)) });

const updateProject: Handler = async (uid, req, [pid]) => {
  assertEditable(await getOwnedProject(uid, pid));
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (req.body?.name !== undefined) {
    const name = text(req.body.name, 100);
    if (!name) throw httpError(400, "invalid_name", "Project name is required");
    patch.name = name;
  }
  if (req.body?.description !== undefined) {
    const description = text(req.body.description, 500);
    if (!description) throw httpError(400, "invalid_description", "App description is required");
    patch.description = description;
  }
  if (req.body?.category !== undefined) patch.category = toCategory(req.body.category);
  await projectRef(pid).update(patch);
  return { ok: true };
};

/** Pins an app to the user's sidebar, or unpins it. A display preference, so it is allowed on locked apps too. */
const pinProject: Handler = async (uid, req, [pid]) => {
  await getOwnedProject(uid, pid);
  const pinned = req.body?.pinned === true;
  await projectRef(pid).update({ pinnedAt: pinned ? FieldValue.serverTimestamp() : null });
  return { pinned };
};

const deleteProject: Handler = async (uid, _req, [pid]) => {
  await getOwnedProject(uid, pid);
  await projectRef(pid).update({ deletedAt: FieldValue.serverTimestamp() });
  return { ok: true };
};

// A single build streams; a variant build (variants.ts) goes through these steps in the background.
const RUNNING = new Set(["streaming", "queued", "planning", "building", "checking"]);

/** Asks a running build to stop. The generate function watches the generation doc and stops the model. */
const cancelGeneration: Handler = async (uid, _req, [pid, gid]) => {
  await getOwnedProject(uid, pid);
  const ref = projectRef(pid).collection("generations").doc(gid);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, "not_found", "Generation not found");
  if (!RUNNING.has(snap.get("status"))) return { requested: false }; // already finished
  await ref.update({ cancelRequested: true });
  return { requested: true };
};

const listFiles: Handler = async (uid, req, [pid]) => {
  await getOwnedProject(uid, pid);
  const files = await fileStore().readAll(pid);
  const withContent = req.query.content === "true";
  return {
    files: files.map((f) =>
      withContent ? f : { path: f.path, bytes: Buffer.byteLength(f.content) },
    ),
  };
};

const readFile: Handler = async (uid, req, [pid]) => {
  await getOwnedProject(uid, pid);
  const path = String(req.query.path ?? "");
  const [file] = await fileStore().read(pid, [path]);
  if (!file) throw httpError(404, "not_found", "File not found");
  return { path, content: file.content };
};

const saveFile: Handler = async (uid, req, [pid]) => {
  assertEditable(await getOwnedProject(uid, pid));
  const path = text(req.body?.path, 300);
  const content = req.body?.content;
  const pathError = checkPath(path);
  if (pathError) throw httpError(400, "invalid_path", pathError);
  if (typeof content !== "string") throw httpError(400, "invalid_content", "content must be a string");
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw httpError(413, "too_large", "File is too large");
  await fileStore().apply(pid, [{ type: "write", path, content }]);
  await projectRef(pid).update({ updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
};

const listSnapshots: Handler = async (uid, _req, [pid]) => {
  await getOwnedProject(uid, pid);
  return { snapshots: await fileStore().listSnapshots(pid) };
};

const restore: Handler = async (uid, _req, [pid, sid]) => {
  assertEditable(await getOwnedProject(uid, pid));
  const snapshotId = await fileStore().restore(pid, sid);
  if (!snapshotId) throw httpError(404, "not_found", "Snapshot not found");
  return { snapshotId };
};

/** One snapshot's files (a variant build's version, previewed before it is saved). */
const snapshotFiles: Handler = async (uid, _req, [pid, sid]) => {
  await getOwnedProject(uid, pid);
  const files = await fileStore().readSnapshot(pid, sid);
  if (!files) throw httpError(404, "not_found", "Version not found");
  return { files };
};

/**
 * Saves one version of a variant build as the app: its files become the app's (a non-destructive restore unless it
 * is the one already applied), the details are set, the chat starts with the request and that version's plan, and
 * the draft becomes a normal app. The other version stays in History.
 */
const saveVersion: Handler = async (uid, req, [pid]) => {
  const project = await getOwnedProject(uid, pid);
  const { name, description } = requireDetails(req.body);
  const unavailable = () => httpError(409, "version_unavailable", "This version is no longer available.");
  if (!project.draft) throw unavailable();
  const genRef = projectRef(pid).collection("generations").doc(project.draft.generationId);
  const gen = await genRef.get();
  const chosen = ((gen.get("finalists") as Finalist[] | undefined) ?? []).find((f) => f.snapshotId === req.body?.snapshotId);
  if (gen.get("status") !== "ready" || !chosen) throw unavailable();
  const store = fileStore();
  if (chosen.snapshotId !== gen.get("snapshotId") && !(await store.restore(pid, chosen.snapshotId))) throw unavailable();
  const messages = projectRef(pid).collection("messages");
  await messages.add({ role: "user", content: gen.get("prompt") ?? description, generationId: gen.id, createdAt: FieldValue.serverTimestamp() });
  await messages.add({ role: "assistant", content: `${chosen.plan}\n\nFiles: ${chosen.files.join(", ")}`, generationId: gen.id, createdAt: FieldValue.serverTimestamp() });
  await genRef.update({ status: "done", snapshotId: chosen.snapshotId, files: chosen.files });
  await projectRef(pid).update({
    name, description, category: toCategory(req.body?.category), draft: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
  });
  // The customer pays for the version they keep: the job charged the applied one, so keeping the other adjusts it.
  const applied = ((gen.get("finalists") as Finalist[] | undefined) ?? []).find((f) => f.snapshotId === gen.get("snapshotId"));
  const delta = applied && typeof chosen.credits === "number" && typeof applied.credits === "number" ? chosen.credits - applied.credits : 0;
  await adjustCharge(uid, gen.id, delta, { kind: "variants", reason: "kept another version", projectId: pid });
  const charged = (typeof gen.get("credits") === "number" ? gen.get("credits") as number : 0) + delta;
  if (delta) await genRef.update({ credits: charged });
  await updateBuild(uid, gen.id, { outcome: "saved", appName: name, href: `/p/${pid}`, versions: [chosen.title], ...(delta ? { credits: charged } : {}) });
  // In Langfuse, which version the customer kept: does the ranking match their taste? (1 = the top-ranked finalist)
  if (TRACING.value() === "langfuse") {
    const scores = (await db.doc(`variantScores/${gen.id}`).get()).data();
    const trace = scores?.trace as SentTrace | undefined;
    const rank = ((gen.get("finalists") as Finalist[] | undefined) ?? []).findIndex((f) => f.snapshotId === chosen.snapshotId) + 1;
    const versionIndex = (scores?.finalists as number[] | undefined)?.[rank - 1];
    if (trace && rank > 0 && versionIndex !== undefined) {
      await sendScores({ publicKey: LANGFUSE_PUBLIC_KEY.value(), secretKey: LANGFUSE_SECRET_KEY.value(), baseUrl: LANGFUSE_BASE_URL.value() },
        keptScores(gen.id, trace, versionIndex, rank));
    }
  }
  return { id: pid };
};

const previewToken: Handler = async (uid, _req, [pid]) => {
  const project = await getOwnedProject(uid, pid);
  const hl = await getUserHl(uid);
  if (!hl) throw httpError(409, "hl_not_connected", "HighLevel is not connected. Connect it to preview this app.");
  await useConnectedLocation(pid, project, hl.locationId);
  return {
    ...signPreviewToken({ uid, projectId: pid, locationId: hl.locationId }),
    locationId: hl.locationId,
    locationName: hl.locationName, // shown by apps as LOCATION_NAME, so they never hard-code it
  };
};

/** Removes every stored HighLevel secret for the user. Idempotent. */
const disconnectHl: Handler = async (uid) => {
  const states = await db.collection("oauthStates").where("uid", "==", uid).get();
  const batch = db.batch();
  batch.delete(db.doc(`hlTokens/${uid}`));
  batch.set(db.doc(`users/${uid}`), { hl: null }, { merge: true });
  states.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return { ok: true };
};

/** First-visit setup (after email verification): ready-made apps and the signup credits. */
const bootstrap: Handler = async (uid) => {
  const [seeded] = await Promise.all([seedTemplates(uid), syncGrantedScopes(uid)]);
  return { ...seeded, creditsGranted: await grantSignupCredits(uid) };
};

const routes: Array<[string, RegExp, Handler]> = [
  ["POST", /^\/bootstrap$/, bootstrap],
  ["POST", /^\/hl\/disconnect$/, disconnectHl],
  ["POST", /^\/projects$/, createProject],
  ["POST", /^\/variants$/, (uid, req) => startVariants(uid, req.body)],
  ["POST", /^\/notifications\/read$/, (uid, req) => markRead(uid, req.body?.ids)],
  ["POST", /^\/projects\/([^/]+)\/save$/, saveVersion],
  ["GET", /^\/projects\/([^/]+)\/snapshots\/([^/]+)\/files$/, snapshotFiles],
  ["GET", /^\/projects\/([^/]+)$/, getProject],
  ["POST", /^\/projects\/([^/]+)\/duplicate$/, duplicateProject],
  ["POST", /^\/projects\/([^/]+)\/pin$/, pinProject],
  ["PATCH", /^\/projects\/([^/]+)$/, updateProject],
  ["DELETE", /^\/projects\/([^/]+)$/, deleteProject],
  ["GET", /^\/projects\/([^/]+)\/files$/, listFiles],
  ["PUT", /^\/projects\/([^/]+)\/files$/, saveFile],
  ["GET", /^\/projects\/([^/]+)\/file$/, readFile],
  ["POST", /^\/projects\/([^/]+)\/generations\/([^/]+)\/cancel$/, cancelGeneration],
  ["GET", /^\/projects\/([^/]+)\/snapshots$/, listSnapshots],
  ["POST", /^\/projects\/([^/]+)\/snapshots\/([^/]+)\/restore$/, restore],
  ["POST", /^\/projects\/([^/]+)\/preview-token$/, previewToken],
];

// Per-user rate limits (in memory, per instance): changes are limited more tightly than reads.
const writes = createLimiter(LIMITS.apiWrites);
const reads = createLimiter(LIMITS.apiReads);

export const api = onRequest({ cors: APP_ORIGINS, secrets: [PREVIEW_TOKEN_SECRET, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY] }, async (req, res) => {
  try {
    const uid = await requireVerifiedUser(req);
    const isWrite = req.method !== "GET";
    const wait = (isWrite ? writes : reads).take(uid);
    if (wait) {
      throw rateLimited(wait, "Too many requests. Wait a moment and try again.", {
        limit: isWrite ? "apiWrites" : "apiReads", uid, method: req.method, path: req.path,
      });
    }
    for (const [method, pattern, handler] of routes) {
      const m = pattern.exec(req.path.replace(/\/$/, "") || "/");
      if (m && req.method === method) {
        res.json(await handler(uid, req, m.slice(1)));
        return;
      }
    }
    throw httpError(404, "not_found", "Unknown route");
  } catch (err) {
    sendError(res, err);
  }
});
