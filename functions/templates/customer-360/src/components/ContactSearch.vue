<template>
  <el-card shadow="never">
    <template #header>
      <div class="head">
        <span class="title">Contacts</span>
        <el-tag v-if="total !== null" size="small" type="info" round>{{ total }}</el-tag>
      </div>
    </template>

    <el-input
      v-model="query"
      clearable
      :prefix-icon="Search"
      placeholder="Search by name, email or phone"
      aria-label="Search contacts"
    />
    <p class="hint">
      {{ hint || (effective ? `Results for “${effective}”` : "Newest contacts first") }}
    </p>

    <StateBlock
      :loading="loading && !items.length"
      :error="error ? error.message : ''"
      :empty="!items.length"
      :empty-text="effective ? `No contacts match “${effective}”.` : 'No contacts found in this location yet.'"
      loading-text="Loading contacts…"
      @retry="pager.reset()"
    >
      <el-table
        :data="items"
        row-key="id"
        :show-header="false"
        highlight-current-row
        :current-row-key="modelValue"
        max-height="480"
        style="width: 100%"
        @row-click="(row) => pick(row.id)"
      >
        <el-table-column>
          <template #default="{ row }">
            <div class="cell">
              <el-avatar :size="36">{{ initials(row) }}</el-avatar>
              <div class="info">
                <div class="name">{{ contactName(row) }}</div>
                <div class="sub">{{ row.email || row.phone || "No email or phone" }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="foot">
        <span class="sub">
          {{ total !== null ? `Showing ${items.length} of ${total} contacts` : `${items.length} contacts loaded` }}
        </span>
        <el-button v-if="hasMore" :loading="loading" @click="pager.loadMore()">Load more</el-button>
      </div>
    </StateBlock>
  </el-card>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { Search } from "@element-plus/icons-vue";
import { usePager, contactName } from "../genesis/hl.js";
import { initials } from "../utils.js";
import StateBlock from "./StateBlock.vue";

const props = defineProps({ modelValue: { type: String, default: null } });
const emit = defineEmits(["update:modelValue", "picked"]);

const query = ref("");
const trimmed = computed(() => query.value.trim());
const effective = computed(() => (trimmed.value.length >= 3 ? trimmed.value : ""));
const hint = computed(() =>
  trimmed.value.length > 0 && trimmed.value.length < 3 ? "Type at least 3 characters to search." : ""
);

const pager = usePager("contacts", () =>
  effective.value
    ? { query: effective.value, limit: 20 }
    : { sortBy: "date_added", order: "desc", limit: 20 }
);
const { items, total, hasMore, loading, error } = pager;

watch(
  items,
  (list) => {
    if (!props.modelValue && list && list.length) emit("update:modelValue", list[0].id);
  },
  { immediate: true }
);

function pick(id) {
  emit("update:modelValue", id);
  emit("picked", id);
}
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
.hint {
  margin: 8px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.cell {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.info {
  min-width: 0;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
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
  margin-top: 12px;
}
</style>
