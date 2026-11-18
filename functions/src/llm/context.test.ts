import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFor } from "../files/manifestStore";
import type { Manifest } from "../files";
import { indexLine, rankPaths, renderContext, selectContext } from "./context";
import { FILE_BUDGET_CHARS, SINGLE_FILE_LIMIT_CHARS } from "./prompt";

const manifestOf = (files: Record<string, string>): Manifest =>
  Object.fromEntries(Object.entries(files).map(([p, c]) => [p, entryFor(p, c)]));

const pad = (n: number, head = "") => head + "x".repeat(Math.max(0, n - head.length));

test("when everything fits, every file is sent in full, alphabetically, with no index (as before)", () => {
  const files = { "src/main.js": "m", "src/App.vue": "a", "src/components/B.vue": "b" };
  const manifest = manifestOf(files);
  const { full, index } = selectContext(manifest, { prompt: "anything" });
  assert.deepEqual(full, ["src/App.vue", "src/components/B.vue", "src/main.js"]);
  assert.deepEqual(index, []);
  const rendered = renderContext(full.map((p) => ({ path: p, content: files[p as keyof typeof files] })), manifest, index, true);
  const doc = (p: string, c: string) => `<document>\n<source>${p}</source>\n<document_content>\n${c}\n</document_content>\n</document>`;
  assert.equal(rendered, `<documents>\n${doc("src/App.vue", "a")}\n${doc("src/components/B.vue", "b")}\n${doc("src/main.js", "m")}\n</documents>`);
});

test("ranking: entry files, active tab, open tabs, recent changes, files the prompt names, their neighbours, the rest", () => {
  const manifest = manifestOf({
    "src/main.js": 'import App from "./App.vue";',
    "src/App.vue": 'import ContactList from "./components/ContactList.vue";',
    "src/utils.js": "",
    "src/components/Active.vue": "",
    "src/components/Open.vue": "",
    "src/components/Recent.vue": "",
    "src/components/ContactList.vue": 'import Row from "./ContactRow.vue";',
    "src/components/ContactRow.vue": "",
    "src/components/Uses.vue": 'import { x } from "./ContactList";',
    "src/components/Zed.vue": "",
    "src/components/Alpha.vue": "",
  });
  const order = rankPaths(manifest, {
    activePath: "src/components/Active.vue",
    openPaths: ["src/components/Open.vue", "src/components/Active.vue", "src/gone.vue"],
    recentPaths: ["src/components/Recent.vue"],
    prompt: "Add a phone column to the ContactList",
  });
  assert.deepEqual(order, [
    "src/main.js", "src/App.vue", "src/utils.js",
    "src/components/Active.vue", "src/components/Open.vue", "src/components/Recent.vue",
    "src/components/ContactList.vue",
    "src/components/ContactRow.vue", "src/components/Uses.vue", // imported by / importing the named file
    "src/components/Alpha.vue", "src/components/Zed.vue",
  ]);
});

test("common words don't count as component names", () => {
  const manifest = manifestOf({ "src/App.vue": "", "src/components/List.vue": "", "src/components/Stats.vue": "" });
  assert.deepEqual(rankPaths(manifest, { prompt: "show a list of stats" }).slice(1), ["src/components/List.vue", "src/components/Stats.vue"]);
  assert.equal(rankPaths(manifest, { prompt: "fix Stats.vue" })[1], "src/components/Stats.vue", "a file name always counts");
});

test("a large app fills the budget in rank order; oversized and remaining files go to the index", () => {
  const third = Math.floor(FILE_BUDGET_CHARS / 3) - 100; // three fit, with room for a tiny file
  const manifest = manifestOf({
    "src/App.vue": pad(third, "<template/>"),
    "src/components/Big.vue": pad(SINGLE_FILE_LIMIT_CHARS + 1),
    "src/components/Focus.vue": pad(third),
    "src/components/Other.vue": pad(third),
    "src/components/Tiny.vue": "<script setup>defineProps(['id'])</script>",
    "src/components/Last.vue": pad(third),
  });
  const { full, index } = selectContext(manifest, { activePath: "src/components/Focus.vue", prompt: "x" });
  // App.vue + Focus.vue first; then alphabetical: Big (too large), Last (fits), Other (over budget), Tiny (fits).
  assert.deepEqual(full, ["src/App.vue", "src/components/Focus.vue", "src/components/Last.vue", "src/components/Tiny.vue"]);
  assert.deepEqual(index, ["src/components/Big.vue", "src/components/Other.vue"]);
});

test("index lines describe a file from its manifest entry, and say how to get it", () => {
  const src = '<script setup>\nimport { usePager } from "../genesis/hl.js";\ndefineProps({ query: String });\ndefineEmits(["select"]);\n</script>';
  const manifest = manifestOf({ "src/components/X.vue": src });
  assert.equal(indexLine("src/components/X.vue", manifest["src/components/X.vue"]!),
    `src/components/X.vue  ${(Buffer.byteLength(src) / 1024).toFixed(1)} KB, 5 lines · props: query · emits: select · uses usePager`);
  assert.match(renderContext([], manifest, ["src/components/X.vue"], true), /Read any of them with read_files before changing them\.\nsrc\/components\/X\.vue {2}/);
  assert.match(renderContext([], manifest, ["src/components/X.vue"], false), /can't be changed in this request/);
});
