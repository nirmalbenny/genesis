import { test } from "node:test";
import assert from "node:assert/strict";
import { createFieldReader } from "./toolInput";

/** Feeds `json` in chunks of `n` (or the given cut points) and returns each field's text as streamed, and when each ended. */
function read(json: string, cuts: number | number[]) {
  const fields: Record<string, string> = {};
  const ended: string[] = [];
  const r = createFieldReader((key, text, done) => {
    fields[key] = (fields[key] ?? "") + text;
    if (done) ended.push(key);
  });
  const points = typeof cuts === "number" ? Array.from({ length: Math.ceil(json.length / cuts) }, (_, i) => i * cuts) : cuts;
  const at = [...new Set([0, ...points, json.length])].sort((a, b) => a - b);
  for (let i = 0; i < at.length - 1; i++) r.push(json.slice(at[i], at[i + 1]));
  return { fields, ended };
}

const SAMPLES: Record<string, string>[] = [
  { path: "src/App.vue", content: "<template>\n  <div class=\"x\">{{ a }}</div>\n</template>\n" },
  { path: "src/utils.js", content: "export const q = \"\\\\d+\";\t// tab\r\nconst s = '/'; // é ü ✓ 🚀 \u0000 \u001f  \n" },
  { content: "content before path \"quoted\"", path: "src/B.vue" },
  { path: "src/x.js", content: "" },
  { path: "src/big.vue", content: "line \"q\" \\ / \n".repeat(1500) },
];

test("every field decodes exactly as JSON.parse would, whatever the chunking", () => {
  for (const input of SAMPLES) {
    const json = JSON.stringify(input);
    for (const n of [1, 2, 3, 5, 7, 64, json.length]) {
      const { fields, ended } = read(json, n);
      assert.deepEqual(fields, input, `chunks of ${n}`);
      assert.deepEqual(ended, Object.keys(input), "each field reports its end");
    }
  }
});

test("random cut points, including inside escapes and surrogate pairs", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let run = 0; run < 500; run++) {
    const input = SAMPLES[run % SAMPLES.length]!;
    const json = JSON.stringify(input);
    const cuts = Array.from({ length: 1 + Math.floor(rand() * 20) }, () => Math.floor(rand() * json.length));
    assert.deepEqual(read(json, cuts).fields, input, `run ${run}: ${cuts}`);
  }
});

test("pretty-printed JSON, escaped keys and non-string values are followed or skipped", () => {
  const json = '{\n  "n": 3,\n  "list": ["a\\"]", {"x": "}"}],\n  "ok": true,\n  "pa\\u0074h": "src/A.vue",\n  "content": "hi"\n}';
  assert.deepEqual(read(json, 3).fields, { path: "src/A.vue", content: "hi" });
});

test("text is reported as it arrives, not only at the end", () => {
  const seen: string[] = [];
  const r = createFieldReader((key, text) => { if (key === "content") seen.push(text); });
  r.push('{"path":"src/A.vue","content":"abc');
  assert.deepEqual(seen, ["abc"]);
  r.push('\\n');
  assert.deepEqual(seen, ["abc", "\n"]);
  r.push('\\u00');
  assert.deepEqual(seen, ["abc", "\n"], "an incomplete escape is held");
  r.push('e9"}');
  assert.deepEqual(seen, ["abc", "\n", "é"]);
});

test("a cut-off input reports what arrived and never throws", () => {
  const { fields, ended } = read('{"path":"src/A.vue","content":"<templ', 4);
  assert.deepEqual(fields, { path: "src/A.vue", content: "<templ" });
  assert.deepEqual(ended, ["path"]);
  assert.doesNotThrow(() => read("not json at all", 3));
});
