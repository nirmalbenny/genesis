import { test } from "node:test";
import assert from "node:assert/strict";
import { errorStep, stepTimer } from "./buildTrace";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the step timer records each named step, adds repeats, and times failed steps too", async () => {
  const { steps, time } = stepTimer();
  assert.equal(await time("a", async () => { await wait(20); return 7; }), 7);
  await time("b", () => wait(10));
  await time("b", () => wait(10));
  await assert.rejects(time("c", async () => { await wait(5); throw new Error("boom"); }), /boom/);
  assert.ok(steps.a! >= 15 && steps.a! < 200, `a: ${steps.a}`);
  assert.ok(steps.b! >= 15, `repeats add up: ${steps.b}`);
  assert.ok(steps.c! >= 3, "a failed step is still timed");
});

test("error codes map to the step where the build failed", () => {
  assert.equal(errorStep("truncated"), "stream");
  assert.equal(errorStep("insufficient_credits"), "read hold");
  assert.equal(errorStep("invalid_output"), "validate");
  assert.equal(errorStep("persist_failed"), "save");
});
