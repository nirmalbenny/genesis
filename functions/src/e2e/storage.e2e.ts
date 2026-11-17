/**
 * Project files in Cloud Storage (FILE_STORE=blobs), through the API and the Storage emulator: content is stored
 * per user under users/{uid}/blobs/{sha256}, snapshots hold manifests, and no client can touch Storage directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, connectHl, createApp, db, FILE_STORE, newUser, STORAGE_HOST } from "./helpers";
import { contentHash } from "../files/describe";

const blobs = FILE_STORE === "blobs";
const STORAGE = `http://${STORAGE_HOST}`;

/** The emulator's bucket (the functions' default bucket), found from a stored object. */
async function bucketName(): Promise<string> {
  const res = await fetch(`${STORAGE}/storage/v1/b?project=any`);
  const { items = [] } = (await res.json()) as { items?: { name: string }[] };
  assert.equal(items.length, 1, `expected one bucket, got ${items.map((b) => b.name).join(", ")}`);
  return items[0]!.name;
}

test("files are stored as per-user blobs plus a manifest; snapshots keep only the manifest", { skip: !blobs && "FILE_STORE is not blobs" }, async () => {
  const u = await newUser();
  await connectHl(u);
  const id = await createApp(u);
  const content = `<template><p>stored ${Date.now()}</p></template>`;
  assert.equal((await call(u, "PUT", `api/projects/${id}/files`, { path: "src/App.vue", content })).status, 200);

  const project = (await db.doc(`projects/${id}`).get()).data()!;
  assert.equal(project.manifest["src/App.vue"].hash, contentHash(content));
  assert.ok(project.manifestVersion >= 2);
  assert.equal((await db.collection(`projects/${id}/files`).get()).size, 0, "no Firestore file documents");

  const bucket = await bucketName();
  const object = encodeURIComponent(`users/${u.uid}/blobs/${contentHash(content)}`);
  const stored = await fetch(`${STORAGE}/storage/v1/b/${bucket}/o/${object}?alt=media`);
  assert.equal(await stored.text(), content);

  const copy = await call(u, "POST", `api/projects/${id}/duplicate`, { name: "Copy", description: "A copy" });
  const snaps = (await call(u, "GET", `api/projects/${copy.body.id}/snapshots`)).body.snapshots as { id: string }[];
  const snap = (await db.doc(`projects/${copy.body.id}/snapshots/${snaps[0]!.id}`).get()).data()!;
  assert.equal(snap.manifest["src/App.vue"].hash, contentHash(content), "the copy's snapshot points at the same blob");
});

test("no client can read or write Storage, not even the owner of the content", { skip: !blobs && "FILE_STORE is not blobs" }, async () => {
  const [owner, other] = await Promise.all([newUser(), newUser()]);
  await connectHl(owner);
  await createApp(owner);
  const hash = (await db.collection("projects").where("ownerId", "==", owner.uid).get()).docs[0]!.get("manifest")["src/App.vue"].hash;
  const bucket = await bucketName();
  const object = encodeURIComponent(`users/${owner.uid}/blobs/${hash}`);
  // The Firebase client SDK's REST API, which enforces storage.rules (the Admin SDK and the GCS API bypass them).
  const asClient = (u: { token: string } | null, method: string, body?: string) =>
    fetch(method === "POST" ? `${STORAGE}/v0/b/${bucket}/o?name=${object}` : `${STORAGE}/v0/b/${bucket}/o/${object}${method === "GET" ? "?alt=media" : ""}`, {
      method,
      headers: { ...(u ? { Authorization: `Firebase ${u.token}` } : {}), "Content-Type": "text/plain" },
      body,
    }).then((r) => r.status);

  assert.equal(await asClient(owner, "GET"), 403);
  assert.equal(await asClient(other, "GET"), 403);
  assert.equal(await asClient(null, "GET"), 403);
  assert.equal(await asClient(owner, "POST", "overwritten"), 403);
  assert.equal(await asClient(owner, "DELETE"), 403);
});
