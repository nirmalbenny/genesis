import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, systemBlocks } from "./prompt";
import { buildTools } from "./tools";

test("the system prompt is one cached block, byte-identical on every call", () => {
  const blocks = systemBlocks([]);
  assert.equal(blocks.length, 2, "the shared prompt, then this build's HighLevel guides");
  assert.deepEqual(blocks[0]!.cache_control, { type: "ephemeral" }, "5-minute TTL: the rate card has no 1-hour price");
  assert.equal(blocks[0]!.text, buildSystemPrompt());
  assert.equal(systemBlocks([])[0]!.text, blocks[0]!.text, "any variation would make every build a cache miss");
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
  assert.match(prompt, /You change the app only by calling tools/, "the output protocol");
  assert.match(prompt, /write_file[\s\S]*edit_file[\s\S]*delete_file/);
  assert.match(prompt, /Never write code or file contents as text/);
  assert.match(prompt, /call decline with one short reason/);
  assert.doesNotMatch(prompt, /<(plan|file|refuse|delete)[\s>]/, "no output tags left");
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
  assert.match(prompt, /Anything not listed here has no endpoint/, "the reference says what has no endpoint");
});

test("the tool definitions are frozen and identical on every build (they are part of the cached prefix)", () => {
  for (const contextTools of [true, false]) {
    for (const t of buildTools(contextTools)) {
      assert.ok(Object.isFrozen(t) && Object.isFrozen(t.input_schema), t.name);
      assert.equal(t.strict, true, `${t.name}: the API enforces its schema`);
    }
  }
  assert.throws(() => { (buildTools(true)[0] as { name: string }).name = "x"; }, TypeError);
  assert.deepEqual(buildTools(true).map((t) => t.name), ["write_file", "edit_file", "delete_file", "read_files", "decline"]);
  assert.deepEqual(buildTools(false).map((t) => t.name), ["write_file", "edit_file", "delete_file", "decline"]);
  assert.equal(buildTools(true).find((t) => t.name === "write_file")!.eager_input_streaming, true, "file content streams to the editor");
  // A snapshot of the bytes: changing a definition is deliberate (it starts a new prompt cache).
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(buildTools(true))).digest("hex").slice(0, 12), "4c90509173f0");
});

test("the system prompt tells the model to read listed files before changing anything", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /call it BEFORE any other tool and before writing the plan/);
  assert.match(prompt, /Changing a file you haven't been shown is refused/);
});
