<script setup>
defineProps({
  modelValue: { type: String, required: true },
  counts: { type: Object, required: true },
});
const emit = defineEmits(["update:modelValue"]);

const options = [
  { value: "all", label: "All activity" },
  { value: "messages", label: "Messages" },
  { value: "appointments", label: "Appointments" },
];
</script>

<template>
  <div class="tabs" role="tablist" aria-label="Filter timeline">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="tab"
      class="tab"
      :class="{ active: modelValue === o.value }"
      :aria-selected="modelValue === o.value"
      @click="emit('update:modelValue', o.value)"
    >
      {{ o.label }}
      <span class="count">{{ counts[o.value] ?? 0 }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 9px;
  background: var(--surface-muted);
  max-width: 100%;
  overflow-x: auto;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
}
.tab:hover {
  color: var(--text);
}
.tab:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}
.tab.active {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(33, 51, 67, 0.12);
}
.count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--border);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.tab.active .count {
  background: var(--primary);
  color: var(--on-primary);
}
</style>
