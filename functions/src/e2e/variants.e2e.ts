/**
 * Variant builds (docs/plans/build-variants.md) through the API, without Claude: a draft with two versions is seeded
 * with the Admin SDK (each version a snapshot of the app's manifest), then previewed and saved as the customer would.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { call, connectHl, createApp, db, FILE_STORE, newUser, VARIANTS, type TestUser } from "./helpers";

const blobs = FILE_STORE === "blobs";
const A = "<template><p>Version A</p></template>\n";
const B = "<template><p>Version B</p></template>\n";

/** A draft whose generation is ready with two finalists: A (applied) and B. Returns the ids. */
async function seedDraft(u: TestUser) {
  const pid = await createApp(u);
  const project = db.doc(`projects/${pid}`);
  const snapshotOf = async (content: string, title: string) => {
    assert.equal((await call(u, "PUT", `api/projects/${pid}/files`, { path: "src/App.vue", content })).status, 200);
    const ref = await project.collection("snapshots").add({
      generationId: "g", reason: "variant", summary: title, createdAt: FieldValue.serverTimestamp(), fileCount: 2,
      manifest: (await project.get()).get("manifest"),
    });
    return ref.id;
  };
  const b = await snapshotOf(B, "Board");
  const a = await snapshotOf(A, "Agenda"); // applied: the app's files are A
  const gen = project.collection("generations").doc();
  await gen.set({
    mode: "variants", status: "ready", prompt: "a contact dashboard", snapshotId: a, files: ["src/App.vue"], credits: 50,
    finalists: [
      { snapshotId: a, title: "Agenda", summary: "Today first.", style: "Light", plan: "An agenda.", files: ["src/App.vue"], credits: 50 },
      { snapshotId: b, title: "Board", summary: "By stage.", style: "Dark", plan: "A board.", files: ["src/App.vue"], credits: 70 },
    ],
    createdAt: FieldValue.serverTimestamp(),
  });
  await project.update({ draft: { generationId: gen.id, expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000) } });
  // The job charged the applied version (50); the customer has 1,000 left.
  await db.doc(`users/${u.uid}`).set({ credits: { balance: 1000, reserved: 0, granted: 1050, used: 50 } }, { merge: true });
  await db.doc(`users/${u.uid}/builds/${gen.id}`).set({
    projectId: pid, mode: "variants", appName: "Contact dashboard", request: "a contact dashboard", outcome: "ready",
    href: `/choose/${pid}`, versions: ["Agenda", "Board"], endedAt: new Date(),
  });
  return { pid, a, b, gid: gen.id };
}

test("variant builds are refused while VARIANTS is off", { skip: VARIANTS === "on" && "VARIANTS is on" }, async () => {
  const u = await newUser();
  await connectHl(u);
  const r = await call(u, "POST", "api/variants", { prompt: "a contact dashboard" });
  assert.equal(r.status, 404);
  assert.equal(r.body.error?.code, "variants_off");
});

test("a version can be previewed, then saved as the app", { skip: !blobs && "FILE_STORE is not blobs" }, async () => {
  const u = await newUser();
  await connectHl(u);
  const { pid, b, gid } = await seedDraft(u);

  const preview = await call(u, "GET", `api/projects/${pid}/snapshots/${b}/files`);
  assert.equal(preview.status, 200);
  assert.equal((preview.body.files as { path: string; content: string }[]).find((f) => f.path === "src/App.vue")?.content, B);

  const saved = await call(u, "POST", `api/projects/${pid}/save`, { snapshotId: b, name: "Pipeline", description: "Deals by stage", category: "sales" });
  assert.equal(saved.status, 200);
  const project = (await db.doc(`projects/${pid}`).get()).data()!;
  assert.equal(project.draft, undefined, "no longer a draft");
  assert.equal(project.name, "Pipeline");
  const files = (await call(u, "GET", `api/projects/${pid}/files?content=true`)).body.files as { path: string; content: string }[];
  assert.equal(files.find((f) => f.path === "src/App.vue")?.content, B, "the chosen version's files");
  const messages = await db.collection(`projects/${pid}/messages`).orderBy("createdAt").get();
  assert.deepEqual(messages.docs.map((d) => d.get("role")), ["user", "assistant"]);
  assert.equal((await db.doc(`projects/${pid}/generations/${gid}`).get()).get("snapshotId"), b);

  const history = (await db.doc(`users/${u.uid}/builds/${gid}`).get()).data()!;
  assert.deepEqual([history.outcome, history.appName, history.href, history.versions], ["saved", "Pipeline", `/p/${pid}`, ["Board"]]);

  // Keeping Board (70) instead of the applied Agenda (50) costs the difference, once.
  assert.equal(history.credits, 70);
  assert.equal((await db.doc(`users/${u.uid}/creditLedger/${gid}-adjust`).get()).get("credits"), 20);
  const credits = (await db.doc(`users/${u.uid}`).get()).get("credits");
  assert.deepEqual([credits.balance, credits.used], [980, 70]);

  const again = await call(u, "POST", `api/projects/${pid}/save`, { snapshotId: b, name: "x", description: "y" });
  assert.equal(again.status, 409, "a saved app has no versions left to save");
});

test("only the owner can preview or save a version, and only a finalist can be saved", { skip: !blobs && "FILE_STORE is not blobs" }, async () => {
  const [owner, other] = await Promise.all([newUser(), newUser()]);
  await connectHl(owner);
  const { pid, b } = await seedDraft(owner);
  assert.equal((await call(other, "GET", `api/projects/${pid}/snapshots/${b}/files`)).status, 404);
  assert.equal((await call(other, "POST", `api/projects/${pid}/save`, { snapshotId: b, name: "x", description: "y" })).status, 404);
  assert.equal((await call(owner, "POST", `api/projects/${pid}/save`, { snapshotId: "nope", name: "x", description: "y" })).status, 409);
  assert.equal((await call(owner, "GET", `api/projects/${pid}/snapshots/nope/files`)).status, 404);
});

test("a draft nobody saved expires: it is deleted and its build is marked expired", async () => {
  const u = await newUser();
  await connectHl(u);
  const pid = await createApp(u);
  const gid = "expiring";
  await db.doc(`projects/${pid}`).update({ draft: { generationId: gid, expiresAt: Timestamp.fromMillis(Date.now() - 1000) } });
  await db.doc(`users/${u.uid}/builds/${gid}`).set({ projectId: pid, mode: "variants", appName: "Old", request: "r", outcome: "ready", href: `/choose/${pid}`, endedAt: new Date() });
  const { expireDrafts } = await import("../projects");
  assert.ok((await expireDrafts()) >= 1);
  assert.ok((await db.doc(`projects/${pid}`).get()).get("deletedAt"), "soft-deleted");
  assert.equal((await db.doc(`users/${u.uid}/builds/${gid}`).get()).get("outcome"), "expired");
});

test("keeping the version already applied costs nothing more", { skip: !blobs && "FILE_STORE is not blobs" }, async () => {
  const u = await newUser();
  await connectHl(u);
  const { pid, a, gid } = await seedDraft(u);
  assert.equal((await call(u, "POST", `api/projects/${pid}/save`, { snapshotId: a, name: "Agenda", description: "Today first" })).status, 200);
  assert.equal((await db.doc(`users/${u.uid}/creditLedger/${gid}-adjust`).get()).exists, false);
  assert.equal((await db.doc(`users/${u.uid}`).get()).get("credits.balance"), 1000);
});
