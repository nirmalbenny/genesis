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
  const del = await call({ uid: "", email: "", token }, "DELETE", "hlProxy/contacts/abc123");
  assert.equal(del.status, 405, "deletes are never allowed");
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

// ---- Writes ----

const write = (token: string, method: string, path: string, body: unknown) =>
  call({ uid: "", email: "", token }, method, `hlProxy${path}`, body);

test("the listed writes pass every check (and stop at the connection check, so HighLevel is never called)", async () => {
  const { token } = await previewSetup();
  for (const [method, path, body] of [
    ["POST", "/contacts/", { firstName: "Ada", email: "ada@example.com" }],
    ["PUT", "/contacts/c1", { firstName: "Ada" }],
    ["POST", "/contacts/c1/tags", { tags: ["vip"] }],
    ["POST", "/contacts/c1/notes", { body: "Called back" }],
    ["POST", "/calendars/events/appointments", { calendarId: "cal1", contactId: "c1", startTime: "2026-12-01T10:00:00Z" }],
    ["PUT", "/calendars/events/appointments/ev1", { appointmentStatus: "cancelled" }],
    ["PUT", "/conversations/conv1", { unreadCount: 0 }],
  ] as const) {
    const r = await write(token, method, path, body);
    assert.equal(r.body.error?.code, "connection_changed", `${method} ${path}`);
  }
});

test("unlisted writes, bad bodies and other message types are refused before anything else", async () => {
  const { token } = await previewSetup();
  assert.equal((await write(token, "POST", "/contacts/c1", {})).body.error?.code, "path_not_allowed");
  assert.equal((await write(token, "PUT", "/contacts/c1/notes/n1", {})).body.error?.code, "path_not_allowed");
  assert.equal((await write(token, "POST", "/contacts/", { note: "x".repeat(50_001) })).status, 413);
  const comment = await write(token, "POST", "/conversations/messages", { type: "InternalComment", contactId: "c1" });
  assert.equal(comment.status, 400);
  assert.equal(comment.body.error?.code, "invalid_message_type");
});

test("a connection made without write permission is told to reconnect, and HighLevel isn't called", async () => {
  const u = await newUser();
  await connectHl(u, "loc-e2e", "loc-e2e", "contacts.readonly calendars.readonly");
  const app = await createApp(u);
  const token = (await call(u, "POST", `api/projects/${app}/preview-token`)).body.token as string;
  const r = await write(token, "POST", "/contacts/", { firstName: "Ada" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error?.code, "hl_scope_missing");
});

test("writes are limited to bursts of 10, and message sends to bursts of 5", async () => {
  const { token } = await previewSetup();
  let writes = 0;
  for (let i = 0; i < 30; i++) {
    const r = await write(token, "PUT", "/contacts/c1", { firstName: `Ada ${i}` });
    if (r.status === 429) { assert.equal(r.body.error?.code, "rate_limited"); break; }
    writes++;
  }
  assert.ok(writes >= 10 && writes <= 14, `${writes} writes before the limit`);

  const other = await previewSetup();
  let sends = 0;
  for (let i = 0; i < 20; i++) {
    const r = await write(other.token, "POST", "/conversations/messages", { type: "Email", contactId: "c1", subject: "Hi", html: "Hi" });
    if (r.status === 429) { assert.match(r.body.error!.message, /messages/); break; }
    sends++;
  }
  assert.ok(sends >= 5 && sends <= 8, `${sends} sends before the limit`);
});

