<script setup>
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
          <button class="btn" type="button" @click="$emit('retry', s.key)">Retry</button>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.status-panel {
  background: #fff;
  border: 1px solid #dfe3eb;
  border-radius: 10px;
  padding: 24px;
  max-width: 640px;
  margin: 0 auto;
}
h2 {
  margin: 0 0 16px;
  font-size: 18px;
  color: #213343;
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
  border-bottom: 1px solid #eef1f6;
}
.row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.label {
  color: #213343;
  font-weight: 600;
}
.state {
  color: #516f90;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.state.ok {
  color: #1b8a5a;
}
.state.err .msg {
  color: #c0392b;
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #dfe3eb;
  border-top-color: #ff5c35;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.btn {
  background: #ff5c35;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.btn:hover {
  background: #e84f2b;
}
</style>
