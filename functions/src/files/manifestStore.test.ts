import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileOp } from "../llm/validate";
import { createLru } from "./blobStore";
import { entryFor, nextManifest, uploadsFor } from "./manifestStore";

const write = (path: string, content: string): FileOp => ({ type: "write", path, content });
const entries = (ops: FileOp[]) =>
  new Map(ops.flatMap((o) => (o.type === "write" ? [[o.path, entryFor(o.path, o.content)] as const] : [])));

test("applying ops to a manifest: writes add or replace entries, deletes remove them", () => {
  const current = { "src/App.vue": entryFor("src/App.vue", "a"), "src/Old.vue": entryFor("src/Old.vue", "o") };
  const ops: FileOp[] = [write("src/App.vue", "a2"), write("src/New.vue", "n"), { type: "delete", path: "src/Old.vue" }];
  const next = nextManifest(current, ops, entries(ops));
  assert.deepEqual(Object.keys(next).sort(), ["src/App.vue", "src/New.vue"]);
  assert.equal(next["src/App.vue"]!.hash, entryFor("src/App.vue", "a2").hash);
  assert.equal(current["src/Old.vue"] !== undefined, true, "the input manifest is not mutated");
});

test("only changed content is uploaded, and identical content once (dedupe)", () => {
  const current = { "src/App.vue": entryFor("src/App.vue", "same"), "src/B.vue": entryFor("src/B.vue", "b") };
  const ops: FileOp[] = [
    write("src/App.vue", "same"), // unchanged: no upload
    write("src/B.vue", "b2"), // changed
    write("src/C.vue", "b2"), // same content as B: one upload
    write("src/D.vue", "b"), // B's content before this change: already stored, so no upload
  ];
  const uploads = uploadsFor(current, ops, entries(ops));
  assert.deepEqual([...uploads.values()], ["b2"]);
});

test("entries carry the hash and the file's metadata", () => {
  const e = entryFor("src/components/List.vue", "<script setup>defineProps(['query'])</script>");
  assert.equal(e.hash.length, 64);
  assert.deepEqual(e.props, ["query"]);
});

test("the blob cache keeps the most recently used entries within its byte budget", () => {
  const lru = createLru(10);
  lru.set("a", "1234");
  lru.set("b", "1234");
  assert.equal(lru.get("a"), "1234"); // a is now most recent
  lru.set("c", "1234"); // 12 bytes > 10: evicts b, the least recently used
  assert.equal(lru.get("b"), undefined);
  assert.equal(lru.get("a"), "1234");
  assert.equal(lru.get("c"), "1234");
  lru.set("huge", "x".repeat(11)); // larger than the whole cache: not cached
  assert.equal(lru.get("huge"), undefined);
  assert.equal(lru.size, 2);
});
