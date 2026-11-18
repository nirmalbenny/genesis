<template>
  <el-card shadow="never">
    <template #header>
      <div class="head">
        <span class="title">Conversations</span>
        <el-tag v-if="!loading && !error" size="small" type="info" round>{{ conversations.length }}</el-tag>
      </div>
    </template>

    <StateBlock
      :loading="loading"
      :error="error"
      :empty="!conversations.length"
      empty-text="No conversations with this contact yet."
      loading-text="Loading conversations…"
      @retry="load"
    >
      <div class="convos">
        <div v-for="(cv, i) in conversations" :key="cv.id" class="convo" :class="{ latest: i === 0 }">
          <div class="row">
            <el-tag size="small" :type="i === 0 ? 'primary' : 'info'">
              {{ i === 0 ? "Most recent" : typeLabel(cv.lastMessageType) }}
            </el-tag>
            <span class="when">{{ fmtDateTime(cv.lastMessageDate) }}</span>
          </div>
          <p class="preview">{{ cv.lastMessageBody || "No message text" }}</p>
          <el-tag v-if="cv.unreadCount" size="small" type="danger">{{ cv.unreadCount }} unread</el-tag>
        </div>
      </div>

      <h3 class="sub">Latest messages</h3>
      <MessageThread :conversation-id="conversations[0].id" />
    </StateBlock>
  </el-card>
</template>

<script setup>
import { ref, watch } from "vue";
import { hlGet, toDate, LOCATION_ID } from "../genesis/hl.js";
import { fmtDateTime, typeLabel } from "../utils.js";
import StateBlock from "./StateBlock.vue";
import MessageThread from "./MessageThread.vue";

const props = defineProps({ contactId: { type: String, required: true } });

const conversations = ref([]);
const loading = ref(false);
const error = ref("");
let reqId = 0;

async function load() {
  const id = ++reqId;
  loading.value = true;
  error.value = "";
  conversations.value = [];
  try {
    const data = await hlGet("/conversations/search", {
      locationId: LOCATION_ID,
      limit: 20,
      contactId: props.contactId,
      status: "all",
      sortBy: "last_message_date",
      sort: "desc",
    });
    if (id !== reqId) return;
    const list = data && Array.isArray(data.conversations) ? data.conversations.slice() : [];
    const time = (c) => (toDate(c.lastMessageDate) || new Date(0)).getTime();
    list.sort((a, b) => time(b) - time(a));
    conversations.value = list;
  } catch (e) {
    if (id !== reqId) return;
    error.value = e.message;
  } finally {
    if (id === reqId) loading.value = false;
  }
}

watch(() => props.contactId, load, { immediate: true });
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title {
  font-weight: 600;
}
.convos {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.convo {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 10px 12px;
}
.convo.latest {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.when {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.preview {
  margin: 6px 0;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sub {
  margin: 20px 0 8px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--el-text-color-secondary);
}
</style>
