import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanContent, createParser, type ParseEvent } from "./parser";
import { NOT_READ, validateOps } from "./validate";

const CHUNKS = [1, 2, 3, 5, 7, 13, 100_000];
// Tool-call markup is built here rather than written out, so it never appears literally in this file.
const tool = (name: string, { close = true, ns = "", attrs = "" } = {}) => `<${close ? "/" : ""}${ns}${name}${attrs}>`;

type Result = {
  files: Record<string, string>;
  deletes: string[];
  plan: string;
  refuse: string | null;
  fixups: string[];
  unclosed: string | null;
  /** What the editor received for each file while streaming. */
  streamed: Record<string, string>;
};

function parseOnce(text: string, size: number, complete: boolean): Result {
  const r: Result = { files: {}, deletes: [], plan: "", refuse: null, fixups: [], unclosed: null, streamed: {} };
  const p = createParser((e: ParseEvent) => {
    if (e.type === "token") {
      if (e.path === null) r.plan += e.text;
      else r.streamed[e.path] = (r.streamed[e.path] ?? "") + e.text;
    } else if (e.type === "file_end") r.files[e.path] = e.content;
    else if (e.type === "delete") r.deletes.push(e.path);
    else if (e.type === "refuse") r.refuse = e.reason;
    else if (e.type === "fixup") r.fixups.push(`${e.path}:${e.fix}`);
  });
  for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size));
  r.unclosed = p.end({ complete });
  r.plan = r.plan.trim();
  return r;
}

/** Parses `text` in every chunking and checks they all agree: tags split anywhere must not change the result. */
function parse(text: string, { complete = true } = {}): Result {
  const [first, ...rest] = CHUNKS.map((size) => parseOnce(text, size, complete));
  for (const [i, r] of rest.entries()) assert.deepEqual(r, first, `chunk size ${CHUNKS[i + 1]} differs from size 1`);
  return first!;
}

const file = (path: string, body: string) => `<file path="${path}">\n${body}\n</file>`;

// ---- The format ----

test("plan, files and deletes parse identically in any chunking", () => {
  const r = parse(`<plan>Build it.</plan>\n${file("src/App.vue", "<template><div>a < b</div></template>")}\n<delete path="src/old.vue"/>`);
  assert.deepEqual(r.files, { "src/App.vue": "<template><div>a < b</div></template>" });
  assert.deepEqual(r.deletes, ["src/old.vue"]);
  assert.equal(r.plan, "Build it.");
  assert.deepEqual(r.fixups, []);
  assert.equal(r.unclosed, null);
});

test("the editor receives the file as it streams, without the tags", () => {
  const r = parse(file("src/a.js", "export const a = 1;"));
  assert.equal(r.streamed["src/a.js"], "export const a = 1;\n");
});

test("CRLF line endings are kept inside files and trimmed at the edges", () => {
  const r = parse('<file path="src/a.js">\r\nconst a = 1;\r\nconst b = 2;\r\n</file>');
  assert.deepEqual(r.files, { "src/a.js": "const a = 1;\r\nconst b = 2;" });
});

test("the refuse tag is swallowed and reported, never streamed", () => {
  const r = parse("<refuse>not about the app</refuse>");
  assert.equal(r.refuse, "not about the app");
  assert.equal(r.plan, "");
});

test("tag variants: single quotes, spaces around =, a delete without the slash or with a close tag", () => {
  const r = parse(`<file path='src/a.js'>\na\n</file>\n<file  path = "src/b.js" >\nb\n</file>\n<delete path='src/c.js'>\n<delete path="src/d.js"></delete>`);
  assert.deepEqual(r.files, { "src/a.js": "a", "src/b.js": "b" });
  assert.deepEqual(r.deletes, ["src/c.js", "src/d.js"]);
  assert.equal(r.plan, "", "no tag text leaks into the chat");
});

test("a stray file close outside any file is swallowed", () => {
  const r = parse(`${file("src/a.js", "a")}\n</file>\n<plan>Done.</plan>`);
  assert.deepEqual(r.files, { "src/a.js": "a" });
  assert.equal(r.plan, "Done.");
});

// ---- Content that looks like tags but isn't ours is kept ----

test("source that contains tag-like text is kept as is", () => {
  const bodies = [
    'const xml = "<file path=\\"x\\">";\nexport default xml;', // a file tag inside code, not at a line start
    "<template>\n  <file-upload />\n  <plan-card>\n    <plan>Pro</plan>\n  </plan-card>\n  <delete-button />\n</template>", // components named like our tags
    "<template>\n  <refuse>no</refuse>\n</template>",
    "<template>\n  <p>x</p>\n</template>", // ends in a closing tag
    "if (a<b && c>d) run();", // comparisons
    `const s = "${tool("invoke")}";\nexport default s;`, // tool markup inside a string, not a whole line
    "<template>\n  <parameter-list :items=\"x\" />\n</template>", // a component whose name starts like the markup
  ];
  for (const body of bodies) {
    const r = parse(file("src/x.vue", body));
    assert.deepEqual(r.files, { "src/x.vue": body }, body);
    assert.deepEqual(r.fixups, [], body);
  }
});

