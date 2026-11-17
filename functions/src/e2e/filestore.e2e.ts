/**
 * The blob + manifest file store, run in this process against the Firestore emulator. Content goes to an
 * in-memory blob store, so these tests check the manifest logic (transactions, snapshots, restore, copy) on
 * their own; storage.e2e.ts covers the real Storage emulator through the API.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, newUser } from "./helpers";
import { contentHash } from "../files/describe";
import type { BlobStore } from "../files/blobStore";
import { createManifestStore } from "../files/manifestStore";

function memoryBlobs() {
  const blobs = new Map<string, string>();
  const puts: string[] = [];
  const store: BlobStore = {
    async put(uid, content) {
      const hash = contentHash(content);
      puts.push(hash);
      blobs.set(`${uid}/${hash}`, content);
      return hash;
    },
    async get(uid, hash) {
      const v = blobs.get(`${uid}/${hash}`);
      if (v === undefined) throw new Error(`missing blob ${hash}`);
      return v;
    },
  };
  return { store, blobs, puts };
}

async function newProject(ownerId: string): Promise<string> {
  const ref = db.collection("projects").doc();
  await ref.set({ ownerId, name: "Store test", deletedAt: null });
  return ref.id;
}

const w = (path: string, content: string) => ({ type: "write" as const, path, content });

test("apply writes content first, then one manifest with a new version; unchanged content isn't uploaded again", async () => {
  const { uid } = await newUser();
  const { store, puts } = memoryBlobs();
  const files = createManifestStore(store);
  const pid = await newProject(uid);

  await files.apply(pid, [w("src/App.vue", "<template>a</template>"), w("src/main.js", "main")]);
  await files.apply(pid, [w("src/App.vue", "<template>a</template>"), w("src/utils.js", "main")]);
  assert.equal(puts.length, 2, "the second change uploads nothing: App.vue is unchanged and utils.js has main.js's content");

  const doc = (await db.doc(`projects/${pid}`).get()).data()!;
  assert.equal(doc.manifestVersion, 2);
  assert.deepEqual(Object.keys(doc.manifest).sort(), ["src/App.vue", "src/main.js", "src/utils.js"]);
  assert.equal(doc.manifest["src/utils.js"].hash, doc.manifest["src/main.js"].hash, "same content, same blob");
  assert.deepEqual(await files.readAll(pid), [
    { path: "src/App.vue", content: "<template>a</template>" },
    { path: "src/main.js", content: "main" },
    { path: "src/utils.js", content: "main" },
  ]);
  assert.deepEqual(await files.read(pid, ["src/utils.js", "src/missing.js"]), [{ path: "src/utils.js", content: "main" }]);

  await files.apply(pid, [{ type: "delete", path: "src/utils.js" }]);
  assert.deepEqual(Object.keys(await files.manifest(pid)).sort(), ["src/App.vue", "src/main.js"]);
});

test("concurrent changes to different files both land; a strict version check refuses a stale change", async () => {
  const { uid } = await newUser();
  const files = createManifestStore(memoryBlobs().store);
  const pid = await newProject(uid);
  await files.apply(pid, [w("src/App.vue", "v1")]);

  await Promise.all([files.apply(pid, [w("src/A.vue", "a")]), files.apply(pid, [w("src/B.vue", "b")])]);
  assert.deepEqual(Object.keys(await files.manifest(pid)).sort(), ["src/A.vue", "src/App.vue", "src/B.vue"]);

  await assert.rejects(files.apply(pid, [w("src/App.vue", "stale")], { expectedVersion: 1 }), { status: 409, code: "files_changed" });
  const version = (await db.doc(`projects/${pid}`).get()).get("manifestVersion");
  await files.apply(pid, [w("src/App.vue", "fresh")], { expectedVersion: version });
  assert.deepEqual(await files.read(pid, ["src/App.vue"]), [{ path: "src/App.vue", content: "fresh" }]);
});

test("a snapshot is one document holding the manifest; restoring replaces the files and records a restore", async () => {
  const { uid } = await newUser();
  const { store, puts } = memoryBlobs();
  const files = createManifestStore(store);
  const pid = await newProject(uid);
  await files.apply(pid, [w("src/App.vue", "one"), w("src/Extra.vue", "extra")]);
  const sid = await files.snapshot(pid, "gen1", "generation", "First version");

  const snap = (await db.doc(`projects/${pid}/snapshots/${sid}`).get()).data()!;
  assert.equal(snap.fileCount, 2);
  assert.deepEqual(Object.keys(snap.manifest).sort(), ["src/App.vue", "src/Extra.vue"]);
  assert.equal((await db.collection(`projects/${pid}/snapshots/${sid}/files`).get()).size, 0, "no file copies");

  await files.apply(pid, [w("src/App.vue", "two"), { type: "delete", path: "src/Extra.vue" }, w("src/New.vue", "new")]);
  const uploads = puts.length;
  const restored = await files.restore(pid, sid);
  assert.ok(restored);
  assert.equal(puts.length, uploads, "restoring uploads nothing: the content is already stored");
  assert.deepEqual(await files.readAll(pid), [{ path: "src/App.vue", content: "one" }, { path: "src/Extra.vue", content: "extra" }]);

  const list = await files.listSnapshots(pid);
  assert.deepEqual(list.map((s) => s.reason), ["restore", "generation"]);
  assert.equal(list[0]!.summary, "Restored: First version");
  assert.equal("manifest" in list[0]!, false, "the list doesn't carry manifests");
  assert.equal(await files.restore(pid, "no-such-snapshot"), null);
});

test("a snapshot from before the migration (files subcollection) can still be restored", async () => {
  const { uid } = await newUser();
  const { store, blobs } = memoryBlobs();
  const files = createManifestStore(store);
  const pid = await newProject(uid);
  await files.apply(pid, [w("src/App.vue", "current")]);
  const legacy = db.collection(`projects/${pid}/snapshots`).doc();
  await legacy.set({ generationId: null, reason: "generation", summary: "Old", fileCount: 1, createdAt: new Date(0) });
  await legacy.collection("files").doc(encodeURIComponent("src/App.vue")).set({ path: "src/App.vue", content: "legacy" });

  await files.restore(pid, legacy.id);
  assert.deepEqual(await files.readAll(pid), [{ path: "src/App.vue", content: "legacy" }]);
  assert.ok(blobs.has(`${uid}/${contentHash("legacy")}`), "its content now lives in the blob store");
  assert.ok((await legacy.get()).get("manifest"), "and the snapshot keeps the manifest for next time");
});

test("copy shares content within one account and is refused across accounts", async () => {
  const [a, b] = await Promise.all([newUser(), newUser()]);
  const { store, puts } = memoryBlobs();
  const files = createManifestStore(store);
  const [source, copy, foreign] = await Promise.all([newProject(a.uid), newProject(a.uid), newProject(b.uid)]);
  await files.apply(source, [w("src/App.vue", "shared")]);
  const uploads = puts.length;

  await files.copy(source, copy);
  assert.equal(puts.length, uploads, "a copy uploads nothing");
  assert.deepEqual(await files.readAll(copy), [{ path: "src/App.vue", content: "shared" }]);
  await files.apply(copy, [w("src/App.vue", "changed in the copy")]);
  assert.deepEqual(await files.readAll(source), [{ path: "src/App.vue", content: "shared" }], "the source is unaffected");

  await assert.rejects(files.copy(source, foreign), /across accounts/);
});
