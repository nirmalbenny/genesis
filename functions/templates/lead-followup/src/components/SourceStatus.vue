<script setup>
import { Loading } from "@element-plus/icons-vue";

defineProps({
  // [{ key, label, status: 'loading' | 'ready' | 'error', error }]
  sources: { type: Array, required: true },
});
defineEmits(["retry"]);
</script>

<template>
  <el-card shadow="never">
    <template #header><strong>Loading your board</strong></template>
    <div class="rows">
      <div v-for="s in sources" :key="s.key" class="row">
        <span class="label">{{ s.label }}</span>
        <el-text v-if="s.status === 'loading'" type="info">
          <el-icon class="is-loading"><Loading /></el-icon> Loading…
        </el-text>
        <el-tag v-else-if="s.status === 'ready'" type="success">Loaded</el-tag>
        <div v-else class="err">
          <el-alert type="error" show-icon :closable="false" :title="s.error || 'Something went wrong.'" />
          <el-button size="small" type="primary" @click="$emit('retry', s.key)">Retry</el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.rows {
  display: grid;
  gap: 14px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
}
.label {
  font-weight: 600;
}
.err {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  flex: 1 1 260px;
  justify-content: flex-end;
}
.err :deep(.el-alert) {
  flex: 1 1 200px;
  width: auto;
}
</style>
