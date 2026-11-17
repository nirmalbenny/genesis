<script setup>
defineProps({ modelValue: { type: [String, Number], default: undefined } });
defineEmits(["update:modelValue"]);
</script>

<template>
<select class="input" :value="modelValue" @change="$emit('update:modelValue', $event.target.value)"><slot /></select>
</template>
