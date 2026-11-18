<script setup>
defineProps({
  shown: { type: Number, default: 0 },
  total: { type: Number, default: null },
  hasMore: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  noun: { type: String, default: "items" },
});
defineEmits(["more"]);
</script>

<template>
<div class="bar">
  <span class="muted">
    Showing {{ shown }}<template v-if="total !== null && total !== undefined"> of {{ total }}</template> {{ noun }}
  </span>
  <el-button v-if="hasMore" :loading="loading" @click="$emit('more')">Load more</el-button>
</div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
