<script setup>
import { computed, onMounted, watch } from "vue";
import SectionCard from "./SectionCard.vue";
import { Avatar, Badge } from "../genesis/ui";
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
    <li v-for="(c, i) in conversations" :key="c.id || i" class="list-item">
      <Avatar :name="contactDisplayName(c)" />
      <div class="info">
        <div class="row" style="justify-content: space-between; flex-wrap: nowrap">
          <p class="truncate name">{{ contactDisplayName(c) }}</p>
          <span class="small muted" style="flex: none">{{ relativeTime(c.lastMessageDate) }}</span>
        </div>
        <p class="truncate small muted">{{ preview(c) }}</p>
      </div>
      <Badge v-if="c.unreadCount > 0">{{ c.unreadCount }}</Badge>
    </li>
  </ul>
  <p v-if="total > conversations.length" class="small muted" style="text-align: center">Showing {{ conversations.length }} of {{ total }}</p>
</SectionCard>
</template>

<style scoped>
.info {
  flex: 1;
  min-width: 0;
}
.name {
  font-weight: 600;
}
</style>
