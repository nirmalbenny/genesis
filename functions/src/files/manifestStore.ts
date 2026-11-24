import { FieldValue } from "firebase-admin/firestore";
import { db } from "../admin";
import { httpError } from "../http";
import type { FileOp } from "../llm/validate";
import type { BlobStore } from "./blobStore";
import { contentHash, describeFile } from "./describe";
import type { FileEntry, FileStore, Manifest, SnapshotInfo, SnapshotReason } from "./index";
import type { Migrator } from "./migrate";

/**
 * Files as content-addressed blobs (blobStore) plus a manifest (path → hash + metadata) on the project
 * document. A change uploads new content first and then switches the manifest in one transaction, so readers
 * never see a half-applied change. A snapshot is a copy of the manifest, not of the files.
 */

export const entryFor = (path: string, content: string): FileEntry => ({ hash: contentHash(content), ...describeFile(path, content) });

/** The manifest after `ops` (pure). `entries` holds the new entry of every written path. */
export function nextManifest(current: Manifest, ops: FileOp[], entries: Map<string, FileEntry>): Manifest {
  const next = { ...current };
  for (const op of ops) {
    if (op.type === "write") next[op.path] = entries.get(op.path)!;
    else delete next[op.path];
  }
  return next;
}

/**
 * Content that must be uploaded for `ops`, once per distinct hash (pure). Content the current manifest already
 * references, under any path, is stored: it is skipped.
 */
export function uploadsFor(current: Manifest, ops: FileOp[], entries: Map<string, FileEntry>): Map<string, string> {
  const stored = new Set(Object.values(current).map((e) => e.hash));
  const uploads = new Map<string, string>(); // hash → content
  for (const op of ops) {
    if (op.type !== "write") continue;
    const { hash } = entries.get(op.path)!;
    if (!stored.has(hash)) uploads.set(hash, op.content);
  }
  return uploads;
}

type Loaded = { uid: string; manifest: Manifest; version: number };

const project = (pid: string) => db.doc(`projects/${pid}`);
const snapshots = (pid: string) => project(pid).collection("snapshots");

function loaded(pid: string, data: FirebaseFirestore.DocumentData | undefined): Loaded {
  if (!data) throw httpError(404, "not_found", "Project not found");
  return { uid: data.ownerId as string, manifest: (data.manifest as Manifest | undefined) ?? {}, version: (data.manifestVersion as number | undefined) ?? 0 };
}

/**
 * `migrate` converts a project that has no manifest yet (still in Firestore) on first access, and an old
 * snapshot when it's restored. Without it, a project without a manifest is treated as empty.
 */
