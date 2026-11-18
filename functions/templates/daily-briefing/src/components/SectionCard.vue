<script setup>
defineProps({
  title: { type: String, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: "Nothing to show." },
  badge: { type: [Number, String], default: null },
});
defineEmits(["retry"]);
</script>

<template>
<el-card shadow="never">
  <template #header>
    <div class="head">
      <strong>{{ title }}</strong>
      <el-tag v-if="badge !== null && badge !== undefined && !loading && !error" type="info" round>{{ badge }}</el-tag>
    </div>
  </template>

  <el-skeleton v-if="loading" :rows="3" animated />

  <el-alert v-else-if="error" type="error" show-icon :closable="false" :title="error">
    <el-button size="small" @click="$emit('retry')">Retry</el-button>
  </el-alert>

  <el-empty v-else-if="empty" :description="emptyText" :image-size="80" />

  <slot v-else />
</el-card>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
