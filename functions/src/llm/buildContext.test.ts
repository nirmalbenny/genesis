import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeContext, hashText } from "./buildContext";
import { buildSystemPrompt } from "./prompt";

test("hashes are short, stable and change with the text", () => {
  assert.match(hashText("abc"), /^[0-9a-f]{12}$/);
  assert.equal(hashText("abc"), hashText("abc"));
  assert.notEqual(hashText("abc"), hashText("abd"));
});

test("a build's context names the guides sent and hashes every text it was given", () => {
  const ctx = describeContext({ guides: ["calendars", "contacts"], ui: "element-plus", contextTools: true });
  assert.deepEqual(ctx.guides, ["calendars", "contacts"]);
  assert.deepEqual(Object.keys(ctx.hashes.guides), ["calendars", "contacts"]);
  assert.notEqual(ctx.hashes.guides.calendars, ctx.hashes.guides.contacts);
  assert.equal(ctx.hashes.buildPrompt, hashText(buildSystemPrompt()));
  assert.equal(ctx.hashes.rubric, hashText(readFileSync(join(__dirname, "rubric.md"), "utf8")));
  assert.equal(ctx.hashes.security, hashText(readFileSync(join(__dirname, "security.md"), "utf8")));
  for (const h of [ctx.hashes.uiGuide, ctx.hashes.buildTools, ctx.hashes.planner]) assert.match(h, /^[0-9a-f]{12}$/);
  // A different selection is a different context; the same one is the same.
  assert.deepEqual(describeContext({ guides: ["calendars", "contacts"], ui: "element-plus", contextTools: true }), ctx);
  assert.notEqual(describeContext({ guides: ["calendars"], ui: "kit", contextTools: false }).hashes.uiGuide, ctx.hashes.uiGuide);
  assert.notEqual(describeContext({ guides: [], ui: "element-plus", contextTools: false }).hashes.buildTools, ctx.hashes.buildTools);
});
