/**
 * Moving projects from Firestore files to blobs + manifest: lazily on first access (through the API, with
 * FILE_STORE=blobs) and with the backfill script. Old Firestore file documents are never deleted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, connectHl, db, FILE_STORE, newUser, PROJECT, type TestUser } from "./helpers";
import { contentHash } from "../files/describe";
import { firestoreFileStore } from "../files/firestoreStore";
import { migrateAll } from "../scripts/migrate-files-to-storage";

const BUCKET = `${PROJECT}.firebasestorage.app`; // any name works on the emulator; the script always takes one

/** A project as the Firestore store left it: file documents and a snapshot with a files/ subcollection, no manifest. */
async function legacyProject(u: TestUser, files: Record<string, string>): Promise<{ pid: string; sid: string }> {
  const ref = db.collection("projects").doc();
  await ref.set({ ownerId: u.uid, name: "Legacy", description: "x", kind: "user", locationId: "loc-e2e", deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
  const snap = ref.collection("snapshots").doc();
  await snap.set({ generationId: null, reason: "generation", summary: "Legacy build", fileCount: Object.keys(files).length, createdAt: new Date(0) });
  for (const [path, content] of Object.entries(files)) {
    await ref.collection("files").doc(encodeURIComponent(path)).set({ path, content });
    await snap.collection("files").doc(encodeURIComponent(path)).set({ path, content });
  }
  return { pid: ref.id, sid: snap.id };
}

test("a project still in Firestore is converted on first access; concurrent first accesses agree", { skip: FILE_STORE !== "blobs" && "FILE_STORE is not blobs" }, async () => {
  const u = await newUser();
  await connectHl(u);
  const files = { "src/App.vue": "<template>legacy</template>", "src/main.js": "main" };
  const { pid, sid } = await legacyProject(u, files);

  const [a, b] = await Promise.all([call(u, "GET", `api/projects/${pid}/files?content=true`), call(u, "GET", `api/projects/${pid}/files?content=true`)]);
  for (const r of [a, b]) assert.deepEqual(r.body.files, [{ path: "src/App.vue", content: files["src/App.vue"] }, { path: "src/main.js", content: "main" }]);
  const doc = (await db.doc(`projects/${pid}`).get()).data()!;
  assert.equal(doc.manifest["src/App.vue"].hash, contentHash(files["src/App.vue"]));
  assert.equal(doc.manifestVersion, 1, "converted once");
  assert.equal((await db.collection(`projects/${pid}/files`).get()).size, 2, "the Firestore copies are kept");

  // The old snapshot is converted when it's restored.
  await call(u, "PUT", `api/projects/${pid}/files`, { path: "src/App.vue", content: "<template>edited</template>" });
  assert.equal((await call(u, "POST", `api/projects/${pid}/snapshots/${sid}/restore`)).status, 200);
  assert.equal((await call(u, "GET", `api/projects/${pid}/file?path=src/App.vue`)).body.content, files["src/App.vue"]);
});

test("a change made with the Firestore store drops a manifest that would be stale", async () => {
  const u = await newUser();
  const { pid } = await legacyProject(u, { "src/App.vue": "v1" });
  await db.doc(`projects/${pid}`).update({ manifest: { "src/App.vue": { hash: contentHash("v1") } }, manifestVersion: 3 });
  await firestoreFileStore.apply(pid, [{ type: "write", path: "src/App.vue", content: "v2" }]);
  const doc = (await db.doc(`projects/${pid}`).get()).data()!;
  assert.equal(doc.manifest, undefined, "next blobs access converts again, from v2");
  assert.equal(doc.manifestVersion, 4, "versions only go up");
});

test("the backfill: dry run changes nothing, a real run converts and verifies, a re-run skips", async () => {
  const u = await newUser();
  const one = await legacyProject(u, { "src/App.vue": "one", "src/main.js": "main" });
  const two = await legacyProject(u, { "src/App.vue": "two", "src/utils.js": "main" });
  const projectIds = [one.pid, two.pid];
  const quiet = () => {};

  const dry = await migrateAll({ bucket: BUCKET, dryRun: true, projectIds, log: quiet });
  assert.deepEqual({ ...dry, failures: dry.failures.length }, { projects: 2, migrated: 2, skipped: 0, snapshots: 2, files: 4, bytes: 14, failures: 0 });
  assert.equal((await db.doc(`projects/${one.pid}`).get()).get("manifest"), undefined, "a dry run writes nothing");

  const real = await migrateAll({ bucket: BUCKET, dryRun: false, projectIds, log: quiet });
  assert.deepEqual(real.failures, []);
  assert.equal(real.migrated, 2);
  for (const { pid, sid } of [one, two]) {
    assert.ok((await db.doc(`projects/${pid}`).get()).get("manifest"));
    assert.ok((await db.doc(`projects/${pid}/snapshots/${sid}`).get()).get("manifest"));
    assert.equal((await db.collection(`projects/${pid}/files`).get()).size, 2, "Firestore files are kept");
  }

  const again = await migrateAll({ bucket: BUCKET, dryRun: false, projectIds, log: quiet });
  assert.equal(again.skipped, 2, "resumable: done projects are skipped");
});
