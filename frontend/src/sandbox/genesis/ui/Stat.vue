<script setup>
defineProps({ label: { type: String, required: true }, value: { type: [String, Number], default: "—" } });
</script>

<template>
<div class="stat">
  <div class="stat-value">{{ value }}</div>
  <div class="stat-label">{{ label }}</div>
  <slot />
</div>
</template>
