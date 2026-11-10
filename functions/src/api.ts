import { FieldValue } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { db } from "./admin";
import { PREVIEW_TOKEN_SECRET } from "./config";
import {
  applyOps, createSnapshot, fileId, projectRef, readFiles, restoreSnapshot, SEED_FILES, writeFileDoc,
} from "./files";
import { grantSignupCredits } from "./credits";
import { httpError, requireVerifiedUser, sendError } from "./http";
import { checkPath, MAX_FILE_BYTES } from "./llm/validate";
import { signPreviewToken } from "./previewToken";
import { assertEditable, getOwnedProject, getUserHl, toCategory, useConnectedLocation } from "./projects";
import { seedTemplates } from "./templates";

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
  await applyOps(ref.id, SEED_FILES.map((f) => ({ type: "write" as const, ...f })));
  return { id: ref.id };
};

/** Copies an app (including a locked prebuilt one) into a new, editable user app. */
const duplicateProject: Handler = async (uid, req, [pid]) => {
  const source = await getOwnedProject(uid, pid);
  const { name, description } = requireDetails(req.body);
  const hl = await getUserHl(uid);
  const files = await readFiles(pid);

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
  await applyOps(ref.id, files.map((f) => ({ type: "write" as const, ...f })));
  await createSnapshot(ref.id, null, "copy", `Created from ${source.name}`);
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

/** Asks a running build to stop. The generate function watches the generation doc and stops the model. */
const cancelGeneration: Handler = async (uid, _req, [pid, gid]) => {
  await getOwnedProject(uid, pid);
  const ref = projectRef(pid).collection("generations").doc(gid);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, "not_found", "Generation not found");
  if (snap.get("status") !== "streaming") return { requested: false }; // already finished
  await ref.update({ cancelRequested: true });
  return { requested: true };
};

const listFiles: Handler = async (uid, req, [pid]) => {
  await getOwnedProject(uid, pid);
  const files = await readFiles(pid);
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
  const snap = await projectRef(pid).collection("files").doc(fileId(path)).get();
  if (!snap.exists) throw httpError(404, "not_found", "File not found");
  return { path, content: snap.get("content") };
};

const saveFile: Handler = async (uid, req, [pid]) => {
  assertEditable(await getOwnedProject(uid, pid));
  const path = text(req.body?.path, 300);
  const content = req.body?.content;
  const pathError = checkPath(path);
  if (pathError) throw httpError(400, "invalid_path", pathError);
  if (typeof content !== "string") throw httpError(400, "invalid_content", "content must be a string");
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw httpError(413, "too_large", "File is too large");
  const batch = db.batch();
  writeFileDoc(pid, path, content)(batch);
  batch.update(projectRef(pid), { updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { ok: true };
};

const listSnapshots: Handler = async (uid, _req, [pid]) => {
  await getOwnedProject(uid, pid);
  const snap = await projectRef(pid).collection("snapshots").orderBy("createdAt", "desc").limit(50).get();
  return {
    snapshots: snap.docs.map((d) => ({
      id: d.id,
      reason: d.get("reason"),
      summary: d.get("summary") ?? null,
      generationId: d.get("generationId"),
      fileCount: d.get("fileCount"),
      createdAt: d.get("createdAt")?.toMillis() ?? null,
    })),
  };
};

const restore: Handler = async (uid, _req, [pid, sid]) => {
  assertEditable(await getOwnedProject(uid, pid));
  const snapshotId = await restoreSnapshot(pid, sid);
  if (!snapshotId) throw httpError(404, "not_found", "Snapshot not found");
  return { snapshotId };
};

const previewToken: Handler = async (uid, _req, [pid]) => {
  const project = await getOwnedProject(uid, pid);
  const hl = await getUserHl(uid);
  if (!hl) throw httpError(409, "hl_not_connected", "HighLevel is not connected. Connect it to preview this app.");
  await useConnectedLocation(pid, project, hl.locationId);
  return { ...signPreviewToken({ uid, projectId: pid, locationId: hl.locationId }), locationId: hl.locationId };
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
  const seeded = await seedTemplates(uid);
  return { ...seeded, creditsGranted: await grantSignupCredits(uid) };
};

const routes: Array<[string, RegExp, Handler]> = [
  ["POST", /^\/bootstrap$/, bootstrap],
  ["POST", /^\/hl\/disconnect$/, disconnectHl],
  ["POST", /^\/projects$/, createProject],
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

export const api = onRequest({ cors: true, secrets: [PREVIEW_TOKEN_SECRET] }, async (req, res) => {
  try {
    const uid = await requireVerifiedUser(req);
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
