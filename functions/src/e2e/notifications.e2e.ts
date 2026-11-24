/**
 * Build notifications: users/{uid}/notifications is readable only by its owner and written only by Cloud Functions;
 * the API marks them read. Notifications are seeded with the Admin SDK (no build runs here).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { call, db, newUser, PROJECT, type TestUser } from "./helpers";

const DOCS = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;

async function asUser(u: TestUser, method: string, path: string, body?: unknown): Promise<number> {
  const res = await fetch(`${DOCS}${path}`, {
    method,
    headers: { Authorization: `Bearer ${u.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await res.text();
  return res.status;
}

const seed = (u: TestUser, id: string) => db.doc(`users/${u.uid}/notifications/${id}`).set({
  kind: "build_done", title: "App is updated", body: "", href: "/p/x", projectId: "x", generationId: "g", read: false, createdAt: new Date(),
});
const isRead = async (u: TestUser, id: string) => (await db.doc(`users/${u.uid}/notifications/${id}`).get()).get("read");

test("only the owner can read their notifications, and no client can write them", async () => {
  const [owner, other] = await Promise.all([newUser(), newUser()]);
  await seed(owner, "n1");
  assert.equal(await asUser(owner, "GET", `/users/${owner.uid}/notifications/n1`), 200);
  assert.equal(await asUser(other, "GET", `/users/${owner.uid}/notifications/n1`), 403);
  assert.equal(await asUser(owner, "PATCH", `/users/${owner.uid}/notifications/n1`, { fields: { read: { booleanValue: true } } }), 403);
});

test("notifications are marked read through the API: by id, or all at once; never someone else's", async () => {
  const [owner, other] = await Promise.all([newUser(), newUser()]);
  await Promise.all(["a", "b", "c"].map((id) => seed(owner, id)));
  await seed(other, "a");

  const one = await call(owner, "POST", "api/notifications/read", { ids: ["a", "missing"] });
  assert.equal(one.status, 200);
  assert.equal(one.body.marked, 1);
  assert.deepEqual([await isRead(owner, "a"), await isRead(owner, "b")], [true, false]);
  assert.equal(await isRead(other, "a"), false, "ids are always the caller's own");

  const all = await call(owner, "POST", "api/notifications/read", {});
  assert.equal(all.body.marked, 2);
  assert.deepEqual([await isRead(owner, "b"), await isRead(owner, "c")], [true, true]);
});

test("only the owner can read their build history, and no client can write it", async () => {
  const [owner, other] = await Promise.all([newUser(), newUser()]);
  await db.doc(`users/${owner.uid}/builds/g1`).set({ projectId: "p", mode: "single", appName: "App", request: "r", outcome: "updated", href: "/p/p", endedAt: new Date() });
  assert.equal(await asUser(owner, "GET", `/users/${owner.uid}/builds/g1`), 200);
  assert.equal(await asUser(other, "GET", `/users/${owner.uid}/builds/g1`), 403);
  assert.equal(await asUser(owner, "PATCH", `/users/${owner.uid}/builds/g1`, { fields: { outcome: { stringValue: "saved" } } }), 403);
});
