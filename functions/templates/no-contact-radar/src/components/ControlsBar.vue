<script setup>
defineProps({
  days: { type: Number, required: true },
  includeNever: { type: Boolean, required: true },
  query: { type: String, required: true },
  options: { type: Array, required: true },
});
defineEmits(["update:days", "update:includeNever", "update:query"]);
</script>

<template>
  <div class="controls">
    <label class="field">
      <span class="label">No conversation in the last</span>
      <select
        :value="days"
        @change="$emit('update:days', Number($event.target.value))"
      >
        <option v-for="o in options" :key="o" :value="o">{{ o }} days</option>
      </select>
    </label>

    <label class="field grow">
      <span class="label">Filter</span>
      <input
        type="search"
        placeholder="Name, email, phone or tag"
        :value="query"
        @input="$emit('update:query', $event.target.value)"
      />
    </label>

    <label class="toggle">
      <input
        type="checkbox"
        :checked="includeNever"
        @change="$emit('update:includeNever', $event.target.checked)"
      />
      <span>Include never contacted</span>
    </label>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-end;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 20px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 150px;
}
.grow {
  flex: 1 1 220px;
}
.label {
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
select,
input[type="search"] {
  font: inherit;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
  width: 100%;
  box-sizing: border-box;
}
select:focus,
input[type="search"]:focus {
  outline: 2px solid var(--primary);
  outline-offset: -1px;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  padding-bottom: 10px;
  cursor: pointer;
}
.toggle input {
  accent-color: var(--primary);
  width: 16px;
  height: 16px;
}
</style>
