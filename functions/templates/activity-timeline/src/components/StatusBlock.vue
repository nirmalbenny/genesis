<script setup>
import { Button } from "../genesis/ui";
defineProps({
  state: { type: String, required: true }, // loading | error | empty
  message: { type: String, default: "" },
  title: { type: String, default: "" },
});
const emit = defineEmits(["retry"]);
</script>

<template>
  <div class="status" :class="state" role="status">
    <template v-if="state === 'loading'">
      <span class="spinner" aria-hidden="true"></span>
      <p>{{ message || "Loading…" }}</p>
    </template>
    <template v-else-if="state === 'error'">
      <p class="title">{{ title || "Something went wrong" }}</p>
      <p class="msg">{{ message || "Unknown error" }}</p>
      <Button size="sm" @click="emit('retry')">Retry</Button>
    </template>
    <template v-else>
      <p class="title">{{ title }}</p>
      <p class="msg">{{ message }}</p>
    </template>
  </div>
</template>

<style scoped>
.status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  text-align: center;
  color: var(--muted);
}
.status p {
  margin: 0;
}
.title {
  color: var(--text);
  font-weight: 600;
}
.msg {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.error .msg {
  color: var(--danger);
}
.spinner {
  width: 22px;
  height: 22px;
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