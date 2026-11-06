<template>
  <div v-if="loading" class="state">
    <span class="spinner" aria-hidden="true"></span>
    <span>{{ loadingText }}</span>
  </div>
  <div v-else-if="error" class="state error" role="alert">
    <p class="msg">{{ error }}</p>
    <button class="btn" @click="$emit('retry')">Retry</button>
  </div>
  <div v-else-if="empty" class="state muted">{{ emptyText }}</div>
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

<style scoped>
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 12px;
  text-align: center;
  color: var(--muted);
}

.state.error .msg {
  margin: 0;
  color: #b3261e;
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