// ---- Repairs ----

test("a file not closed before the next file is closed there (missing_close)", () => {
  const r = parse(`<plan>p</plan>\n<file path="src/a.js">\nexport const a = 1;\n${file("src/b.js", "export const b = 2;")}`);
  assert.deepEqual(r.files, { "src/a.js": "export const a = 1;", "src/b.js": "export const b = 2;" });
  assert.deepEqual(r.fixups, ["src/a.js:missing_close"]);
});

test("a file not closed before a delete is closed there too; mid-line tags are content", () => {
  const r = parse('<file path="src/a.js">\na\n<delete path="src/old.js"/>\n<file path="src/b.js">\nconst t = \'<file path="x">\';\n</file>');
  assert.deepEqual(r.files, { "src/a.js": "a", "src/b.js": "const t = '<file path=\"x\">';" });
  assert.deepEqual(r.deletes, ["src/old.js"]);
  assert.deepEqual(r.fixups, ["src/a.js:missing_close"]);
});

test("known limit: a literal </file> in source ends the file there", () => {
  const r = parse('<file path="src/a.js">\nconst s = "</file>";\n</file>', { complete: false });
  assert.deepEqual(r.files, { "src/a.js": 'const s = "' });
});

test("the last file left open: kept when the model finished, reported when the stream was cut off", () => {
  const text = '<plan>p</plan>\n<file path="src/a.js">\nexport const a = 1;\n';
  const finished = parse(text, { complete: true });
  assert.deepEqual(finished.files, { "src/a.js": "export const a = 1;" });
  assert.deepEqual(finished.fixups, ["src/a.js:missing_close"]);
  assert.equal(finished.unclosed, null);

  const cut = parse(text, { complete: false });
  assert.deepEqual(cut.files, {});
  assert.equal(cut.unclosed, "src/a.js");
});

test("leaked tool-call markup lines are removed (tool_markup), wherever they are", () => {
  const cases: [string, string][] = [
    // seen in production (2026-11-18): utils.js ended with a parameter close and an invoke close
    [`export const a = 1;\n${tool("parameter")}\n${tool("invoke")}`, "export const a = 1;"],
    [`export const a = 1;\n${tool("parameter")}\n${tool("invoke")}\n${tool("function_calls")}`, "export const a = 1;"],
    [`export const a = 1;\n${tool("parameter", { ns: "x:" })}\n${tool("invoke", { ns: "x:" })}`, "export const a = 1;"],
    [`export const a = 1;${tool("parameter")}`, "export const a = 1;"], // on the last code line
    [`export const a = 1;\n  ${tool("parameter")}\nexport const b = 2;`, "export const a = 1;\nexport const b = 2;"], // mid-file
    [`${tool("parameter", { close: false, attrs: ' name="content"' })}\nexport const a = 1;`, "export const a = 1;"], // an opening tag
  ];
  for (const [body, expected] of cases) {
    const r = parse(file("src/utils.js", body));
    assert.deepEqual(r.files, { "src/utils.js": expected }, body);
    assert.deepEqual(r.fixups, ["src/utils.js:tool_markup"], body);
  }
});

test("a whole file wrapped in a markdown fence is unwrapped (fence); a fence inside code is kept", () => {
  for (const lang of ["js", "vue", "", "javascript"]) {
    const r = parse(file("src/a.js", `\`\`\`${lang}\nexport const a = 1;\n\`\`\``));
    assert.deepEqual(r.files, { "src/a.js": "export const a = 1;" }, lang);
    assert.deepEqual(r.fixups, ["src/a.js:fence"], lang);
  }
  const inner = "const md = `\n```js\nx\n```\n`;\nexport default md;";
  assert.deepEqual(parse(file("src/md.js", inner)).files, { "src/md.js": inner });
});

test("several slips in one file are all repaired and all reported", () => {
  const r = parse(`<file path="src/a.js">\n\`\`\`js\nexport const a = 1;\n\`\`\`\n${tool("parameter")}\n${file("src/b.js", "b")}`);
  assert.deepEqual(r.files, { "src/a.js": "export const a = 1;", "src/b.js": "b" });
  assert.deepEqual(r.fixups, ["src/a.js:missing_close", "src/a.js:tool_markup", "src/a.js:fence"]);
});

test("cleanContent leaves clean source untouched", () => {
  const src = "<script setup>\nimport { ref } from \"vue\";\n</script>\n\n<template>\n  <p>{{ n }}</p>\n</template>";
  assert.deepEqual(cleanContent(src), { content: src, fixes: [] });
});

// ---- Cut-off streams and read turns ----

