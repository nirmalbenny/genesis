import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFile, checkImports } from "./checkCode";

const vue = (script: string, template = "<p>hi</p>") => `<script setup>\n${script}\n</script>\n\n<template>\n  ${template}\n</template>\n`;

test("valid files compile: Vue (setup and options), JS, TS, JSON, CSS", () => {
  assert.equal(checkFile("src/App.vue", vue('import { ref } from "vue";\nimport { Button } from "./genesis/ui";\nconst n = ref(0);', '<Button @click="n++">{{ n }}</Button>')), null);
  assert.equal(checkFile("src/A.vue", "<script>\nexport default { inheritAttrs: false };\n</script>\n<script setup>\nconst props = defineProps({ a: String });\n</script>\n<template><p>{{ props.a }}</p></template>"), null);
  assert.equal(checkFile("src/utils.js", "export const sum = (a, b) => a + b;\n"), null);
  assert.equal(checkFile("src/t.ts", "export const n: number = 1;\n"), null);
  assert.equal(checkFile("src/data.json", '{"a": 1}'), null);
  assert.equal(checkFile("src/style.css", ":root { --primary: red }"), null);
  assert.equal(checkFile("src/B.vue", vue("", "<Transition><div /></Transition><component :is=\"'p'\" />")), null, "built-ins need no import");
});

test("broken files are reported with what is wrong and where", () => {
  const cases: [string, string, RegExp][] = [
    ["src/utils.js", "export const a = 1;\n</parameter>\n</invoke>\n", /Unexpected token \(line 2\)/],
    ["src/utils.js", "export function f( {\n", /\(line \d\)/],
    ["src/t.ts", "const x: = 1;", /line 1/],
    ["src/data.json", "{a: 1}", /JSON/],
    ["src/App.vue", "<template><div></template>", /Element is missing end tag/],
    ["src/App.vue", vue("const a = ;"), /Unexpected token \(line 2\)/],
    ["src/App.vue", vue("const n = 1;", "<p>{{ n + }}</p>"), /line 6/],
    ["src/App.vue", "just text", /At least one <template> or <script> is required/],
  ];
  for (const [path, code, re] of cases) assert.match(String(checkFile(path, code)), re, code);
});

test("features the preview's compiler lacks are refused, with what to use instead", () => {
  assert.match(String(checkFile("src/A.vue", vue("defineOptions({ inheritAttrs: false });"))), /defineOptions isn't supported .* export default \{ inheritAttrs: false \}/);
  assert.match(String(checkFile("src/A.vue", vue("const model = defineModel();"))), /defineModel isn't supported .* emit\('update:modelValue'/);
  assert.match(String(checkFile("src/A.vue", vue("const model = defineModel<string>();".replace("<string>", "")))), /defineModel/);
  assert.match(String(checkFile("src/A.vue", vue("const { title } = defineProps({ title: String });"))), /destructuring defineProps/);
  assert.match(String(checkFile("src/A.vue", vue("const { a = 1 } = withDefaults(defineProps(), {});"))), /destructuring defineProps/);
});

test("a component used in the template must be imported", () => {
  assert.match(String(checkFile("src/App.vue", vue("", "<ContactList />"))), /uses <ContactList> but the script doesn't import it/);
  assert.equal(checkFile("src/App.vue", vue('import ContactList from "./components/ContactList.vue";', "<ContactList />")), null);
});

test("imports: project files must exist; client names and components must be real; only vue from npm", () => {
  const files = new Set(["src/components/ContactList.vue", "src/utils.js", "src/style.css"]);
  const exists = (p: string) => files.has(p);
  const app = [
    'import { ref } from "vue";',
    'import ContactList from "./components/ContactList.vue";',
    'import { fmt } from "./utils";',
    'import "./style.css";',
    'import "./genesis/ui.css";',
    'import { usePager, contactName, LOCATION_NAME } from "./genesis/hl.js";',
    'import { Button, DialogContent } from "./genesis/ui";',
    'import { PREVIEW_TOKEN } from "./hl.config.js";',
  ].join("\n");
  assert.deepEqual(checkImports("src/App.vue", vue(app), exists), []);
  assert.deepEqual(checkImports("src/components/X.vue", vue('import { fmt } from "../utils.js";\nimport { Card } from "../genesis/ui";'), exists), []);

  const bad = [
    'import Missing from "./components/Missing.vue";',
    'import { fetchAll, usePager } from "./genesis/hl.js";',
    'import { Button, DataGrid } from "./genesis/ui";',
    'import _ from "lodash";',
  ].join("\n");
  const problems = checkImports("src/App.vue", vue(bad), exists);
  assert.deepEqual(problems, [
    'imports "./components/Missing.vue", but src/components/Missing.vue doesn\'t exist',
    'imports fetchAll from "./genesis/hl.js", which doesn\'t export it (see "Client")',
    'imports DataGrid from "./genesis/ui", which isn\'t a Genesis component',
    'imports "lodash", but apps can only import vue (no other npm packages)',
  ]);
  assert.deepEqual(checkImports("src/main.js", 'import App from "./App.vue";\nexport * from "./nope.js";', () => false).length, 2, "JS files and re-exports too");
  assert.deepEqual(checkImports("src/App.vue", "<template><div></template>", exists), [], "syntax errors are checkFile's job");
});

test("usePager lists and call names must exist in the registry (checked when imported from the client)", () => {
  const app = (script: string) => vue(`import { usePager, call } from "./genesis/hl.js";\n${script}`);
  const none = () => false;
  assert.deepEqual(checkImports("src/App.vue", app("const a = usePager('contacts');\nconst b = usePager(\"messages\", () => ({}));\ncall('getContact', { contactId: 'x' });"), none), []);
  const [list, callProblem, ...rest] = checkImports("src/App.vue", app("const a = usePager('invoices');\ncall('deleteContact', { contactId: 'x' });"), none);
  assert.match(list!, /^usePager\('invoices'\) isn't a HighLevel list; available: .*\bcontacts\b.*\bmessages\b/);
  assert.match(callProblem!, /^call\('deleteContact'\) isn't a HighLevel call; available: .*\bgetContact\b/);
  assert.deepEqual(rest, []);
  assert.deepEqual(checkImports("src/utils.js", "export const call = (x) => x;\ncall('anything');", none), [], "a function of the app's own named call is not checked");
});
