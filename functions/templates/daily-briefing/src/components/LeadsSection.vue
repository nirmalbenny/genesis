<script setup>
import { computed, watch } from "vue";
import SectionCard from "./SectionCard.vue";
import LoadMoreBar from "./LoadMoreBar.vue";
import { usePager, contactName, toDate } from "../genesis/hl.js";
import { relativeTime, initials } from "../utils.js";

const props = defineProps({ refreshKey: { type: Number, default: 0 } });
const emit = defineEmits(["count"]);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const { items, hasMore, loading, error, loadMore, reset } = usePager("contacts", () => ({
  sortBy: "date_added",
  order: "desc",
  limit: 20,
}));

const initialLoading = computed(() => loading.value && items.value.length === 0);

// Contacts come newest first, so recent leads are a prefix of what is loaded.
const leads = computed(() => {
  const cutoff = Date.now() - WEEK_MS;
  return items.value.filter((c) => {
    const d = toDate(c && c.dateAdded);
    return d && d.getTime() >= cutoff;
  });
});
// More recent leads may exist only if every loaded contact is recent and more pages exist.
const maybeMore = computed(() => hasMore.value && leads.value.length === items.value.length);
const countText = computed(() => (maybeMore.value ? `${leads.value.length}+` : leads.value.length));

watch(() => props.refreshKey, reset);
watch(
  [leads, maybeMore, loading, error],
  () => {
    emit("count", initialLoading.value || error.value ? null : countText.value);
  },
  { immediate: true }
);

function source(c) {
  return (c && (c.source || c.attributionSource?.medium)) || "Unknown source";
}
function tags(c) {
  return Array.isArray(c && c.tags) ? c.tags.filter(Boolean) : [];
}
function nameOf(c) {
  return contactName(c) || "Unnamed contact";
}
</script>

<template>
<SectionCard
  title="New leads"
  :loading="initialLoading"
  :error="error && items.length === 0 ? error.message : ''"
  :empty="leads.length === 0"
  empty-text="No new leads in the last 7 days."
  :badge="countText"
  @retry="reset"
>
  <div v-for="(c, i) in leads" :key="c.id || i" class="item">
    <el-avatar>{{ initials(nameOf(c)) }}</el-avatar>
    <div class="info">
      <div class="top">
        <span class="name">{{ nameOf(c) }}</span>
        <span class="muted when">{{ relativeTime(c.dateAdded) }}</span>
      </div>
      <div class="muted source">{{ source(c) }}</div>
      <div v-if="tags(c).length" class="tags">
        <el-tag v-for="t in tags(c).slice(0, 3)" :key="t" size="small" type="info">{{ t }}</el-tag>
        <el-tag v-if="tags(c).length > 3" size="small" effect="plain" type="info">+{{ tags(c).length - 3 }}</el-tag>
      </div>
    </div>
  </div>
  <el-alert v-if="error && items.length" type="error" show-icon :closable="false" :title="error.message" />
  <LoadMoreBar
    :shown="leads.length"
    :has-more="maybeMore"
    :loading="loading"
    noun="new leads"
    @more="loadMore"
  />
</SectionCard>
</template>

<style scoped>
.item {
  display: flex;
  align-items: flex-start;
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
.source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
