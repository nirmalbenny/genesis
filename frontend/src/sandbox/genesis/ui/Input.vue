<script setup>
defineProps({ modelValue: { type: [String, Number], default: undefined } });
defineEmits(["update:modelValue"]);
</script>

<template>
<input class="input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />
</template>
