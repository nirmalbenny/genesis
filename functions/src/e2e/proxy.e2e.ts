import { test } from "node:test";
import assert from "node:assert/strict";
import { call, connectHl, createApp, newUser, type TestUser } from "./helpers";

/**
 * The stored HighLevel token belongs to a different location than the preview token, so every request that
 * passes the proxy's own checks stops at `connection_changed`: these tests never reach HighLevel.
 */
async function previewSetup(): Promise<{ u: TestUser; app: string; token: string }> {
  const u = await newUser();
  await connectHl(u, "loc-e2e", "loc-elsewhere");
  const app = await createApp(u);
  const r = await call(u, "POST", `api/projects/${app}/preview-token`);
  assert.equal(r.status, 200);
  return { u, app, token: r.body.token as string };
}

const proxy = (token: string, path: string) => call({ uid: "", email: "", token }, "GET", `hlProxy${path}`);

test("the proxy rejects missing and forged preview tokens", async () => {
  const { token } = await previewSetup();
  assert.equal((await call(null, "GET", "hlProxy/contacts/")).status, 401);
  const [body, sig] = token.split(".");
  const claims = JSON.parse(Buffer.from(body!, "base64url").toString());
  const forged = Buffer.from(JSON.stringify({ ...claims, uid: "someone-else" })).toString("base64url");
  const r = await proxy(`${forged}.${sig}`, "/contacts/");
  assert.equal(r.status, 401);
  assert.equal(r.body.error?.code, "invalid_preview_token");
});

test("the proxy only allows its GET allowlist", async () => {
  const { token } = await previewSetup();
  for (const path of ["/users/", "/locations/abc", "/contacts/abc/notes", "/opportunities/search"]) {
    const r = await proxy(token, path);
    assert.equal(r.status, 403, path);
    assert.equal(r.body.error?.code, "path_not_allowed", path);
  }
  const post = await call({ uid: "", email: "", token }, "POST", "hlProxy/contacts/", {});
  assert.equal(post.status, 405);
});

test("a preview token stops working once its app is deleted", async () => {
  const { u, app, token } = await previewSetup();
  await call(u, "DELETE", `api/projects/${app}`);
  const r = await proxy(token, "/contacts/");
  assert.equal(r.status, 403);
  assert.equal(r.body.error?.code, "project_not_allowed");
  assert.equal((await call(u, "POST", `api/projects/${app}/preview-token`)).status, 404, "and no new token is issued");
});

test("nobody can get a preview token for someone else's app", async () => {
  const owner = await newUser();
  await connectHl(owner);
  const app = await createApp(owner);
  const other = await newUser();
  await connectHl(other);
  assert.equal((await call(other, "POST", `api/projects/${app}/preview-token`)).status, 404);
});

test("a changed HighLevel connection is reported, not served", async () => {
  const { token } = await previewSetup();
  const r = await proxy(token, "/contacts/?limit=5");
  assert.equal(r.status, 409);
  assert.equal(r.body.error?.code, "connection_changed");
});

test("the proxy limits each user to bursts of 40 requests", async () => {
  const { token } = await previewSetup();
  const codes: string[] = [];
  let limited: Awaited<ReturnType<typeof proxy>> | null = null;
  for (let i = 0; i < 400 && !limited; i++) {
    const r = await proxy(token, `/contacts/?limit=${(i % 50) + 1}`);
    codes.push(r.body.error?.code ?? String(r.status));
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, "never limited");
  assert.ok(codes.filter((c) => c === "connection_changed").length >= 40, "the burst passes the limiter");
  assert.equal(limited.body.error?.code, "rate_limited");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
});
