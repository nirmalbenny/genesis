/**
 * The cleanup of unreferenced file content, against the Storage emulator. Scoped to fresh users, so it never
 * touches other tests' data; "now" is moved forward to age the blobs past the grace period.
 * The emulator ignores ifGenerationMatch, customTime and ifMetagenerationMatch, so the race protection is unit
 * tested with a fake file (files/cleanup.test.ts) and relies on Cloud Storage's documented preconditions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, newUser, PROJECT, STORAGE_HOST } from "./helpers";
import { blobPath, createStorageBlobStore } from "../files/blobStore";
import { cleanupBlobs, GRACE_DAYS } from "../files/cleanup";
import { entryFor } from "../files/manifestStore";

const BUCKET = `${PROJECT}.firebasestorage.app`;
const later = (days: number) => Date.now() + days * 86_400_000;
const exists = async (uid: string, hash: string) =>
  (await fetch(`http://${STORAGE_HOST}/storage/v1/b/${BUCKET}/o/${encodeURIComponent(blobPath(uid, hash))}`)).ok;

test("deletes only blobs that no manifest references and that are older than the grace period; dry run deletes nothing", async () => {
  const { uid } = await newUser();
  const blobs = createStorageBlobStore({ bucket: BUCKET });
  const [current, inSnapshot, orphan] = await Promise.all(["current", "in snapshot", "orphan"].map((c) => blobs.put(uid, c)));
  const project = db.collection("projects").doc();
  await project.set({ ownerId: uid, manifest: { "src/App.vue": entryFor("src/App.vue", "current") } });
  await project.collection("snapshots").doc().set({ manifest: { "src/App.vue": entryFor("src/App.vue", "in snapshot") } });
  const quiet = () => {};

  const young = await cleanupBlobs({ dryRun: false, uids: [uid], bucket: BUCKET, log: quiet });
  assert.deepEqual({ ...young, dryRun: undefined }, { scanned: 3, referenced: 2, young: 1, deleted: 0, skippedChanged: 0, dryRun: undefined });

  const dry = await cleanupBlobs({ dryRun: true, now: later(GRACE_DAYS + 1), uids: [uid], bucket: BUCKET, log: quiet });
  assert.equal(dry.deleted, 1, "would delete the orphan");
  assert.ok(await exists(uid, orphan), "but a dry run deletes nothing");

  const real = await cleanupBlobs({ dryRun: false, now: later(GRACE_DAYS + 1), uids: [uid], bucket: BUCKET, log: quiet });
  assert.equal(real.deleted, 1);
  assert.equal(await exists(uid, orphan), false);
  assert.ok(await exists(uid, current) && await exists(uid, inSnapshot), "referenced content is kept");
});

