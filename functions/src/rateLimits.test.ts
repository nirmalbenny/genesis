import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILD_SLOT_TTL_MS, createLimiter, decideBuildStart, type BuildState } from "./rateLimits";

test("token bucket allows a burst, then refills at its rate", () => {
  let now = 0;
  const limiter = createLimiter({ perSecond: 2, burst: 3 }, () => now);
  assert.deepEqual([1, 2, 3].map(() => limiter.take("u")), [0, 0, 0]); // the burst
  assert.equal(limiter.take("u"), 0.5); // empty: one token in 0.5 s
  now = 500;
  assert.equal(limiter.take("u"), 0); // refilled one token
  assert.equal(limiter.take("other"), 0); // keys are independent
  now = 60_000;
  assert.deepEqual([1, 2, 3].map(() => limiter.take("u")), [0, 0, 0]); // refills only up to the burst
  assert.ok(limiter.take("u") > 0);
});

const empty: BuildState = { activeBuilds: {}, buildStarts: [] };

function start(state: BuildState, projectId: string, id: string, now: number) {
  const d = decideBuildStart(state, projectId, id, now);
  return d.ok ? d.next : d;
}

test("one build per app and two per user at a time", () => {
  const s1 = start(empty, "p1", "g1", 0) as BuildState;
  const sameApp = decideBuildStart(s1, "p1", "g2", 1000);
  assert.equal(sameApp.ok, false);
  const s2 = start(s1, "p2", "g2", 1000) as BuildState;
  const third = decideBuildStart(s2, "p3", "g3", 2000);
  assert.ok(!third.ok && /2 builds at a time/.test(third.message));
  // A finished build frees its slot (settleCredits deletes it).
  const { g1: _done, ...rest } = s2.activeBuilds;
  assert.equal(decideBuildStart({ ...s2, activeBuilds: rest }, "p3", "g3", 3000).ok, true);
});

test("a slot left by a crashed build expires", () => {
  const s = start(empty, "p1", "g1", 0) as BuildState;
  assert.equal(decideBuildStart(s, "p1", "g2", BUILD_SLOT_TTL_MS - 1).ok, false);
  const d = decideBuildStart(s, "p1", "g2", BUILD_SLOT_TTL_MS);
  assert.ok(d.ok && !("g1" in d.next.activeBuilds));
});

test("at most 10 build starts per 10 minutes, with the exact wait", () => {
  let s = empty;
  for (let i = 0; i < 10; i++) {
    s = start({ ...s, activeBuilds: {} }, "p1", `g${i}`, i * 60_000) as BuildState; // one a minute, each finished
  }
  const eleventh = decideBuildStart({ ...s, activeBuilds: {} }, "p1", "g10", 9 * 60_000 + 30_000);
  assert.ok(!eleventh.ok);
  assert.equal(eleventh.retryAfter, 30); // the 0:00 start leaves the window at 10:00
  const later = decideBuildStart({ ...s, activeBuilds: {} }, "p1", "g10", 10 * 60_000);
  assert.ok(later.ok && later.next.buildStarts.length === 10); // the oldest start dropped out
});
