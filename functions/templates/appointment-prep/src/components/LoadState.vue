<script setup>
defineProps({
  loading: Boolean,
  error: { type: String, default: "" },
  empty: Boolean,
  loadingText: { type: String, default: "Loading…" },
  emptyTitle: { type: String, default: "Nothing here yet" },
  emptyText: { type: String, default: "" },
});
defineEmits(["retry"]);
</script>

<template>
  <div v-if="loading" role="status" :aria-label="loadingText">
    <el-skeleton :rows="3" animated />
    <p class="hint">{{ loadingText }}</p>
  </div>
  <el-alert v-else-if="error" type="error" show-icon :closable="false" title="Something went wrong">
    <div class="err">
      <span>{{ error }}</span>
      <el-button size="small" type="primary" @click="$emit('retry')">Retry</el-button>
    </div>
  </el-alert>
  <el-empty v-else-if="empty" :description="emptyTitle + (emptyText ? ' — ' + emptyText : '')" />
  <slot v-else />
</template>

<style scoped>
.hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.err {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  word-break: break-word;
}
</style>
