<script setup>
defineProps({
  modelValue: { type: String, required: true },
  counts: { type: Object, required: true },
});
const emit = defineEmits(["update:modelValue"]);

const options = [
  { value: "all", label: "All" },
  { value: "messages", label: "Messages" },
  { value: "appointments", label: "Appointments" },
];
</script>

<template>
  <el-radio-group :model-value="modelValue" size="small" aria-label="Filter timeline" @update:model-value="emit('update:modelValue', $event)">
    <el-radio-button v-for="o in options" :key="o.value" :value="o.value">
      {{ o.label }} ({{ counts[o.value] ?? 0 }})
    </el-radio-button>
  </el-radio-group>
</template>
