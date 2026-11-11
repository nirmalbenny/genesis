/**
 * Firestore security rules, checked as real signed-in users: the Firestore emulator enforces the rules for
 * REST requests that carry a user's ID token (the Admin SDK used for seeding bypasses them).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectHl, createApp, db, newUser, PROJECT, type TestUser } from "./helpers";

const DOCS = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;

/** Firestore REST as a client would call it; returns the HTTP status (200 allowed, 403 denied by rules). */
async function asUser(u: TestUser | null, method: string, path: string, body?: unknown): Promise<number> {
  const res = await fetch(`${DOCS}${path}`, {
    method,
    headers: { ...(u ? { Authorization: `Bearer ${u.token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await res.text();
  return res.status;
}

const query = (u: TestUser, where?: { field: string; value: string }) =>
  asUser(u, "POST", ":runQuery", {
    structuredQuery: {
      from: [{ collectionId: "projects" }],
      ...(where ? { where: { fieldFilter: { field: { fieldPath: where.field }, op: "EQUAL", value: { stringValue: where.value } } } } : {}),
    },
  });

async function setup() {
  const [owner, other] = await Promise.all([newUser(), newUser()]);
  await connectHl(owner);
  const app = await createApp(owner);
  await db.doc(`users/${owner.uid}/creditLedger/signup`).set({ type: "grant", credits: 2500 });
  await db.doc(`oauthStates/e2e-${owner.uid}`).set({ uid: owner.uid });
  return { owner, other, app };
}

test("users read only their own user document and credit ledger", async () => {
  const { owner, other } = await setup();
  assert.equal(await asUser(owner, "GET", `/users/${owner.uid}`), 200);
  assert.equal(await asUser(other, "GET", `/users/${owner.uid}`), 403);
  assert.equal(await asUser(null, "GET", `/users/${owner.uid}`), 403);
  assert.equal(await asUser(owner, "GET", `/users/${owner.uid}/creditLedger/signup`), 200);
  assert.equal(await asUser(other, "GET", `/users/${owner.uid}/creditLedger/signup`), 403);
});

test("HighLevel tokens and OAuth states are never readable by clients, not even their owner", async () => {
  const { owner } = await setup();
  assert.equal(await asUser(owner, "GET", `/hlTokens/${owner.uid}`), 403);
  assert.equal(await asUser(owner, "GET", `/oauthStates/e2e-${owner.uid}`), 403);
});

test("apps and their files are readable by their owner only", async () => {
  const { owner, other, app } = await setup();
  assert.equal(await asUser(owner, "GET", `/projects/${app}`), 200);
  assert.equal(await asUser(other, "GET", `/projects/${app}`), 403);
  assert.equal(await asUser(null, "GET", `/projects/${app}`), 403);
  assert.equal(await asUser(owner, "GET", `/projects/${app}/files/${encodeURIComponent("src%2FApp.vue")}`), 200);
  assert.equal(await asUser(other, "GET", `/projects/${app}/files/${encodeURIComponent("src%2FApp.vue")}`), 403);
});

test("listing apps works only when filtered to the caller's own", async () => {
  const { owner, other } = await setup();
  assert.equal(await query(owner, { field: "ownerId", value: owner.uid }), 200);
  assert.equal(await query(other, { field: "ownerId", value: owner.uid }), 403);
  assert.equal(await query(owner), 403, "an unfiltered list could include other users' apps");
});

test("clients can't write anything: every change goes through Cloud Functions", async () => {
  const { owner, app } = await setup();
  const fields = { fields: { name: { stringValue: "hacked" } } };
  assert.equal(await asUser(owner, "PATCH", `/projects/${app}?updateMask.fieldPaths=name`, fields), 403);
  assert.equal(await asUser(owner, "POST", `/projects`, { fields: { ownerId: { stringValue: owner.uid } } }), 403);
  assert.equal(await asUser(owner, "PATCH", `/projects/${app}/files/x`, { fields: { content: { stringValue: "x" } } }), 403);
  assert.equal(await asUser(owner, "PATCH", `/users/${owner.uid}?updateMask.fieldPaths=credits`, {
    fields: { credits: { mapValue: { fields: { balance: { integerValue: "999999" } } } } },
  }), 403, "nobody can top up their own credits");
  assert.equal(await asUser(owner, "DELETE", `/projects/${app}`), 403);
  assert.equal((await db.doc(`projects/${app}`).get()).get("name"), "E2E app");
});
