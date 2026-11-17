<script setup>
import { computed } from "vue";

const props = defineProps({ variant: { type: String, default: "default" } }); // default | secondary | outline | destructive | success | warning | info
const VARIANTS = { default: "primary", secondary: "", outline: "outline", destructive: "danger", success: "success", warning: "warning", info: "info" };
const classes = computed(() => ["badge", VARIANTS[props.variant] ?? ""]);
</script>

<template>
<span :class="classes"><slot /></span>
</template>
