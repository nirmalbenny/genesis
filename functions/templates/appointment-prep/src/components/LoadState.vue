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
  <div v-if="loading" class="box" role="status">
    <span class="spinner" aria-hidden="true"></span>
    <span class="muted">{{ loadingText }}</span>
  </div>
  <div v-else-if="error" class="box error" role="alert">
    <strong>Something went wrong</strong>
    <span class="msg">{{ error }}</span>
    <button class="btn btn-primary" type="button" @click="$emit('retry')">Retry</button>
  </div>
  <div v-else-if="empty" class="box">
    <strong>{{ emptyTitle }}</strong>
    <span v-if="emptyText" class="muted">{{ emptyText }}</span>
  </div>
  <slot v-else />
</template>

<style scoped>
.box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  padding: 28px 16px;
}
.error .msg {
  color: #c0392b;
  font-size: 14px;
  word-break: break-word;
}
.spinner {
  width: 22px;
  height: 22px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>