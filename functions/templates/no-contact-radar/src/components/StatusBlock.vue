<script setup>
defineProps({
  kind: { type: String, required: true }, // loading | error | empty
  title: { type: String, default: "" },
  message: { type: String, default: "" },
});
defineEmits(["retry"]);
</script>

<template>
  <el-card shadow="never">
    <el-skeleton v-if="kind === 'loading'" :rows="4" animated />
    <el-alert
      v-else-if="kind === 'error'"
      type="error"
      show-icon
      :closable="false"
      :title="title"
      :description="message"
    >
      <template #default>
        <el-button size="small" class="retry" @click="$emit('retry')">Retry</el-button>
      </template>
    </el-alert>
    <el-empty v-else :description="title">
      <p v-if="message" class="msg">{{ message }}</p>
    </el-empty>
    <p v-if="kind === 'loading' && title" class="msg">{{ title }}</p>
  </el-card>
</template>

<style scoped>
.msg {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  text-align: center;
  font-size: 13px;
}
.retry {
  margin-top: 8px;
}
</style>