export function createManifestStore(blobs: BlobStore, migrate?: Migrator): FileStore {
  const load = async (pid: string): Promise<Loaded> => {
    const data = (await project(pid).get()).data();
    if (!migrate || !data || data.manifest !== undefined) return loaded(pid, data);
    await migrate.project(pid, data.ownerId as string);
    return loaded(pid, (await project(pid).get()).data());
  };

  /** Uploads the content of `ops` (only what changed), then switches the manifest in one transaction. */
  async function apply(pid: string, ops: FileOp[], opts: { expectedVersion?: number } = {}): Promise<void> {
    const { uid, manifest } = await load(pid);
    const entries = new Map(ops.flatMap((op) => (op.type === "write" ? [[op.path, entryFor(op.path, op.content)] as const] : [])));
    // A hash that the current manifest already references is stored: no upload. Everything else is put first.
    await Promise.all([...uploadsFor(manifest, ops, entries).values()].map((content) => blobs.put(uid, content)));
    await db.runTransaction(async (tx) => {
      const current = loaded(pid, (await tx.get(project(pid))).data());
      if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) {
        throw httpError(409, "files_changed", "The app's files changed while saving. Reload and try again.");
      }
      // Re-read inside the transaction: changes committed since `load` are kept (merged by path). Content skipped
      // above was referenced by the manifest at `load`, so it is stored (cleanup keeps referenced blobs).
      tx.update(project(pid), { manifest: nextManifest(current.manifest, ops, entries), manifestVersion: current.version + 1 });
    });
  }

  async function snapshot(pid: string, generationId: string | null, reason: SnapshotReason, summary: string | null = null) {
    const { manifest } = await load(pid);
    const ref = snapshots(pid).doc();
    // The manifest is written with the snapshot, in one write: a snapshot is never half-saved.
    await ref.set({ generationId, reason, summary, createdAt: FieldValue.serverTimestamp(), fileCount: Object.keys(manifest).length, manifest });
    return ref.id;
  }

  return {
    async manifest(pid) {
      return (await load(pid)).manifest;
    },

    async read(pid, paths) {
      const { uid, manifest } = await load(pid);
      const present = paths.filter((p) => manifest[p]);
      return Promise.all(present.map(async (path) => ({ path, content: await blobs.get(uid, manifest[path]!.hash) })));
    },

    async readAll(pid) {
      const { uid, manifest } = await load(pid);
      const paths = Object.keys(manifest).sort((a, b) => a.localeCompare(b));
      return Promise.all(paths.map(async (path) => ({ path, content: await blobs.get(uid, manifest[path]!.hash) })));
    },

    apply,
    snapshot,

    async stageSnapshot(pid, ops, generationId, summary) {
      const { uid, manifest } = await load(pid);
      const entries = new Map(ops.flatMap((op) => (op.type === "write" ? [[op.path, entryFor(op.path, op.content)] as const] : [])));
      await Promise.all([...uploadsFor(manifest, ops, entries).values()].map((content) => blobs.put(uid, content)));
      const staged = nextManifest(manifest, ops, entries);
      const ref = snapshots(pid).doc();
      await ref.set({ generationId, reason: "variant", summary, createdAt: FieldValue.serverTimestamp(), fileCount: Object.keys(staged).length, manifest: staged });
      return ref.id;
    },

    async readSnapshot(pid, sid) {
      const { uid } = await load(pid);
      const ref = snapshots(pid).doc(sid);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const manifest = (snap.get("manifest") as Manifest | undefined) ?? (await migrate?.snapshot(uid, ref)) ?? {};
      const paths = Object.keys(manifest).sort((a, b) => a.localeCompare(b));
      return Promise.all(paths.map(async (path) => ({ path, content: await blobs.get(uid, manifest[path]!.hash) })));
    },

    async restore(pid, sid) {
      const { uid } = await load(pid);
      const ref = snapshots(pid).doc(sid);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const manifest = (snap.get("manifest") as Manifest | undefined) ?? (await migrate?.snapshot(uid, ref)) ?? {};
      await db.runTransaction(async (tx) => {
        const current = loaded(pid, (await tx.get(project(pid))).data());
        tx.update(project(pid), { manifest, manifestVersion: current.version + 1 });
      });
      const original = snap.get("summary") as string | null;
      return snapshot(pid, null, "restore", `Restored: ${original ?? "an earlier version"}`);
    },

    async copy(fromPid, toPid) {
      const from = await load(fromPid);
      await db.runTransaction(async (tx) => {
        const to = loaded(toPid, (await tx.get(project(toPid))).data());
        // Blobs are per user: sharing them is only possible within one account (duplicate is owner-only).
        if (to.uid !== from.uid) throw new Error("copy across accounts is not supported");
        tx.update(project(toPid), { manifest: from.manifest, manifestVersion: to.version + 1 });
      });
    },

    async listSnapshots(pid): Promise<SnapshotInfo[]> {
      // select(): the list doesn't need each snapshot's manifest.
      const snap = await snapshots(pid).select("generationId", "reason", "summary", "fileCount", "createdAt")
        .orderBy("createdAt", "desc").limit(50).get();
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
}
