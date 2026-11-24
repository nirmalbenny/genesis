import { db } from "../admin";
import { FILE_STORE } from "../config";
import type { FileOp } from "../llm/validate";
import { createStorageBlobStore } from "./blobStore";
import type { FileMeta } from "./describe";
import { firestoreFileStore } from "./firestoreStore";
import { createManifestStore } from "./manifestStore";
import { createMigrator } from "./migrate";

/**
 * Project files. Every read and write of a project's files, snapshots and restores goes through a FileStore,
 * so the storage behind it can change without touching the callers.
 */
export type ProjectFile = { path: string; content: string };

/** What the store knows about one file without reading its content. */
export type FileEntry = { hash: string } & FileMeta;
/** path → entry, for every file of a project (or of a snapshot). */
export type Manifest = Record<string, FileEntry>;

export type SnapshotReason = "generation" | "restore" | "template" | "copy" | "variant";
export type SnapshotInfo = {
  id: string; reason: SnapshotReason; summary: string | null; generationId: string | null; fileCount: number; createdAt: number | null;
};

export interface FileStore {
  manifest(pid: string): Promise<Manifest>;
  /** The listed files that exist, in the order given. */
  read(pid: string, paths: string[]): Promise<ProjectFile[]>;
  /** Every file, sorted by path. */
  readAll(pid: string): Promise<ProjectFile[]>;
  /**
   * Applies writes and deletes. With `expectedVersion`, fails with 409 `files_changed` if the files changed since
   * that version; without it, concurrent changes are merged (each path's last write wins).
   */
  apply(pid: string, ops: FileOp[], opts?: { expectedVersion?: number }): Promise<void>;
  snapshot(pid: string, generationId: string | null, reason: SnapshotReason, summary?: string | null): Promise<string>;
  /**
   * Records a snapshot of the files `ops` would produce on top of the current ones, without changing the project's
   * files (a variant build's finalists, docs/plans/build-variants.md). Content is stored first.
   */
  stageSnapshot(pid: string, ops: FileOp[], generationId: string, summary: string): Promise<string>;
  /** A snapshot's files, sorted by path, or null when it doesn't exist. */
  readSnapshot(pid: string, sid: string): Promise<ProjectFile[] | null>;
  /** Replaces the files with the snapshot's, then records a `restore` snapshot. Null when the snapshot doesn't exist. */
  restore(pid: string, sid: string): Promise<string | null>;
  /** Gives `toPid` the same files as `fromPid` (same owner). */
  copy(fromPid: string, toPid: string): Promise<void>;
  /** The 50 most recent snapshots, newest first. */
  listSnapshots(pid: string): Promise<SnapshotInfo[]>;
}

export const SEED_FILES: ProjectFile[] = [
  {
    path: "src/main.js",
    content: `import { mountApp } from "./genesis/setup.js";\nimport App from "./App.vue";\n\nmountApp(App);\n`,
  },
  {
    path: "src/App.vue",
    content: `<template>\n  <main style="font-family: sans-serif; padding: 24px">\n    <h1>New project</h1>\n    <p>Describe your app in the chat to get started.</p>\n  </main>\n</template>\n`,
  },
];

export const projectRef = (pid: string) => db.doc(`projects/${pid}`);

export const writeOps = (files: ProjectFile[]): FileOp[] => files.map((f) => ({ type: "write", path: f.path, content: f.content }));

let manifestStore: FileStore | null = null;

/** The store selected by FILE_STORE: `firestore` (original, default) or `blobs` (Cloud Storage + manifest). */
export function fileStore(): FileStore {
  if (FILE_STORE.value() !== "blobs") return firestoreFileStore;
  if (!manifestStore) {
    const blobs = createStorageBlobStore();
    manifestStore = createManifestStore(blobs, createMigrator(blobs));
  }
  return manifestStore;
}

/** Makes the project's file set exactly `files`: writes them all and deletes anything else. */
export async function replaceFiles(store: FileStore, pid: string, files: ProjectFile[]): Promise<void> {
  const keep = new Set(files.map((f) => f.path));
  const current = Object.keys(await store.manifest(pid));
  await store.apply(pid, [
    ...current.filter((p) => !keep.has(p)).map((path) => ({ type: "delete" as const, path })),
    ...writeOps(files),
  ]);
}
