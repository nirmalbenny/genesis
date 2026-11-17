import type { DocumentReference } from "firebase-admin/firestore";
import { db } from "../admin";
import type { BlobStore } from "./blobStore";
import type { Manifest, ProjectFile } from "./index";
import { entryFor } from "./manifestStore";

/**
 * Moves a project from the Firestore store (files/ subcollection) to blobs + manifest. Lazy: the manifest store
 * calls it the first time it meets a project without a manifest; the backfill script calls it for every project.
 * Firestore file documents are never deleted here (their removal is a later, separate release).
 */
export type Migrator = {
  /** Gives the project a manifest built from its Firestore files. Idempotent: does nothing if one appeared meanwhile. */
  project(pid: string, uid: string): Promise<void>;
  /** The manifest of a snapshot taken by the Firestore store (files/ subcollection), stored on the snapshot. */
  snapshot(uid: string, ref: DocumentReference): Promise<Manifest>;
};

const filesIn = async (ref: DocumentReference): Promise<ProjectFile[]> =>
  (await ref.collection("files").get()).docs.map((d) => ({ path: d.get("path") as string, content: d.get("content") as string }));

export function createMigrator(blobs: BlobStore): Migrator {
  /** Uploads every file (each distinct content once) and returns their manifest. */
  async function upload(uid: string, files: ProjectFile[]): Promise<Manifest> {
    const contents = new Map(files.map((f) => [f.content, true]));
    await Promise.all([...contents.keys()].map((c) => blobs.put(uid, c)));
    return Object.fromEntries(files.map((f) => [f.path, entryFor(f.path, f.content)]));
  }

  return {
    async project(pid, uid) {
      const ref = db.doc(`projects/${pid}`);
      const manifest = await upload(uid, await filesIn(ref));
      // Two first accesses may both get here: content-addressed uploads are harmless twice, and only the first
      // manifest is kept. A version bump keeps `expectedVersion` checks monotonic across the switch.
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists || doc.get("manifest") !== undefined) return;
        tx.update(ref, { manifest, manifestVersion: ((doc.get("manifestVersion") as number | undefined) ?? 0) + 1 });
      });
    },

    async snapshot(uid, ref) {
      const manifest = await upload(uid, await filesIn(ref));
      await ref.update({ manifest }); // snapshots never change, so there is nothing to race with
      return manifest;
    },
  };
}
