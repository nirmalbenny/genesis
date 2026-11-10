import { test } from "node:test";
import assert from "node:assert/strict";
import { createParser, type ParseEvent } from "./parser";
import { validateOps } from "./validate";

const sample =
  '<plan>Build it.</plan>\n<file path="src/App.vue">\n<template><div>a < b</div></template>\n</file>\n<delete path="src/old.vue"/>';

function run(chunkSize: number) {
  const events: ParseEvent[] = [];
  const p = createParser((e) => events.push(e));
  for (let i = 0; i < sample.length; i += chunkSize) p.push(sample.slice(i, i + chunkSize));
  return { events, unclosed: p.end() };
}

test("parses identically regardless of chunking", () => {
  for (const size of [1, 2, 3, 7, 1000]) {
    const { events, unclosed } = run(size);
    assert.equal(unclosed, null);
    const end = events.find((e) => e.type === "file_end");
    assert.deepEqual(end, { type: "file_end", path: "src/App.vue", content: "<template><div>a < b</div></template>" });
    assert.ok(events.some((e) => e.type === "delete" && e.path === "src/old.vue"));
    const plan = events.filter((e) => e.type === "token" && e.path === null).map((e) => (e as { text: string }).text).join("");
    assert.match(plan, /Build it\./);
    assert.doesNotMatch(plan, /<plan>/);
  }
});

test("reports an unclosed file", () => {
  const p = createParser(() => {});
  p.push('<file path="src/App.vue">\n<template>');
  assert.equal(p.end(), "src/App.vue");
});

test("validateOps rejects bad paths and keeps valid ops", () => {
  const { valid, rejected } = validateOps(
    [
      { type: "write", path: "src/ok.vue", content: "x" },
      { type: "write", path: "../evil.js", content: "x" },
      { type: "write", path: "package.json", content: "{}" },
      { type: "write", path: "src/a.html", content: "x" },
      { type: "delete", path: "src/App.vue" },
    ],
    new Set(["src/App.vue"]),
  );
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 4);
});

test("refuse tag is swallowed and reported, in any chunking", () => {
  for (const size of [1, 3, 1000]) {
    const events: ParseEvent[] = [];
    const p = createParser((e) => events.push(e));
    const text = "<refuse>not about the app</refuse>";
    for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size));
    p.end();
    assert.deepEqual(events, [{ type: "refuse", reason: "not about the app" }]);
  }
});

test("a stray </parameter> trailer is stripped from file content", () => {
  const events: ParseEvent[] = [];
  const p = createParser((e) => events.push(e));
  p.push('<file path="src/App.vue">\n<template><p>x</p></template>\n</parameter>\n</file>');
  p.end();
  const end = events.find((e) => e.type === "file_end");
  assert.equal(end?.type === "file_end" && end.content, "<template><p>x</p></template>");
});

test("a stream cut off mid-tag doesn't leak the half tag into the plan", () => {
  for (const tail of ['<file path="src/components/Contact', "<fi", "<"]) {
    const events: ParseEvent[] = [];
    const p = createParser((e) => events.push(e));
    p.push(`<plan>Build it.</plan>\n${tail}`);
    assert.equal(p.end(), null);
    const plan = events.filter((e) => e.type === "token" && e.path === null).map((e) => (e as { text: string }).text).join("");
    assert.equal(plan.trim(), "Build it.");
  }
});
