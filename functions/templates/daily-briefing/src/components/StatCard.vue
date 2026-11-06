<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: null },
});
</script>

<template>
  <div class="stat">
    <p class="label">{{ label }}</p>
    <p class="value">{{ value === null || value === undefined ? "—" : value }}</p>
  </div>
</template>

<style scoped>
.stat {
  background: #fff;
  border: 1px solid #dfe3eb;
  border-radius: 10px;
  padding: 20px;
  border-top: 3px solid #ff5c35;
}
.label {
  margin: 0 0 8px;
  color: #516f90;
  font-size: 14px;
}
.value {
  margin: 0;
  font-size: 34px;
  font-weight: 700;
  color: #213343;
  line-height: 1;
}
</style>