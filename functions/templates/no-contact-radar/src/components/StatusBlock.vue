<script setup>
import { Button } from "../genesis/ui";
defineProps({
  kind: { type: String, required: true }, // loading | error | empty
  title: { type: String, default: "" },
  message: { type: String, default: "" },
});
defineEmits(["retry"]);
</script>

<template>
  <div class="status" :class="kind" role="status">
    <div v-if="kind === 'loading'" class="spinner" aria-hidden="true"></div>
    <p v-if="title" class="title">{{ title }}</p>
    <p v-if="message" class="msg">{{ message }}</p>
    <Button v-if="kind === 'error'" size="sm" @click="$emit('retry')">Retry</Button>
  </div>
</template>

<style scoped>
.status {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 32px 20px;
  text-align: center;
}
.title {
  margin: 0 0 6px;
  font-weight: 600;
  color: var(--text);
}
.msg {
  margin: 0;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.error .title {
  color: var(--danger);
}
.spinner {
  width: 26px;
  height: 26px;
  margin: 0 auto 12px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
