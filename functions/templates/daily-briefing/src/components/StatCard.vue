<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: null },
});
</script>

<template>
<el-card shadow="never">
  <el-statistic :title="label" :value="value === null || value === undefined ? '—' : value" />
</el-card>
</template>
