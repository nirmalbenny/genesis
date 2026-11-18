<script setup>
defineProps({
  state: { type: String, required: true }, // loading | error | empty
  message: { type: String, default: "" },
  title: { type: String, default: "" },
});
const emit = defineEmits(["retry"]);
</script>

<template>
  <el-skeleton v-if="state === 'loading'" :rows="3" animated />
  <div v-else-if="state === 'error'" class="err">
    <el-alert :title="title || 'Something went wrong'" type="error" show-icon :closable="false" :description="message || 'Unknown error'" />
    <el-button @click="emit('retry')">Retry</el-button>
  </div>
  <el-empty v-else :description="[title, message].filter(Boolean).join(' – ')" :image-size="80" />
</template>

<style scoped>
.err {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
</style>
