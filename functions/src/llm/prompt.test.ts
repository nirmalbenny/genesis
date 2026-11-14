import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "./prompt";

test("the system prompt carries no sub-account name or id, and points the model to LOCATION_NAME", () => {
  const prompt = buildSystemPrompt();
  // buildSystemPrompt takes no location at all; this guards against the location line coming back.
  assert.doesNotMatch(prompt, /Connected HighLevel location/);
  assert.match(prompt, /Never write a sub-account's name or id into the code/);
  assert.match(prompt, /import LOCATION_NAME from the client/);
});

test("the system prompt includes the UI kit, keeps its look by default, and asks for small files", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /# UI kit \(`\.\/genesis\/ui\.css`/, "uiKit.md is included (and copied into lib/ by the build)");
  assert.match(prompt, /Do not change its look unless the user explicitly asks/);
  assert.match(prompt, /each under about 150 lines/);
  assert.doesNotMatch(prompt, /Style with plain CSS in <style scoped>/, "the old free-styling rule is gone");
});

test("the system prompt forbids presenting work on loaded items as the full result", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /must cover all the data, not just the loaded page/);
  assert.match(prompt, /never present work on loaded items as the full result/);
  assert.match(prompt, /Not available to apps \(no endpoint\)/, "the reference lists what has no endpoint");
});
