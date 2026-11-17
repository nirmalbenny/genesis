<script setup>
import { computed } from "vue";

const props = defineProps({ variant: { type: String, default: "default" } }); // default | destructive | success | warning
const VARIANTS = { default: "", destructive: "error", success: "success", warning: "warning" };
const classes = computed(() => ["notice", VARIANTS[props.variant] ?? ""]);
</script>

<template>
<div role="alert" :class="classes"><slot /></div>
</template>
