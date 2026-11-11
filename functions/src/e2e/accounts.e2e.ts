import { test } from "node:test";
import assert from "node:assert/strict";
import { call, connectHl, createApp, db, newUser } from "./helpers";

test("an unverified account can't use any endpoint", async () => {
  const u = await newUser({ verified: false });
  for (const [method, route] of [["POST", "api/bootstrap"], ["POST", "api/projects"], ["POST", "generate"], ["GET", "hlAuthStart"]]) {
    const r = await call(u, method!, route!, method === "POST" ? {} : undefined);
    assert.equal(r.status, 403, route);
    assert.equal(r.body.error?.code, "email_not_verified", route);
  }
});

test("requests without a valid token are rejected", async () => {
  assert.equal((await call(null, "GET", "api/projects/x")).status, 401);
  assert.equal((await call({ uid: "x", email: "x", token: "not-a-token" }, "GET", "api/projects/x")).status, 401);
});

test("bootstrap seeds six locked ready-made apps and grants the signup credits once", async () => {
  const u = await newUser();
  const [a, b] = await Promise.all([call(u, "POST", "api/bootstrap"), call(u, "POST", "api/bootstrap")]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal([a.body.creditsGranted, b.body.creditsGranted].filter(Boolean).length, 1, "granted exactly once");

  const user = (await db.doc(`users/${u.uid}`).get()).data()!;
  assert.equal(user.credits.balance, 2500);
  const ledger = await db.collection(`users/${u.uid}/creditLedger`).get();
  assert.deepEqual(ledger.docs.map((d) => d.id), ["signup"]);

  const apps = await db.collection("projects").where("ownerId", "==", u.uid).get();
  assert.equal(apps.size, 6);
  assert.ok(apps.docs.every((d) => d.get("kind") === "prebuilt"));

  const locked = await call(u, "PUT", `api/projects/${apps.docs[0]!.id}/files`, { path: "src/App.vue", content: "x" });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error?.code, "app_locked");
});

test("project lifecycle: create, read, rename, save a file, soft delete", async () => {
  const u = await newUser();
  assert.equal((await call(u, "POST", "api/projects", { name: "x", description: "y" })).body.error?.code, "hl_not_connected");
  await connectHl(u);
  const id = await createApp(u);

  const got = await call(u, "GET", `api/projects/${id}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.ownerId, u.uid);
  assert.equal(got.body.locationId, "loc-e2e");

  assert.equal((await call(u, "PATCH", `api/projects/${id}`, { name: "Renamed" })).status, 200);
  assert.equal((await call(u, "GET", `api/projects/${id}`)).body.name, "Renamed");

  const content = "<template><p>saved</p></template>";
  assert.equal((await call(u, "PUT", `api/projects/${id}/files`, { path: "src/App.vue", content })).status, 200);
  const file = await call(u, "GET", `api/projects/${id}/file?path=src/App.vue`);
  assert.equal(file.body.content, content);
  const list = await call(u, "GET", `api/projects/${id}/files`);
  assert.ok((list.body.files as { path: string }[]).some((f) => f.path === "src/App.vue"));

  const bad = await call(u, "PUT", `api/projects/${id}/files`, { path: "../escape.js", content: "x" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error?.code, "invalid_path");

  assert.equal((await call(u, "DELETE", `api/projects/${id}`)).status, 200);
  assert.equal((await call(u, "GET", `api/projects/${id}`)).status, 404, "a soft-deleted app is gone for the API");
  assert.ok((await db.doc(`projects/${id}`).get()).get("deletedAt"), "but the document is kept");
});

test("users can't reach each other's apps", async () => {
  const [owner, other] = await Promise.all([newUser(), newUser()]);
  await Promise.all([connectHl(owner), connectHl(other)]);
  const id = await createApp(owner);
  for (const [method, route, body] of [
    ["GET", `api/projects/${id}`, undefined],
    ["GET", `api/projects/${id}/files`, undefined],
    ["PATCH", `api/projects/${id}`, { name: "hijack" }],
    ["PUT", `api/projects/${id}/files`, { path: "src/App.vue", content: "x" }],
    ["DELETE", `api/projects/${id}`, undefined],
    ["POST", `api/projects/${id}/preview-token`, undefined],
  ] as const) {
    assert.equal((await call(other, method, route, body)).status, 404, `${method} ${route}`);
  }
  assert.equal((await db.doc(`projects/${id}`).get()).get("name"), "E2E app");
});

test("copying an app creates a snapshot that can be restored", async () => {
  const u = await newUser();
  await connectHl(u);
  const source = await createApp(u, "Source");
  const copy = await call(u, "POST", `api/projects/${source}/duplicate`, { name: "Copy", description: "A copy" });
  assert.equal(copy.status, 200);
  const id = copy.body.id as string;

  const snaps = await call(u, "GET", `api/projects/${id}/snapshots`);
  const [first] = snaps.body.snapshots as { id: string; reason: string }[];
  assert.equal(first?.reason, "copy");

  const original = (await call(u, "GET", `api/projects/${id}/file?path=src/App.vue`)).body.content;
  await call(u, "PUT", `api/projects/${id}/files`, { path: "src/App.vue", content: "<template>edited</template>" });
  const restored = await call(u, "POST", `api/projects/${id}/snapshots/${first!.id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal((await call(u, "GET", `api/projects/${id}/file?path=src/App.vue`)).body.content, original);
  const after = (await call(u, "GET", `api/projects/${id}/snapshots`)).body.snapshots as { reason: string }[];
  assert.equal(after[0]?.reason, "restore", "restoring records a new snapshot (non-destructive)");
});
