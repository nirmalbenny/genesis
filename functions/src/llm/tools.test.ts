import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFor } from "../files/manifestStore";
import type { Manifest, ProjectFile } from "../files";
import type { ToolCall } from "./assemble";
import { SINGLE_FILE_LIMIT_CHARS } from "./prompt";
import { MAX_READ_PATHS, runBuildTool, runReadFiles } from "./tools";
import { createWorkspace } from "./workspace";

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
const call = (name: string, input: Record<string, unknown>, error: string | null = null): ToolCall => ({ index: 0, id: "t", name, input, error });

test("returns the files asked for, shows them to the workspace, and explains every path it skips", async () => {
  const w = createWorkspace(manifest);
  w.show("src/App.vue", "app");
  const r = reader();
  const result = await runReadFiles(
    { paths: ["src/components/A.vue", "src/App.vue", "src/missing.vue", "../etc/passwd", "src/components/Huge.vue", "src/components/A.vue"] },
    manifest, r.read, (p) => w.shown(p), (f) => w.show(f.path, f.content),
  );
  assert.deepEqual(r.calls, [["src/components/A.vue"]], "content is loaded only for readable files, once each");
  assert.deepEqual(result.read, ["src/components/A.vue"]);
  assert.equal(result.isError, false);
  assert.ok(w.shown("src/components/A.vue"), "a read file may now be changed");
  assert.match(result.content, /^<documents>\n<document>\n<source>src\/components\/A.vue<\/source>\n<document_content>\na\n<\/document_content>/);
  assert.match(result.content, /src\/App.vue: already shown in full above/);
  assert.match(result.content, /src\/missing.vue: no such file/);
  assert.match(result.content, /\.\.\/etc\/passwd: path must/);
  assert.match(result.content, /Huge.vue: too large to read or edit/);
});

test("bad input and calls that return nothing are errors; more than the limit is cut", async () => {
  const none = () => false;
  for (const input of [null, {}, { paths: [] }, { paths: "src/App.vue" }, { paths: [1] }]) {
    const r = await runReadFiles(input, manifest, reader().read, none, () => {});
    assert.equal(r.isError, true, JSON.stringify(input));
  }
  assert.equal((await runReadFiles({ paths: ["src/nope.vue"] }, manifest, reader().read, none, () => {})).isError, true);
  const many = Array.from({ length: MAX_READ_PATHS + 2 }, (_, i) => `src/c${i}.vue`);
  const big: Manifest = Object.fromEntries(many.map((p) => [p, entryFor(p, "x")]));
  const r = await runReadFiles({ paths: many }, big, async (ps) => ps.map((path) => ({ path, content: "x" })), none, () => {});
  assert.equal(r.read.length, MAX_READ_PATHS);
  assert.match(r.content, /at most 5 files per call/);
});

test("runBuildTool checks every input before it touches the workspace", async () => {
  const w = createWorkspace(manifest);
  const deps = { workspace: w, readFiles: null };
  const bad: [ToolCall, RegExp][] = [
    [call("write_file", {}, "invalid JSON (Unexpected end)"), /Invalid input: invalid JSON .* Call write_file again/],
    [call("write_file", { path: "src/X.vue" }), /"content" must be a string/],
    [call("write_file", { path: 3, content: "x" }), /"path" must be a string/],
    [call("edit_file", { path: "src/App.vue", old_text: "a" }), /"new_text" must be a string/],
    [call("delete_file", {}), /"path" must be a string/],
    [call("read_files", { paths: ["src/components/A.vue"] }), /read limit for this request is reached/],
    [call("run_shell", { cmd: "ls" }), /Unknown tool run_shell/],
  ];
  for (const [c, reason] of bad) {
    const r = await runBuildTool(c, deps);
    assert.equal(r.isError, true, c.name);
    assert.match(r.content, reason);
  }
  assert.deepEqual(w.ops(), []);
  assert.equal((await runBuildTool(call("write_file", { path: "src/X.vue", content: "<template>x</template>" }), deps)).isError, false);
  assert.deepEqual(w.ops().map((o) => o.path), ["src/X.vue"]);
});
