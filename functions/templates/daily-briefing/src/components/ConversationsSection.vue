<script setup>
import { computed, watch } from "vue";
import SectionCard from "./SectionCard.vue";
import LoadMoreBar from "./LoadMoreBar.vue";
import { usePager, contactName } from "../genesis/hl.js";
import { relativeTime, initials } from "../utils.js";

const props = defineProps({ refreshKey: { type: Number, default: 0 } });
const emit = defineEmits(["count"]);

const { items, total, hasMore, loading, error, loadMore, reset } = usePager("conversations", () => ({
  status: "unread",
  limit: 20,
}));

const initialLoading = computed(() => loading.value && items.value.length === 0);
const shownTotal = computed(() => (typeof total.value === "number" ? Math.max(total.value, items.value.length) : null));

watch(() => props.refreshKey, reset);
watch(
  [items, total, loading, error],
  () => {
    const ready = !initialLoading.value && !error.value;
    emit("count", ready ? (shownTotal.value ?? items.value.length) : null);
  },
  { immediate: true }
);

function preview(c) {
  const body = c && c.lastMessageBody && String(c.lastMessageBody).trim();
  return body || "No message preview";
}
function nameOf(c) {
  return contactName(c) || "Unnamed contact";
}
</script>

<template>
<SectionCard
  title="Unread conversations"
  :loading="initialLoading"
  :error="error && items.length === 0 ? error.message : ''"
  :empty="items.length === 0"
  empty-text="You're all caught up — no unread conversations."
  :badge="shownTotal ?? items.length"
  @retry="reset"
>
  <div v-for="(c, i) in items" :key="c.id || i" class="item">
    <el-avatar>{{ initials(nameOf(c)) }}</el-avatar>
    <div class="info">
      <div class="top">
        <span class="name">{{ nameOf(c) }}</span>
        <span class="muted when">{{ relativeTime(c.lastMessageDate) }}</span>
      </div>
      <div class="muted preview">{{ preview(c) }}</div>
    </div>
    <el-tag v-if="c.unreadCount > 0" type="primary" round>{{ c.unreadCount }}</el-tag>
  </div>
  <el-alert v-if="error && items.length" type="error" show-icon :closable="false" :title="error.message" />
  <LoadMoreBar
    :shown="items.length"
    :total="shownTotal"
    :has-more="hasMore"
    :loading="loading"
    noun="conversations"
    @more="loadMore"
  />
</SectionCard>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.item:last-of-type {
  border-bottom: 0;
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
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when {
  flex: none;
}
.preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
