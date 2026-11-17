import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFor } from "../files/manifestStore";
import type { Manifest, ProjectFile } from "../files";
import { SINGLE_FILE_LIMIT_CHARS } from "./prompt";
import { MAX_READ_PATHS, runReadFiles } from "./tools";

const files: Record<string, string> = {
  "src/App.vue": "app",
  "src/components/A.vue": "a",
  "src/components/B.vue": "b",
  "src/components/Huge.vue": "x".repeat(SINGLE_FILE_LIMIT_CHARS + 1),
};
const manifest: Manifest = Object.fromEntries(Object.entries(files).map(([p, c]) => [p, entryFor(p, c)]));
const reader = () => {
  const calls: string[][] = [];
  return { calls, read: async (paths: string[]): Promise<ProjectFile[]> => { calls.push(paths); return paths.map((path) => ({ path, content: files[path]! })); } };
};

test("returns the files asked for, marks them seen, and explains every path it skips", async () => {
  const seen = new Set(["src/App.vue"]);
  const r = reader();
  const result = await runReadFiles(
    { paths: ["src/components/A.vue", "src/App.vue", "src/missing.vue", "../etc/passwd", "src/components/Huge.vue", "src/components/A.vue"] },
    manifest, r.read, seen,
  );
  assert.deepEqual(r.calls, [["src/components/A.vue"]], "content is loaded only for readable files, once each");
  assert.deepEqual(result.read, ["src/components/A.vue"]);
  assert.equal(result.is_error, false);
  assert.ok(seen.has("src/components/A.vue"), "a read file may now be rewritten");
  assert.match(result.content, /^<file path="src\/components\/A.vue">\na\n<\/file>/);
  assert.match(result.content, /src\/App.vue: already shown in full above/);
  assert.match(result.content, /src\/missing.vue: no such file/);
  assert.match(result.content, /\.\.\/etc\/passwd: path must/);
  assert.match(result.content, /Huge.vue: too large to read or edit/);
});

test("bad input and calls that return nothing are errors; more than the limit is cut", async () => {
  const seen = new Set<string>();
  for (const input of [null, {}, { paths: [] }, { paths: "src/App.vue" }, { paths: [1] }]) {
    const r = await runReadFiles(input, manifest, reader().read, seen);
    assert.equal(r.is_error, true, JSON.stringify(input));
  }
  assert.equal((await runReadFiles({ paths: ["src/nope.vue"] }, manifest, reader().read, seen)).is_error, true);
  const many = Array.from({ length: MAX_READ_PATHS + 2 }, (_, i) => `src/c${i}.vue`);
  const big: Manifest = Object.fromEntries(many.map((p) => [p, entryFor(p, "x")]));
  const r = await runReadFiles({ paths: many }, big, async (ps) => ps.map((path) => ({ path, content: "x" })), new Set());
  assert.equal(r.read.length, MAX_READ_PATHS);
  assert.match(r.content, /at most 5 files per call/);
});
