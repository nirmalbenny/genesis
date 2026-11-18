import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFor } from "../files/manifestStore";
import type { Manifest } from "../files";
import { SINGLE_FILE_LIMIT_CHARS } from "./prompt";
import { MAX_FILE_BYTES } from "./validate";
import { createWorkspace } from "./workspace";

const FILES: Record<string, string> = {
  "src/main.js": 'import { createApp } from "vue";',
  "src/App.vue": "<template>\n  <p>one</p>\n  <p>two</p>\n  <p>two</p>\n</template>",
  "src/components/Shown.vue": "<template>shown</template>",
  "src/components/Hidden.vue": "<template>hidden</template>",
  "src/components/Huge.vue": "x".repeat(SINGLE_FILE_LIMIT_CHARS + 1),
};
const manifest: Manifest = Object.fromEntries(Object.entries(FILES).map(([p, c]) => [p, entryFor(p, c)]));
/** A minimal valid component. */
const T = (text: string) => `<template>${text}</template>`;
const make = () => {
  const w = createWorkspace(manifest);
  for (const p of ["src/main.js", "src/App.vue", "src/components/Shown.vue"]) w.show(p, FILES[p]!);
  return w;
};

test("writes: new files and shown files are saved; the result says which", () => {
  const w = make();
  assert.deepEqual(w.write("src/components/New.vue", T("new")), { content: "Created src/components/New.vue (24 bytes).", isError: false });
  assert.deepEqual(w.write("src/App.vue", T("app")), { content: "Saved src/App.vue (24 bytes).", isError: false });
  assert.deepEqual(w.ops(), [
    { type: "write", path: "src/components/New.vue", content: T("new") },
    { type: "write", path: "src/App.vue", content: T("app") },
  ]);
});

