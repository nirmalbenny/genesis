import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, describeFile } from "./describe";

test("content hash is the hex SHA-256 of the text", () => {
  assert.equal(contentHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("describes a script-setup component: props, emits, imports and client helpers", () => {
  const src = `<template>
  <button @click="$emit('refresh')">{{ title }}</button>
</template>
<script setup>
import { computed } from "vue";
import ContactRow from "./ContactRow.vue";
import { formatDate } from "../utils.js";
import { usePager, contactName as name } from "../genesis/hl.js";
const props = defineProps({ query: String, limit: { type: Number, default: 20 }, title: String });
const emit = defineEmits(["select", "close"]);
function pick(c) { emit("select", c.id); }
</script>`;
  assert.deepEqual(describeFile("src/components/ContactList.vue", src), {
    size: Buffer.byteLength(src),
    lines: 12,
    props: ["query", "limit", "title"],
    emits: ["select", "close", "refresh"],
    imports: ["src/components/ContactRow.vue", "src/utils.js"],
    hlHelpers: ["usePager", "contactName"],
  });
});

test("reads type-based props and emits, including arrow types and optional keys", () => {
  const src = `<script setup lang="ts">
const props = withDefaults(defineProps<{ contactId: string; onPick?: (id: string) => void; tags: Array<string> }>(), {});
const emit = defineEmits<{ (e: 'saved', id: string): void; (e: 'cancel'): void }>();
</script>`;
  const meta = describeFile("src/components/Form.vue", src);
  assert.deepEqual(meta.props, ["contactId", "onPick", "tags"]);
  assert.deepEqual(meta.emits, ["saved", "cancel"]);
});

test("array props, plain JS files and files without any of it", () => {
  assert.deepEqual(describeFile("src/A.vue", "<script setup>defineProps(['a', 'b'])</script>").props, ["a", "b"]);
  const js = describeFile("src/main.js", 'import { createApp } from "vue";\nimport App from "./App.vue";\nimport "./genesis/ui.css";\n');
  assert.deepEqual(js.imports, ["src/App.vue"], "packages and system files are not project imports");
  assert.deepEqual(js.hlHelpers, []);
  assert.deepEqual(describeFile("src/x.css", "").lines, 0);
});
