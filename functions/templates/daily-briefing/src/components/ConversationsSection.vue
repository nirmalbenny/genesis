<script setup>
import { computed, onMounted, watch } from "vue";
import SectionCard from "./SectionCard.vue";
import { hlGet, LOCATION_ID } from "../api.js";
import { useResource } from "../useResource.js";
import { relativeTime, contactDisplayName } from "../utils.js";

const props = defineProps({ refreshKey: { type: Number, default: 0 } });
const emit = defineEmits(["count"]);

async function fetchUnread() {
  const res = await hlGet("/conversations/search", {
    locationId: LOCATION_ID,
    status: "unread",
    sortBy: "last_message_date",
    sort: "desc",
    limit: 20,
  });
  const conversations = Array.isArray(res.conversations) ? res.conversations : [];
  const total = typeof res.total === "number" ? res.total : conversations.length;
  return { conversations, total };
}

const { data, loading, error, load } = useResource(fetchUnread);
const conversations = computed(() => (data.value ? data.value.conversations : []));
const total = computed(() => (data.value ? Math.max(data.value.total, conversations.value.length) : 0));

onMounted(load);
watch(() => props.refreshKey, load);
watch(
  [data, loading, error],
  () => {
    emit("count", !loading.value && !error.value && data.value ? total.value : null);
  },
  { immediate: true }
);

function preview(c) {
  const body = c.lastMessageBody && String(c.lastMessageBody).trim();
  if (body) return body;
  return "No message preview";
}
</script>

<template>
  <SectionCard
    title="Unread conversations"
    :loading="loading"
    :error="error"
    :empty="conversations.length === 0"
    empty-text="You're all caught up — no unread conversations."
    empty-icon="💬"
    :badge="total"
    @retry="load"
  >
    <ul class="list">
      <li v-for="(c, i) in conversations" :key="c.id || i" class="row">
        <div class="avatar">{{ (contactDisplayName(c).match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase() }}</div>
        <div class="info">
          <div class="top">
            <p class="name">{{ contactDisplayName(c) }}</p>
            <span class="when">{{ relativeTime(c.lastMessageDate) }}</span>
          </div>
          <p class="preview">{{ preview(c) }}</p>
        </div>
        <span v-if="c.unreadCount > 0" class="unread">{{ c.unreadCount }}</span>
      </li>
    </ul>
    <p v-if="total > conversations.length" class="more">Showing {{ conversations.length }} of {{ total }}</p>
  </SectionCard>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #eaeef3;
  border-radius: 8px;
}
.avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #fff1ed;
  color: #ff5c35;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.info {
  flex: 1;
  min-width: 0;
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.name {
  margin: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when {
  flex: none;
  font-size: 12px;
  color: #516f90;
}
.preview {
  margin: 2px 0 0;
  font-size: 13px;
  color: #516f90;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.unread {
  flex: none;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: #ff5c35;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.more {
  margin: 12px 0 0;
  font-size: 12px;
  color: #516f90;
  text-align: center;
}
</style>