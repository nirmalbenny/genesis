<script setup>
defineProps({
  noun: { type: String, required: true },
  loaded: { type: Number, required: true },
  total: { type: Number, default: null },
  hasMore: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
});
defineEmits(["more"]);
</script>

<template>
  <div class="bar">
    <span class="count">
      Showing {{ loaded }}<template v-if="total !== null"> of {{ total }}</template> {{ noun }}
    </span>
    <el-button v-if="hasMore" size="small" :loading="loading" @click="$emit('more')">
      Load more {{ noun }}
    </el-button>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.count {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
