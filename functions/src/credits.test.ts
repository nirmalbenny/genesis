import { test } from "node:test";
import assert from "node:assert/strict";
import { addUsage, chargeable, creditsFor, toTokenUsage, worstCaseCredits } from "./credits";

const usage = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) =>
  ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });

// 1 credit = $0.001: Sonnet 5.5 is $2 / $10 per MTok, Haiku 5.5 is $0.10 / $0.50.
test("Sonnet build is priced at list cost", () => {
  assert.equal(creditsFor("claude-sonnet-5-5", usage(10_000, 10_000)), 120); // $0.02 + $0.10
  assert.equal(creditsFor("claude-opus-5-5", usage(10_000, 10_000)), 240); // $0.04 + $0.20: Opus 5.5 is 2x Sonnet 5.5
  assert.equal(creditsFor("claude-opus-5-5", usage(0, 0, 1_000_000, 1_000_000)), 5200); // cache reads $0.20, writes $5
  assert.equal(creditsFor("claude-sonnet-5-5", usage(0, 0, 1_000_000)), 100); // cache reads $0.10 / MTok (0.05x)
  assert.equal(creditsFor("claude-sonnet-5-5", usage(0, 0, 0, 1_000_000)), 2500); // 5-minute cache writes 1.25x
});

test("a cached system prompt costs a twentieth on a hit and a quarter more on a miss", () => {
  const system = 5485; // measured system prompt size
  const plain = creditsFor("claude-sonnet-5-5", usage(system, 0));
  const hit = creditsFor("claude-sonnet-5-5", usage(0, 0, system));
  const miss = creditsFor("claude-sonnet-5-5", usage(0, 0, 0, system));
  assert.ok(Math.abs(hit - plain / 20) < 1e-9);
  assert.ok(Math.abs(miss - plain * 1.25) < 1e-9);
});

test("the hold covers a full cache miss plus the output cap", () => {
  // 10k input tokens all written to cache (2500/MTok) + 16k output (10000/MTok) = 25 + 160.
  assert.equal(worstCaseCredits("claude-sonnet-5-5", 10_000, 16_000), 185);
  // Never below what the same call costs uncached, cached, or as a miss.
  const worst = worstCaseCredits("claude-sonnet-5-5", 10_000, 16_000);
  for (const u of [usage(10_000, 16_000), usage(0, 16_000, 10_000), usage(0, 16_000, 0, 10_000), usage(4_000, 16_000, 6_000)]) {
    assert.ok(creditsFor("claude-sonnet-5-5", u) <= worst);
  }
});

test("Haiku summary costs a fraction of a credit", () => {
  assert.equal(creditsFor("claude-haiku-5-5", usage(1000, 60)), 0.13);
});

test("unknown models are billed at the highest known rate, never free", () => {
  assert.equal(creditsFor("some-new-model", usage(10_000, 10_000)), 240); // the dearest on the card: Opus 5.5
});

test("charges round up once per build", () => {
  assert.equal(chargeable(120 + 0.13), 121);
  assert.equal(chargeable(0), 0);
});

test("API usage maps to token usage, missing fields count as zero", () => {
  assert.deepEqual(toTokenUsage({ input_tokens: 5, output_tokens: 7 }), usage(5, 7));
  assert.deepEqual(toTokenUsage(undefined), usage(0, 0));
});

test("a build's turns add up, and holding each extra turn's input covers a multi-turn build", () => {
  const turns = [usage(2_000, 300, 6_000, 0), usage(500, 200, 0, 8_000), usage(400, 9_000, 8_000, 900)];
  const total = turns.reduce(addUsage);
  assert.deepEqual(total, usage(2_900, 9_500, 14_000, 8_900));
  // First hold: turn 1's input + the whole output cap. Each extra turn: its whole input at the dearest rate.
  const input = (u: ReturnType<typeof usage>) => u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  const held = worstCaseCredits("claude-sonnet-5-5", input(turns[0]!), 16_000)
    + turns.slice(1).reduce((n, t) => n + worstCaseCredits("claude-sonnet-5-5", input(t), 0), 0);
  assert.ok(creditsFor("claude-sonnet-5-5", total) <= held);
});
