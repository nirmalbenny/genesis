import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, systemBlocks } from "./prompt";
import { READ_FILES_TOOL } from "./tools";

test("the system prompt is one cached block, byte-identical on every call", () => {
  const blocks = systemBlocks();
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0]!.cache_control, { type: "ephemeral" }, "5-minute TTL: the rate card has no 1-hour price");
  assert.equal(blocks[0]!.text, buildSystemPrompt());
  assert.equal(systemBlocks()[0]!.text, blocks[0]!.text, "any variation would make every build a cache miss");
});

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
  assert.match(prompt, /<plan>[\s\S]*<file path="src\/App.vue">[\s\S]*<\/file>[\s\S]*<delete path=/, "the output format");
  assert.match(prompt, /<refuse>/);
  assert.match(prompt, /Do not change its look unless the user explicitly asks/);
  assert.match(prompt, /each under about 150 lines/);
  assert.doesNotMatch(prompt, /Style with plain CSS in <style scoped>/, "the old free-styling rule is gone");
  assert.match(prompt, /build the UI from the components in "\.\/genesis\/ui"/, "components first");
  assert.match(prompt, /`Button` \(variant: default \| secondary/, "the component reference is included");
});

test("the system prompt covers write errors and bounded, sequential batches", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /hl_duplicate_contact/);
  assert.match(prompt, /at most 25 writes per click/);
  assert.match(prompt, /one at a time \(await each; never Promise\.all\)/);
  assert.match(prompt, /Continue past item errors/);
  assert.match(prompt, /never JSON\.stringify an error/);
});

test("the system prompt forbids presenting work on loaded items as the full result", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /must cover all the data, not just the loaded page/);
  assert.match(prompt, /never present work on loaded items as the full result/);
  assert.match(prompt, /Not available to apps \(no endpoint\)/, "the reference lists what has no endpoint");
});

test("the read_files tool definition is frozen and identical on every build (it is part of the cached prefix)", () => {
  assert.ok(Object.isFrozen(READ_FILES_TOOL) && Object.isFrozen(READ_FILES_TOOL.input_schema));
  assert.throws(() => { (READ_FILES_TOOL as { name: string }).name = "x"; }, TypeError);
  assert.equal(JSON.stringify(READ_FILES_TOOL), JSON.stringify(READ_FILES_TOOL));
  // A snapshot of the bytes: changing the definition is deliberate (it starts a new prompt cache).
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(READ_FILES_TOOL)).digest("hex").slice(0, 12), "f502bd4dda09");
});

test("the system prompt tells the model to read listed files before writing anything", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /call it BEFORE writing any output/);
  assert.match(prompt, /Never rewrite a file you haven't been shown/);
});
