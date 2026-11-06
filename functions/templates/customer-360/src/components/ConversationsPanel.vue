<template>
  <div class="card">
    <h2 class="card-title">
      Conversations
      <span v-if="!loading && !error" class="count">{{ conversations.length }}</span>
    </h2>

    <StateBlock
      :loading="loading"
      :error="error"
      :empty="!conversations.length"
      empty-text="No conversations with this contact yet."
      loading-text="Loading conversations…"
      @retry="loadConversations"
    >
      <ul class="convos">
        <li v-for="(cv, i) in conversations" :key="cv.id" class="convo" :class="{ latest: i === 0 }">
          <div class="row">
            <span class="badge" :class="{ hot: i === 0 }">{{ i === 0 ? "Most recent" : typeLabel(cv.lastMessageType) }}</span>
            <span class="when muted">{{ fmtDateTime(cv.lastMessageDate) }}</span>
          </div>
          <p class="preview">{{ cv.lastMessageBody || "No message text" }}</p>
          <span v-if="cv.unreadCount" class="unread">{{ cv.unreadCount }} unread</span>
        </li>
      </ul>

      <div class="thread-wrap">
        <h3 class="sub">Latest messages</h3>
        <StateBlock
          :loading="msgLoading"
          :error="msgError"
          :empty="!messages.length"
          empty-text="No messages in the most recent conversation."
          loading-text="Loading messages…"
          @retry="loadMessages"
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
                <em v-else class="muted">{{ typeLabel(m.messageType) }} (no text)</em>
              </div>
              <div class="meta muted">
                {{ m.direction === "outbound" ? "Sent" : "Received" }} · {{ fmtDateTime(m.dateAdded) }}
                <template v-if="m.messageType"> · {{ typeLabel(m.messageType) }}</template>
              </div>
            </div>
          </div>
        </StateBlock>
      </div>
    </StateBlock>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { hl, LOCATION_ID } from "../api.js";
import { fmtDateTime, toDate } from "../utils.js";
import StateBlock from "./StateBlock.vue";

const props = defineProps({ contactId: { type: String, required: true } });

const conversations = ref([]);
const loading = ref(false);
const error = ref("");

const messages = ref([]);
const msgLoading = ref(false);
const msgError = ref("");

let convReq = 0;
let msgReq = 0;

function typeLabel(t) {
  if (!t) return "Message";
  return String(t)
    .replace(/^TYPE_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

async function loadConversations() {
  const id = ++convReq;
  loading.value = true;
  error.value = "";
  conversations.value = [];
  messages.value = [];
  msgError.value = "";
  try {
    const data = await hl("/conversations/search", {
      locationId: LOCATION_ID,
      limit: 20,
      contactId: props.contactId,
      status: "all",
      sortBy: "last_message_date",
      sort: "desc",
    });
    if (id !== convReq) return;
    const list = Array.isArray(data.conversations) ? data.conversations.slice() : [];
    list.sort((a, b) => {
      const ta = (toDate(a.lastMessageDate) || new Date(0)).getTime();
      const tb = (toDate(b.lastMessageDate) || new Date(0)).getTime();
      return tb - ta;
    });
    conversations.value = list;
    loading.value = false;
    if (list.length) loadMessages();
  } catch (e) {
    if (id !== convReq) return;
    error.value = e.message;
    loading.value = false;
  }
}

async function loadMessages() {
  const first = conversations.value[0];
  if (!first) return;
  const id = ++msgReq;
  msgLoading.value = true;
  msgError.value = "";
  messages.value = [];
  try {
    const data = await hl(`/conversations/${encodeURIComponent(first.id)}/messages`, { limit: 10 });
    if (id !== msgReq) return;
    const raw = data.messages && Array.isArray(data.messages.messages) ? data.messages.messages : [];
    const sorted = raw.slice().sort((a, b) => {
      const ta = (toDate(a.dateAdded) || new Date(0)).getTime();
      const tb = (toDate(b.dateAdded) || new Date(0)).getTime();
      return ta - tb;
    });
    messages.value = sorted.slice(-10);
  } catch (e) {
    if (id !== msgReq) return;
    msgError.value = e.message;
  } finally {
    if (id === msgReq) msgLoading.value = false;
  }
}

watch(() => props.contactId, loadConversations, { immediate: true });
</script>

<style scoped>
.convos {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.convo {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}

.convo.latest {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.badge.hot {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.when {
  font-size: 0.8rem;
}

.preview {
  margin: 6px 0 0;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.unread {
  display: inline-block;
  margin-top: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--accent);
}

.sub {
  margin: 0 0 8px;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg);
  border-radius: 10px;
  padding: 14px;
  max-height: 420px;
  overflow-y: auto;
}

.msg {
  display: flex;
  flex-direction: column;
  max-width: 82%;
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
  background: #fff;
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}

.out .bubble {
  background: var(--accent);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.out .bubble .muted {
  color: #fff;
}

.meta {
  font-size: 0.72rem;
  margin-top: 3px;
}
</style>