<template>
  <div v-if="loading" :aria-label="loadingText">
    <el-skeleton animated :rows="3" />
  </div>
  <el-alert v-else-if="error" type="error" show-icon :closable="false" :title="error">
    <el-button size="small" type="primary" @click="$emit('retry')">Retry</el-button>
  </el-alert>
  <el-empty v-else-if="empty" :description="emptyText" :image-size="70" />
  <slot v-else />
</template>

<script setup>
defineProps({
  loading: Boolean,
  error: { type: String, default: "" },
  empty: Boolean,
  loadingText: { type: String, default: "Loading…" },
  emptyText: { type: String, default: "Nothing to show yet." },
});
defineEmits(["retry"]);
</script>