test("a stream cut off mid-tag doesn't leak the half tag into the plan", () => {
  for (const tail of ['<file path="src/components/Contact', "<fi", "<", "</pl", "<delete pa"]) {
    const r = parse(`<plan>Build it.</plan>\n${tail}`, { complete: false });
    assert.equal(r.plan, "Build it.", tail);
    assert.equal(r.unclosed, null, tail);
  }
});

test("a stream cut off mid-close keeps the file's text but reports it unclosed", () => {
  const r = parse('<file path="src/a.js">\nexport const a = 1;\n</fi', { complete: false });
  assert.equal(r.unclosed, "src/a.js");
  assert.deepEqual(r.files, {});
});

test("a file still open when the model calls a tool is dropped, and the next turn starts outside it", () => {
  const events: ParseEvent[] = [];
  const p = createParser((e) => events.push(e));
  p.push('<plan>Plan.</plan>\n<file path="src/App.vue">\n<template>half');
  assert.equal(p.discardOpenFile(), "src/App.vue");
  assert.equal(p.discardOpenFile(), null);
  p.push(file("src/B.vue", "b"));
  assert.equal(p.end(), null);
  assert.deepEqual(events.filter((e) => e.type === "file_end"), [{ type: "file_end", path: "src/B.vue", content: "b" }]);
});

// ---- Validation ----

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

test("validateOps keeps src/genesis/ (the injected HighLevel client) system-owned", () => {
  const { valid, rejected } = validateOps(
    [
      { type: "write", path: "src/genesis/hl.js", content: "x" },
      { type: "write", path: "src/genesis/other.js", content: "x" },
      { type: "write", path: "src/hl.config.js", content: "x" },
      { type: "write", path: "src/genesisApp.vue", content: "x" },
    ],
    new Set(),
  );
  assert.deepEqual(valid.map((o) => o.path), ["src/genesisApp.vue"]);
  assert.ok(rejected.every((r) => r.reason === "path is system-owned"));
});

test("validateOps with `seen` rejects rewriting an existing file the model wasn't given", () => {
  const existing = new Set(["src/App.vue", "src/components/Big.vue", "src/components/Old.vue"]);
  const ops = [
    { type: "write" as const, path: "src/App.vue", content: "x" }, // seen: allowed
    { type: "write" as const, path: "src/components/Big.vue", content: "x" }, // existing, not seen: rejected
    { type: "write" as const, path: "src/components/New.vue", content: "x" }, // new file: allowed
    { type: "delete" as const, path: "src/components/Old.vue" }, // delete of an unseen file: allowed
  ];
  const { valid, rejected } = validateOps(ops, existing, new Set(["src/App.vue"]));
  assert.deepEqual(valid.map((o) => o.path), ["src/App.vue", "src/components/New.vue", "src/components/Old.vue"]);
  assert.deepEqual(rejected, [{ path: "src/components/Big.vue", reason: NOT_READ }]);
  // Without `seen` (templates, older callers) nothing changes.
  assert.equal(validateOps(ops, existing).rejected.length, 0);
});

test("random chunk boundaries never change the result (500 runs over a messy reply)", () => {
  const reply = [
    "<plan>Adds a list; a < b stays text.</plan>",
    file("src/App.vue", "<template>\n  <file-upload />\n  <p v-if=\"a<b\">x</p>\n</template>"),
    `<file path='src/utils.js'>\n\`\`\`js\nexport const a = 1;\n\`\`\`\n${tool("parameter")}\n${tool("invoke")}`,
    file("src/b.js", "export const b = '<file path=x>';"),
    '<delete path="src/old.js"/>',
  ].join("\n");
  const expected = parseOnce(reply, reply.length, true);
  assert.deepEqual(expected.files, {
    "src/App.vue": "<template>\n  <file-upload />\n  <p v-if=\"a<b\">x</p>\n</template>",
    "src/utils.js": "export const a = 1;",
    "src/b.js": "export const b = '<file path=x>';",
  });
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let run = 0; run < 500; run++) {
    const r: Result = { files: {}, deletes: [], plan: "", refuse: null, fixups: [], unclosed: null, streamed: {} };
    const p = createParser((e) => {
      if (e.type === "token" && e.path === null) r.plan += e.text;
      else if (e.type === "token") r.streamed[e.path!] = (r.streamed[e.path!] ?? "") + e.text;
      else if (e.type === "file_end") r.files[e.path] = e.content;
      else if (e.type === "delete") r.deletes.push(e.path);
      else if (e.type === "fixup") r.fixups.push(`${e.path}:${e.fix}`);
    });
    for (let i = 0; i < reply.length; ) {
      const n = 1 + Math.floor(rand() * 40);
      p.push(reply.slice(i, i + n));
      i += n;
    }
    r.unclosed = p.end({ complete: true });
    r.plan = r.plan.trim();
    assert.deepEqual(r, expected, `run ${run}`);
  }
});
