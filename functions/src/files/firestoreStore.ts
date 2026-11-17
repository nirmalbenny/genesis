import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
import { db } from "../admin";
import type { FileOp } from "../llm/validate";
import { contentHash } from "./describe";
import type { FileStore, Manifest, ProjectFile, SnapshotInfo, SnapshotReason } from "./index";

/**
 * The original storage: one Firestore document per file under projects/{pid}/files, and a full copy of every
 * file under each snapshot. Kept as the fallback while FILE_STORE=firestore.
 */
const BATCH_LIMIT = 400;

const fileId = (path: string) => encodeURIComponent(path);
const project = (pid: string) => db.doc(`projects/${pid}`);
const filesOf = (pid: string) => project(pid).collection("files");

async function readAll(pid: string): Promise<ProjectFile[]> {
  const snap = await filesOf(pid).get();
  return snap.docs
    .map((d) => ({ path: d.get("path") as string, content: d.get("content") as string }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Commits writes in chunks so large projects stay under Firestore's batch limit. */
async function commitInChunks(items: Array<(b: WriteBatch) => void>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    items.slice(i, i + BATCH_LIMIT).forEach((add) => add(batch));
    await batch.commit();
  }
}

function writeFileDoc(pid: string, path: string, content: string) {
  const ref = filesOf(pid).doc(fileId(path));
  return (b: WriteBatch) => b.set(ref, { path, content, updatedAt: FieldValue.serverTimestamp() });
}

async function apply(pid: string, ops: FileOp[]): Promise<void> {
  await commitInChunks(
    ops.map((op) =>
      op.type === "write"
        ? writeFileDoc(pid, op.path, op.content)
        : (b: WriteBatch) => b.delete(filesOf(pid).doc(fileId(op.path))),
    ),
  );
}

async function snapshot(pid: string, generationId: string | null, reason: SnapshotReason, summary: string | null = null): Promise<string> {
  const files = await readAll(pid);
  const ref = project(pid).collection("snapshots").doc();
  await ref.set({ generationId, reason, summary, createdAt: FieldValue.serverTimestamp(), fileCount: files.length });
  await commitInChunks(files.map((f) => (b: WriteBatch) => b.set(ref.collection("files").doc(fileId(f.path)), f)));
  return ref.id;
}

/** Makes the project's file set exactly `files`: writes them all and deletes anything else. */
async function replace(pid: string, files: ProjectFile[]): Promise<void> {
  const keep = new Set(files.map((f) => f.path));
  const current = await readAll(pid);
  await commitInChunks([
    ...current.filter((f) => !keep.has(f.path)).map((f) => (b: WriteBatch) => b.delete(filesOf(pid).doc(fileId(f.path)))),
    ...files.map((f) => writeFileDoc(pid, f.path, f.content)),
  ]);
}

export const firestoreFileStore: FileStore = {
  async manifest(pid): Promise<Manifest> {
    const files = await readAll(pid);
    return Object.fromEntries(files.map((f) => [f.path, { hash: contentHash(f.content), size: Buffer.byteLength(f.content) }]));
  },

  async read(pid, paths) {
    if (!paths.length) return [];
    const snaps = await db.getAll(...paths.map((p) => filesOf(pid).doc(fileId(p))));
    return snaps.filter((s) => s.exists).map((s) => ({ path: s.get("path") as string, content: s.get("content") as string }));
  },

  readAll,
  apply,
  snapshot,

  async restore(pid, sid) {
    const snapRef = project(pid).collection("snapshots").doc(sid);
    const snapSnap = await snapRef.get();
    if (!snapSnap.exists) return null;
    const snapFiles = (await snapRef.collection("files").get()).docs.map((d) => d.data() as ProjectFile);
    await replace(pid, snapFiles);
    const original = snapSnap.get("summary") as string | null;
    return snapshot(pid, null, "restore", `Restored: ${original ?? "an earlier version"}`);
  },

  async copy(fromPid, toPid) {
    const files = await readAll(fromPid);
    await apply(toPid, files.map((f) => ({ type: "write", ...f })));
  },

  async listSnapshots(pid): Promise<SnapshotInfo[]> {
    const snap = await project(pid).collection("snapshots").orderBy("createdAt", "desc").limit(50).get();
    return snap.docs.map((d) => ({
      id: d.id,
      reason: d.get("reason"),
      summary: d.get("summary") ?? null,
      generationId: d.get("generationId"),
      fileCount: d.get("fileCount"),
      createdAt: d.get("createdAt")?.toMillis() ?? null,
    }));
  },
};
