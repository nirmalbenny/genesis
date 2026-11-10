import { test } from "node:test";
import assert from "node:assert/strict";
import { chargeable, creditsFor, toTokenUsage } from "./credits";

const usage = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) =>
  ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });

// 1 credit = $0.001: Sonnet 5.5 is $2 / $10 per MTok, Haiku 5.5 is $0.10 / $0.50.
test("Sonnet build is priced at list cost", () => {
  assert.equal(creditsFor("claude-sonnet-5-5", usage(10_000, 10_000)), 120); // $0.02 + $0.10
  assert.equal(creditsFor("claude-sonnet-5-5", usage(0, 0, 1_000_000)), 200); // cache reads $0.20 / MTok
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
