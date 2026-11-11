import { test } from "node:test";
import assert from "node:assert/strict";
import { call, connectHl, createApp, db, newUser, type TestUser } from "./helpers";

/**
 * HighLevel tokens at rest. The proxy decrypts them before its location check, so reaching
 * `connection_changed` (the stored location differs from the preview token's) proves decryption worked.
 */
async function previewUser(): Promise<{ u: TestUser; token: string }> {
  const u = await newUser();
  await connectHl(u, "loc-e2e", "loc-elsewhere");
  const app = await createApp(u);
  const token = (await call(u, "POST", `api/projects/${app}/preview-token`)).body.token as string;
  return { u, token };
}

const proxy = (token: string) => call({ uid: "", email: "", token }, "GET", "hlProxy/contacts/?limit=1");

test("stored tokens are sealed: no plain text in the document, and the proxy can still use them", async () => {
  const { u, token } = await previewUser();
  const raw = JSON.stringify((await db.doc(`hlTokens/${u.uid}`).get()).data());
  assert.ok(!raw.includes("e2e-access") && !raw.includes("e2e-refresh"), "no plain-text token in Firestore");
  assert.match(raw, /"sealed":\{/);
  const r = await proxy(token);
  assert.equal(r.body.error?.code, "connection_changed", "the proxy decrypted the token and got as far as the location check");
});

test("a legacy plain-text record is sealed in place on first use", async () => {
  const { u, token } = await previewUser();
  await db.doc(`hlTokens/${u.uid}`).set({
    accessToken: "legacy-access", refreshToken: "legacy-refresh", expiresAt: Date.now() + 3_600_000,
    locationId: "loc-elsewhere", scope: "",
  });
  assert.equal((await proxy(token)).body.error?.code, "connection_changed");
  const after = (await db.doc(`hlTokens/${u.uid}`).get()).data()!;
  assert.ok(after.sealed, "now sealed");
  assert.equal(after.accessToken, undefined);
  assert.equal(after.refreshToken, undefined);
});

test("a corrupted record fails closed with a clear error, without leaking anything", async () => {
  const { u, token } = await previewUser();
  const ref = db.doc(`hlTokens/${u.uid}`);
  const sealed = (await ref.get()).get("sealed");
  const tampered = Buffer.from(sealed.ciphertext, "base64");
  tampered[0] = tampered[0]! ^ 1;
  await ref.update({ "sealed.ciphertext": tampered.toString("base64") });
  const r = await proxy(token);
  assert.equal(r.status, 503);
  assert.equal(r.body.error?.code, "hl_tokens_unavailable");
});

test("a record moved to another user's document can't be used", async () => {
  const [a, b] = await Promise.all([previewUser(), previewUser()]);
  const stolen = (await db.doc(`hlTokens/${a.u.uid}`).get()).get("sealed");
  await db.doc(`hlTokens/${b.u.uid}`).update({ sealed: stolen });
  const r = await proxy(b.token);
  assert.equal(r.status, 503);
  assert.equal(r.body.error?.code, "hl_tokens_unavailable");
});
