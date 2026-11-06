import { FieldValue, type DocumentReference, type WriteBatch } from "firebase-admin/firestore";
import { db } from "./admin";
import type { FileOp } from "./llm/validate";

export type ProjectFile = { path: string; content: string };

export const SEED_FILES: ProjectFile[] = [
  {
    path: "src/main.js",
    content: `import { createApp } from "vue";\nimport App from "./App.vue";\n\ncreateApp(App).mount("#app");\n`,
  },
  {
    path: "src/App.vue",
    content: `<template>\n  <main style="font-family: sans-serif; padding: 24px">\n    <h1>New project</h1>\n    <p>Describe your app in the chat to get started.</p>\n  </main>\n</template>\n`,
  },
];

const BATCH_LIMIT = 400;

export type SnapshotReason = "generation" | "restore" | "template" | "copy";

export const fileId = (path: string) => encodeURIComponent(path);

export const projectRef = (pid: string) => db.doc(`projects/${pid}`);

export async function readFiles(pid: string): Promise<ProjectFile[]> {
  const snap = await projectRef(pid).collection("files").get();
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

export function writeFileDoc(pid: string, path: string, content: string) {
  const ref = projectRef(pid).collection("files").doc(fileId(path));
  return (b: WriteBatch) => b.set(ref, { path, content, updatedAt: FieldValue.serverTimestamp() });
}

export async function applyOps(pid: string, ops: FileOp[]): Promise<void> {
  const files = projectRef(pid).collection("files");
  await commitInChunks(
    ops.map((op) =>
      op.type === "write"
        ? writeFileDoc(pid, op.path, op.content)
        : (b: WriteBatch) => b.delete(files.doc(fileId(op.path))),
    ),
  );
}

export async function createSnapshot(
  pid: string,
  generationId: string | null,
  reason: SnapshotReason,
  summary: string | null = null,
): Promise<string> {
  const files = await readFiles(pid);
  const ref: DocumentReference = projectRef(pid).collection("snapshots").doc();
  await ref.set({ generationId, reason, summary, createdAt: FieldValue.serverTimestamp(), fileCount: files.length });
  await commitInChunks(
    files.map((f) => (b: WriteBatch) => b.set(ref.collection("files").doc(fileId(f.path)), f)),
  );
  return ref.id;
}

/** Makes the project's file set exactly `files`: writes them all and deletes anything else. */
export async function replaceFiles(pid: string, files: ProjectFile[]): Promise<void> {
  const keep = new Set(files.map((f) => f.path));
  const current = await readFiles(pid);
  const filesCol = projectRef(pid).collection("files");
  await commitInChunks([
    ...current.filter((f) => !keep.has(f.path)).map((f) => (b: WriteBatch) => b.delete(filesCol.doc(fileId(f.path)))),
    ...files.map((f) => writeFileDoc(pid, f.path, f.content)),
  ]);
}

/** Replaces the project's files with the snapshot's, then records a `restore` snapshot. */
export async function restoreSnapshot(pid: string, sid: string): Promise<string | null> {
  const snapRef = projectRef(pid).collection("snapshots").doc(sid);
  const snapSnap = await snapRef.get();
  if (!snapSnap.exists) return null;
  const snapFiles = (await snapRef.collection("files").get()).docs.map((d) => d.data() as ProjectFile);
  await replaceFiles(pid, snapFiles);
  const original = snapSnap.get("summary") as string | null;
  return createSnapshot(pid, null, "restore", `Restored: ${original ?? "an earlier version"}`);
}
