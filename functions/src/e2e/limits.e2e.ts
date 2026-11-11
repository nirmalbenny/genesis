import { test } from "node:test";
import assert from "node:assert/strict";
import { call, connectHl, createApp, db, newUser, type TestUser } from "./helpers";

/** A verified, connected user with credits and one app. */
async function builder(): Promise<{ u: TestUser; app: string }> {
  const u = await newUser();
  await connectHl(u);
  await db.doc(`users/${u.uid}`).set({ credits: { balance: 2500, reserved: 0, granted: 2500, used: 0 } }, { merge: true });
  return { u, app: await createApp(u) };
}

const build = (u: TestUser, projectId: string) => call(u, "POST", "generate", { projectId, prompt: "Build a contact list" });

/** Refused before any token count, credit hold or Claude call: nothing reserved, no slot or start recorded. */
async function assertNothingHeld(u: TestUser, slots: number, starts: number) {
  const d = (await db.doc(`users/${u.uid}`).get()).data()!;
  assert.equal(d.credits.reserved, 0);
  assert.equal(Object.keys(d.activeBuilds ?? {}).length, slots);
  assert.equal((d.buildStarts ?? []).length, starts);
}

test("a second build on the same app is refused while one runs", async () => {
  const { u, app } = await builder();
  await db.doc(`users/${u.uid}`).set({ activeBuilds: { running: { projectId: app, startedAt: Date.now() } } }, { merge: true });
  const r = await build(u, app);
  assert.equal(r.status, 429);
  assert.equal(r.body.error?.code, "rate_limited");
  assert.match(r.body.error!.message, /already running for this app/);
  assert.equal(r.headers.get("retry-after"), "30");
  await assertNothingHeld(u, 1, 0);
});

test("a third concurrent build is refused", async () => {
  const { u, app } = await builder();
  const now = Date.now();
  await db.doc(`users/${u.uid}`).set({
    activeBuilds: { a: { projectId: "other-1", startedAt: now }, b: { projectId: "other-2", startedAt: now } },
  }, { merge: true });
  const r = await build(u, app);
  assert.equal(r.status, 429);
  assert.match(r.body.error!.message, /2 builds at a time/);
  await assertNothingHeld(u, 2, 0);
});

test("the 11th build start in 10 minutes is refused with the exact wait", async () => {
  const { u, app } = await builder();
  const oldest = Date.now() - 9.5 * 60_000; // leaves the window in 30 s
  await db.doc(`users/${u.uid}`).set({ buildStarts: Array.from({ length: 10 }, (_, i) => oldest + i * 1000) }, { merge: true });
  const r = await build(u, app);
  assert.equal(r.status, 429);
  assert.match(r.body.error!.message, /10 builds in 10 minutes/);
  const wait = Number(r.headers.get("retry-after"));
  assert.ok(wait >= 28 && wait <= 31, `Retry-After ${wait}`);
  assert.equal(r.body.error?.retryAfter, wait);
  await assertNothingHeld(u, 0, 10);
});

test("a build is refused when HighLevel isn't connected, before any limit or hold", async () => {
  const { u, app } = await builder();
  await db.doc(`users/${u.uid}`).update({ hl: null });
  const r = await build(u, app);
  assert.equal(r.status, 409);
  assert.equal(r.body.error?.code, "hl_not_connected");
  await assertNothingHeld(u, 0, 0);
});

test("ready-made apps can't be built on", async () => {
  const u = await newUser();
  await connectHl(u);
  await call(u, "POST", "api/bootstrap");
  const prebuilt = (await db.collection("projects").where("ownerId", "==", u.uid).limit(1).get()).docs[0]!.id;
  const r = await build(u, prebuilt);
  assert.equal(r.status, 409);
  assert.equal(r.body.error?.code, "app_locked");
});

test("stopping a build: unknown builds are 404, finished ones aren't stopped", async () => {
  const { u, app } = await builder();
  assert.equal((await call(u, "POST", `api/projects/${app}/generations/nope/cancel`)).status, 404);
  await db.doc(`projects/${app}/generations/done1`).set({ status: "done" });
  const done = await call(u, "POST", `api/projects/${app}/generations/done1/cancel`);
  assert.deepEqual(done.body, { requested: false });
  await db.doc(`projects/${app}/generations/run1`).set({ status: "streaming" });
  const running = await call(u, "POST", `api/projects/${app}/generations/run1/cancel`);
  assert.deepEqual(running.body, { requested: true });
  assert.equal((await db.doc(`projects/${app}/generations/run1`).get()).get("cancelRequested"), true);
});

test("api changes are limited per user (bursts of 20, refilling 1/s), with Retry-After", async () => {
  const { u, app } = await builder();
  // The cheapest change: stopping a build that doesn't exist (404). It still counts against the write budget.
  const start = Date.now();
  let allowed = 0;
  let limited: Awaited<ReturnType<typeof call>> | null = null;
  for (let i = 0; i < 200 && !limited; i++) {
    const r = await call(u, "POST", `api/projects/${app}/generations/none/cancel`);
    if (r.status === 429) limited = r;
    else allowed++;
  }
  const seconds = (Date.now() - start) / 1000;
  assert.ok(limited, `never limited after ${allowed} requests in ${seconds.toFixed(1)} s`);
  // The burst of 20 (createApp used one), plus whatever refilled at 1/s while the requests ran.
  assert.ok(allowed >= 19 && allowed <= 21 + seconds, `${allowed} allowed in ${seconds.toFixed(1)} s`);
  assert.equal(limited.body.error?.code, "rate_limited");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  // Reads have their own, larger budget, so the user can still load their app.
  assert.equal((await call(u, "GET", `api/projects/${app}`)).status, 200);
});
