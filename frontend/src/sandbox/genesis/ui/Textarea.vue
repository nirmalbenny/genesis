<script setup>
defineProps({ modelValue: { type: String, default: undefined } });
defineEmits(["update:modelValue"]);
</script>

<template>
<textarea class="input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />
</template>
