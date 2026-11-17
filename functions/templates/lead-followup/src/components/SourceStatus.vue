<script setup>
import { Button } from "../genesis/ui";
defineProps({
  sources: { type: Array, required: true },
});
defineEmits(["retry"]);
</script>

<template>
  <section class="status-panel" aria-live="polite">
    <h2>Loading your board</h2>
    <ul>
      <li v-for="s in sources" :key="s.key" class="row">
        <span class="label">{{ s.label }}</span>
        <span v-if="s.status === 'loading' || s.status === 'idle'" class="state loading">
          <span class="spinner" aria-hidden="true"></span> Loading…
        </span>
        <span v-else-if="s.status === 'ready'" class="state ok">Loaded</span>
        <span v-else class="state err">
          <span class="msg">{{ s.error }}</span>
          <Button size="sm" @click="$emit('retry', s.key)">Retry</Button>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.status-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  max-width: 640px;
  margin: 0 auto;
}
h2 {
  margin: 0 0 16px;
  font-size: 18px;
  color: var(--text);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 14px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--surface-muted);
}
.row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.label {
  color: var(--text);
  font-weight: 600;
}
.state {
  color: var(--muted);
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.state.ok {
  color: var(--success);
}
.state.err .msg {
  color: var(--danger);
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
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
