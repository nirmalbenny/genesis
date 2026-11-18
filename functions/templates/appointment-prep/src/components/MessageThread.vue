<script setup>
import { computed } from "vue";
import { usePager, toDate } from "../genesis/hl.js";
import { fmtDateTime } from "../utils.js";
import LoadState from "./LoadState.vue";

const props = defineProps({ conversationId: { type: String, required: true } });

const { items, hasMore, loading, error, loadMore, reset } = usePager("messages", () => ({
  conversationId: props.conversationId,
  limit: 10,
}));

const ordered = computed(() =>
  [...items.value].sort((a, b) => {
    const da = toDate(a.dateAdded)?.getTime() ?? 0;
    const db = toDate(b.dateAdded)?.getTime() ?? 0;
    return da - db;
  })
);

function typeLabel(m) {
  return String(m.messageType || "")
    .replace(/^TYPE_/, "")
    .replace(/_/g, " ")
    .toLowerCase();
}
</script>

<template>
  <LoadState
    :loading="loading && !items.length"
    :error="error && !items.length ? error.message : ''"
    :empty="!items.length"
    loading-text="Loading messages…"
    empty-title="No messages yet"
    empty-text="There is no conversation history with this contact."
    @retry="reset"
  >
    <div class="thread">
      <div v-if="hasMore" class="more">
        <el-button :loading="loading" @click="loadMore">Load older messages</el-button>
      </div>
      <el-alert v-if="error" type="error" show-icon :closable="false" :title="error.message" />
      <p class="count">Showing {{ items.length }} message{{ items.length === 1 ? "" : "s" }}</p>
      <ul class="msgs">
        <li v-for="m in ordered" :key="m.id" :class="['msg', m.direction === 'outbound' ? 'out' : 'in']">
          <div class="bubble">{{ m.body || "(no text content)" }}</div>
          <div class="meta">
            {{ m.direction === "outbound" ? "Sent" : "Received" }}
            <template v-if="typeLabel(m)"> · {{ typeLabel(m) }}</template>
            · {{ fmtDateTime(m.dateAdded) }}
          </div>
        </li>
      </ul>
    </div>
  </LoadState>
</template>

<style scoped>
.thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.more {
  display: flex;
  justify-content: center;
}
.count {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.msgs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg {
  display: flex;
  flex-direction: column;
  max-width: 88%;
}
.msg.in {
  align-self: flex-start;
}
.msg.out {
  align-self: flex-end;
  align-items: flex-end;
}
.bubble {
  padding: 10px 14px;
  border-radius: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}
.out .bubble {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}
.meta {
  font-size: 12px;
  margin-top: 4px;
  color: var(--el-text-color-secondary);
}
</style>
