/**
 * Measures the two file stores on the emulators (never production): time per operation, documents written,
 * Storage uploads, and document sizes; plus how much build context a large app sends. No Claude, no HighLevel.
 *
 *   firebase emulators:exec --only firestore,storage "npm --prefix functions run measure:files"
 *
 * Emulator latency is not production latency: compare the stores with each other, not with real numbers.
 */
import { db } from "../admin";
import { contentHash } from "../files/describe";
import { createStorageBlobStore, type BlobStore } from "../files/blobStore";
import { firestoreFileStore } from "../files/firestoreStore";
import { createManifestStore, entryFor } from "../files/manifestStore";
import type { FileStore, Manifest, ProjectFile } from "../files/index";
import { renderContext, selectContext } from "../llm/context";
import { loadTemplates } from "../templates";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  console.error("Run on the emulators only (FIRESTORE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST must be set).");
  process.exit(2);
}
const PROJECT = process.env.GCLOUD_PROJECT ?? "demo-genesis";
const BUCKET = `${PROJECT}.firebasestorage.app`;
const RUNS = 5;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
async function time(fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

/** Counts uploads (puts that were not skipped by the manifest) around a real Storage blob store. */
function counted(inner: BlobStore) {
  const c = { puts: 0 };
  return { c, store: { put: (u: string, s: string) => { c.puts++; return inner.put(u, s); }, get: inner.get } as BlobStore };
}

async function newProject(uid: string) {
  const ref = db.collection("projects").doc();
  await ref.set({ ownerId: uid, name: "measure", deletedAt: null });
  return ref.id;
}

const docCount = async (path: string) => (await db.collection(path).count().get()).data().count;

async function measure(name: string, store: FileStore, files: ProjectFile[], uploads?: { puts: number }) {
  const uid = `measure-${Date.now()}`;
  const rows: Record<string, number[]> = { create: [], save: [], readAll: [], readOne: [], snapshot: [], restore: [], copy: [] };
  const writes: Record<string, number> = {};
  for (let i = 0; i < RUNS; i++) {
    const pid = await newProject(uid);
    const before = uploads?.puts ?? 0;
    rows.create!.push(await time(() => store.apply(pid, files.map((f) => ({ type: "write", ...f })))));
    if (i === 0) writes.createUploads = (uploads?.puts ?? 0) - before;
    const edited = { ...files[0]!, content: `${files[0]!.content}\n<!-- edit ${i} ${Date.now()} -->` };
    rows.save!.push(await time(() => store.apply(pid, [{ type: "write", ...edited }])));
    rows.readAll!.push(await time(() => store.readAll(pid)));
    rows.readOne!.push(await time(() => store.read(pid, [files[0]!.path])));
    let sid = "";
    rows.snapshot!.push(await time(async () => { sid = await store.snapshot(pid, null, "generation", "measure"); }));
    if (i === 0) {
      writes.snapshotFileDocs = await docCount(`projects/${pid}/snapshots/${sid}/files`);
      writes.projectFileDocs = await docCount(`projects/${pid}/files`);
      const project = (await db.doc(`projects/${pid}`).get()).data()!;
      writes.manifestBytes = project.manifest ? Buffer.byteLength(JSON.stringify(project.manifest)) : 0;
      const snap = (await db.doc(`projects/${pid}/snapshots/${sid}`).get()).data()!;
      writes.snapshotDocBytes = Buffer.byteLength(JSON.stringify(snap));
    }
    rows.restore!.push(await time(() => store.restore(pid, sid)));
    const copy = await newProject(uid);
    rows.copy!.push(await time(() => store.copy(pid, copy)));
  }
  console.log(`\n${name}: ${files.length} files, ${files.reduce((n, f) => n + f.content.length, 0)} chars (median of ${RUNS} runs, ms)`);
  for (const [op, xs] of Object.entries(rows)) console.log(`  ${op.padEnd(9)} ${median(xs).toFixed(0).padStart(6)}`);
  console.log(`  ${JSON.stringify(writes)}`);
}

async function main() {
  const { apps } = loadTemplates();
  const app = apps.reduce((a, b) => (b.files.length > a.files.length ? b : a));
  // A large app: four copies of the biggest template under different folders, well over the 60,000-char budget.
  const large = [0, 1, 2, 3].flatMap((k) => app.files.map((f) => ({ path: k ? f.path.replace("src/", `src/part${k}/`) : f.path, content: f.content })));

  for (const files of [app.files, large]) {
    await measure("firestore store", firestoreFileStore, files);
    const blobs = counted(createStorageBlobStore({ bucket: BUCKET }));
    await measure("blobs + manifest", createManifestStore(blobs.store), files, blobs.c);
    const cold = counted(createStorageBlobStore({ bucket: BUCKET, cache: false }));
    await measure("blobs + manifest, no cache (cold instance)", createManifestStore(cold.store), files, cold.c);
  }

  // Context: what a build sends for the large app, before (everything that fits, alphabetically) and now.
  const manifest: Manifest = Object.fromEntries(large.map((f) => [f.path, entryFor(f.path, f.content)]));
  const byPath = new Map(large.map((f) => [f.path, f]));
  const sel = selectContext(manifest, { prompt: "Add a phone column", activePath: large.find((f) => f.path.includes("components/"))?.path ?? null });
  const text = renderContext(sel.full.map((p) => byPath.get(p)!), manifest, sel.index, true);
  console.log(`\ncontext for the large app: ${sel.full.length} files in full, ${sel.index.length} indexed, ${text.length} chars ` +
    `(index part ${text.length - sel.full.reduce((n, p) => n + byPath.get(p)!.content.length + p.length + 22, 0)} chars), ` +
    `hash ${contentHash(text).slice(0, 8)}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
