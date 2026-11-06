<script setup>
import { ref, onMounted, computed } from "vue";
import { hlGet, LOCATION_ID } from "../api.js";
import { fmtDateTime, parseDate } from "../utils.js";
import LoadState from "./LoadState.vue";

const props = defineProps({ contactId: { type: String, default: "" } });

const messages = ref([]);
const loading = ref(false);
const error = ref("");

const ordered = computed(() =>
  [...messages.value].sort((a, b) => {
    const da = parseDate(a.dateAdded)?.getTime() ?? 0;
    const db = parseDate(b.dateAdded)?.getTime() ?? 0;
    return da - db;
  })
);

function typeLabel(m) {
  return String(m.messageType || "")
    .replace(/^TYPE_/, "")
    .replace(/_/g, " ")
    .toLowerCase();
}

async function load() {
  messages.value = [];
  if (!props.contactId) return;
  loading.value = true;
  error.value = "";
  try {
    const conv = await hlGet("/conversations/search", {
      locationId: LOCATION_ID,
      contactId: props.contactId,
      limit: 1,
      sortBy: "last_message_date",
      sort: "desc",
    });
    const latest = Array.isArray(conv.conversations) ? conv.conversations[0] : null;
    if (!latest || !latest.id) return;
    const data = await hlGet(`/conversations/${encodeURIComponent(latest.id)}/messages`, {
      limit: 10,
    });
    const list = data?.messages?.messages;
    messages.value = Array.isArray(list) ? list : [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="card">
    <h3>Recent messages</h3>
    <LoadState
      :loading="loading"
      :error="error"
      :empty="!messages.length"
      loading-text="Loading messages…"
      empty-title="No messages yet"
      empty-text="There is no conversation history with this contact."
      @retry="load"
    >
      <ul class="msgs">
        <li v-for="m in ordered" :key="m.id" :class="['msg', m.direction === 'outbound' ? 'out' : 'in']">
          <div class="bubble">{{ m.body || "(no text content)" }}</div>
          <div class="meta muted">
            {{ m.direction === "outbound" ? "Sent" : "Received" }}
            <template v-if="typeLabel(m)"> · {{ typeLabel(m) }}</template>
            · {{ fmtDateTime(m.dateAdded) }}
          </div>
        </li>
      </ul>
    </LoadState>
  </section>
</template>

<style scoped>
h3 {
  margin: 0 0 12px;
  font-size: 16px;
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
  background: #f5f8fa;
  border: 1px solid var(--border);
}
.out .bubble {
  background: #fff1ed;
  border-color: #ffd5c9;
}
.meta {
  font-size: 12px;
  margin-top: 4px;
}
</style>