test("writes are refused with a reason the model can act on", () => {
  const w = make();
  const cases: [string, string, RegExp][] = [
    ["package.json", "{}", /system-owned/],
    ["src/genesis/hl.js", "x", /system-owned/],
    ["../x.js", "x", /must not contain/],
    ["src/a.py", "x", /extension not allowed/],
    ["src/components/Hidden.vue", "x", /haven't been shown src\/components\/Hidden.vue: read it with read_files first/],
    ["src/components/Huge.vue", "x", /too large for the AI to change/],
    ["src/B.vue", "  \n", /file is empty/],
    ["src/C.vue", "x".repeat(MAX_FILE_BYTES + 1), /exceeds/],
  ];
  for (const [path, content, reason] of cases) {
    const r = w.write(path, content);
    assert.equal(r.isError, true, path);
    assert.match(r.content, /^Not saved: /);
    assert.match(r.content, reason, path);
  }
  assert.deepEqual(w.ops(), [], "nothing refused is kept");
});

test("a file read during the build can be written; one written can be edited", () => {
  const w = make();
  w.show("src/components/Hidden.vue", FILES["src/components/Hidden.vue"]!);
  assert.equal(w.write("src/components/Hidden.vue", T("now shown")).isError, false);
  w.write("src/New.vue", T("a b c"));
  assert.equal(w.edit("src/New.vue", "b", "B").isError, false);
  assert.equal(w.content("src/New.vue"), T("a B c"));
});

test("edits replace one exact, unique passage", () => {
  const w = make();
  assert.deepEqual(w.edit("src/App.vue", "<p>one</p>", "<p>1</p>"), { content: "Edited src/App.vue.", isError: false });
  assert.match(w.content("src/App.vue")!, /<p>1<\/p>/);
  assert.match(w.edit("src/App.vue", "<p>two</p>", "x").content, /appears more than once/);
  assert.match(w.edit("src/App.vue", "<p>three</p>", "x").content, /was not found in src\/App.vue/);
  assert.match(w.edit("src/App.vue", "", "x").content, /old_text is empty/);
  assert.match(w.edit("src/components/Hidden.vue", "hidden", "x").content, /read it with read_files first/);
  assert.match(w.edit("src/Nope.vue", "a", "b").content, /does not exist; create it with write_file/);
  assert.match(w.edit("src/App.vue", w.content("src/App.vue")!, " ").content, /file is empty/);
  assert.deepEqual(w.ops().map((o) => o.path), ["src/App.vue"]);
});

test("edits apply in order, each on the result of the last", () => {
  const w = make();
  w.edit("src/App.vue", "<p>one</p>", "<p>first</p>");
  w.edit("src/App.vue", "<p>first</p>", "<p>final</p>");
  assert.match(w.content("src/App.vue")!, /<p>final<\/p>/);
});

test("deletes: existing files (shown or not), never entry files; net changes in order", () => {
  const w = make();
  assert.equal(w.remove("src/components/Hidden.vue").isError, false, "listed files may be deleted");
  assert.match(w.remove("src/App.vue").content, /entry file and can't be deleted/);
  assert.match(w.remove("src/main.js").content, /entry file/);
  assert.match(w.remove("src/Nope.vue").content, /does not exist/);
  assert.match(w.remove("src/components/Hidden.vue").content, /does not exist/, "already deleted");
  w.write("src/Temp.vue", T("t"));
  w.remove("src/Temp.vue");
  w.remove("src/components/Shown.vue");
  w.write("src/components/Shown.vue", T("back"));
  assert.deepEqual(w.ops(), [
    { type: "delete", path: "src/components/Hidden.vue" },
    { type: "write", path: "src/components/Shown.vue", content: T("back") },
  ], "a file created and deleted in the build leaves nothing; a delete then write is a write");
});

test("a file that doesn't compile is refused, and so is an edit that would break one", () => {
  const w = make();
  const r = w.write("src/utils.js", "export const a = 1;\n</parameter>\n");
  assert.equal(r.isError, true);
  assert.match(r.content, /^Not saved: src\/utils.js doesn't compile: Unexpected token \(line 2\)\. Fix it and write the whole file again\.$/);
  assert.match(w.write("src/A.vue", "<script setup>\ndefineOptions({});\n</script>\n<template>x</template>").content, /defineOptions isn't supported/);
  const e = w.edit("src/App.vue", "<p>one</p>", "<p>one</div>");
  assert.match(e.content, /wouldn't compile: .*The file is unchanged/);
  assert.match(w.content("src/App.vue") ?? FILES["src/App.vue"]!, /<p>one<\/p>/);
  assert.deepEqual(w.ops(), []);
});

test("problems: imports the build's changes leave unresolved, in its files and in files importing a deleted one", () => {
  const files = {
    "src/main.js": 'import App from "./App.vue";',
    "src/App.vue": '<script setup>\nimport List from "./components/List.vue";\n</script>\n<template><List /></template>',
    "src/components/List.vue": "<template>list</template>",
  };
  const m: Manifest = Object.fromEntries(Object.entries(files).map(([p, c]) => [p, entryFor(p, c)]));
  const w = createWorkspace(m);
  for (const [p, c] of Object.entries(files)) w.show(p, c);
  assert.deepEqual(w.problems(), []);
  w.write("src/components/Stats.vue", '<script setup>\nimport { Card, Chart } from "../genesis/ui";\nimport { fmt } from "../utils.js";\n</script>\n<template><Card /></template>');
  w.remove("src/components/List.vue");
  assert.deepEqual(w.problems(), [
    "src/components/Stats.vue: imports Chart from \"../genesis/ui\", which isn't a Genesis component",
    "src/components/Stats.vue: imports \"../utils.js\", but src/utils.js doesn't exist",
    "src/App.vue: imports src/components/List.vue, which this change deletes",
  ]);
  w.write("src/utils.js", "export const fmt = (x) => x;");
  w.write("src/components/List.vue", "<template>back</template>");
  assert.deepEqual(w.problems(), ["src/components/Stats.vue: imports Chart from \"../genesis/ui\", which isn't a Genesis component"], "files written later in the build count");
});
