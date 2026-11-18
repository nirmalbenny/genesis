<script setup>
import { ref, computed, watch } from "vue";
import { Search } from "@element-plus/icons-vue";
import { usePager, contactName } from "../genesis/hl.js";
import { initials } from "../utils.js";
import StatusBlock from "./StatusBlock.vue";

defineProps({ selectedId: { type: String, default: "" } });
const emit = defineEmits(["select", "loaded"]);

const search = ref("");
// Under 3 characters the server lists everything, so only send real queries.
const effective = computed(() => (search.value.trim().length >= 3 ? search.value.trim() : ""));

const { items, total, hasMore, loading, error, loadMore, reset } = usePager("contacts", () => ({
  query: effective.value,
  sortBy: "date_added",
  order: "desc",
  limit: 20,
}));

watch(
  () => items.value.length,
  () => {
    if (items.value.length) emit("loaded", items.value);
  },
);

const hint = computed(() =>
  effective.value ? `Results for “${effective.value}”` : search.value.trim() ? "Type 3+ characters to search" : "Newest contacts",
);
</script>

<template>
  <el-card shadow="never">
    <template #header><span class="card-title">Contacts</span></template>

    <el-input v-model="search" clearable :prefix-icon="Search" placeholder="Search contacts" aria-label="Search contacts by name, email or phone" />
    <p class="hint">{{ hint }}</p>

    <StatusBlock v-if="loading && !items.length" state="loading" />
    <StatusBlock v-else-if="error && !items.length" state="error" title="Couldn't load contacts" :message="error.message" @retry="reset" />
    <StatusBlock
      v-else-if="!items.length"
      state="empty"
      title="No contacts found"
      :message="effective ? 'Try a different search term.' : 'This location has no contacts yet.'"
    />
    <template v-else>
      <ul class="list">
        <li v-for="c in items" :key="c.id">
          <button type="button" class="row" :class="{ active: c.id === selectedId }" @click="emit('select', c)">
            <el-avatar :size="34">{{ initials(contactName(c)) }}</el-avatar>
            <span class="info">
              <span class="name">{{ contactName(c) }}</span>
              <span class="detail">{{ c.companyName || c.email || c.phone || "No email or phone" }}</span>
            </span>
          </button>
        </li>
      </ul>
      <el-alert v-if="error" :title="error.message" type="error" show-icon :closable="false" />
      <div class="foot">
        <span class="count">Showing {{ items.length }}<template v-if="total !== null"> of {{ total }}</template> contacts</span>
        <el-button v-if="hasMore" size="small" :loading="loading" @click="loadMore">Load more</el-button>
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.card-title {
  font-weight: 600;
}
.hint {
  margin: 12px 0 6px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--el-text-color-secondary);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 55vh;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: var(--el-border-radius-base);
  background: transparent;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.row:hover {
  background: var(--el-fill-color-light);
}
.row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.row.active {
  background: var(--el-color-primary-light-9);
}
.row.active .name {
  color: var(--el-color-primary);
}
.info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
@media (max-width: 640px) {
  .list {
    max-height: 300px;
  }
}
</style>
