import { test } from "node:test";
import assert from "node:assert/strict";
import { chargeable, creditsFor, toTokenUsage, worstCaseCredits } from "./credits";

const usage = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) =>
  ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });

// 1 credit = $0.001: Sonnet 5.5 is $2 / $10 per MTok, Haiku 5.5 is $0.10 / $0.50.
test("Sonnet build is priced at list cost", () => {
  assert.equal(creditsFor("claude-sonnet-5-5", usage(10_000, 10_000)), 120); // $0.02 + $0.10
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
  assert.equal(creditsFor("some-new-model", usage(10_000, 10_000)), 120);
});

test("charges round up once per build", () => {
  assert.equal(chargeable(120 + 0.13), 121);
  assert.equal(chargeable(0), 0);
});

test("API usage maps to token usage, missing fields count as zero", () => {
  assert.deepEqual(toTokenUsage({ input_tokens: 5, output_tokens: 7 }), usage(5, 7));
  assert.deepEqual(toTokenUsage(undefined), usage(0, 0));
});
