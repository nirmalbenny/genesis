<template>
  <StateBlock
    :loading="loading"
    :error="error"
    :empty="!messages.length"
    empty-text="No messages in the most recent conversation."
    loading-text="Loading messages…"
    @retry="load"
  >
    <div class="thread">
      <div
        v-for="m in messages"
        :key="m.id || m.dateAdded + m.body"
        class="msg"
        :class="m.direction === 'outbound' ? 'out' : 'in'"
      >
        <div class="bubble">
          <span v-if="m.body">{{ m.body }}</span>
          <em v-else>{{ typeLabel(m.messageType) }} (no text)</em>
        </div>
        <div class="meta">
          {{ m.direction === "outbound" ? "Sent" : "Received" }} · {{ fmtDateTime(m.dateAdded) }}
          <template v-if="m.messageType"> · {{ typeLabel(m.messageType) }}</template>
        </div>
      </div>
    </div>
  </StateBlock>
</template>

<script setup>
import { ref, watch } from "vue";
import { hlGet, toDate } from "../genesis/hl.js";
import { fmtDateTime, typeLabel } from "../utils.js";
import StateBlock from "./StateBlock.vue";

const props = defineProps({ conversationId: { type: String, required: true } });

const messages = ref([]);
const loading = ref(false);
const error = ref("");
let reqId = 0;

async function load() {
  const id = ++reqId;
  loading.value = true;
  error.value = "";
  messages.value = [];
  try {
    const data = await hlGet(`/conversations/${encodeURIComponent(props.conversationId)}/messages`, { limit: 10 });
    if (id !== reqId) return;
    const raw = data && data.messages && Array.isArray(data.messages.messages) ? data.messages.messages : [];
    const time = (m) => (toDate(m.dateAdded) || new Date(0)).getTime();
    messages.value = raw.slice().sort((a, b) => time(a) - time(b)).slice(-10);
  } catch (e) {
    if (id !== reqId) return;
    error.value = e.message;
  } finally {
    if (id === reqId) loading.value = false;
  }
}

watch(() => props.conversationId, load, { immediate: true });
</script>

<style scoped>
.thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 12px;
  max-height: 420px;
  overflow-y: auto;
}
.msg {
  display: flex;
  flex-direction: column;
  max-width: 85%;
}
.msg.in {
  align-self: flex-start;
  align-items: flex-start;
}
.msg.out {
  align-self: flex-end;
  align-items: flex-end;
}
.bubble {
  padding: 8px 12px;
  border-radius: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.in .bubble {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
}
.out .bubble {
  background: var(--el-color-primary);
  color: var(--app-on-primary);
}
.meta {
  font-size: 12px;
  margin-top: 3px;
  color: var(--el-text-color-secondary);
}
</style>
