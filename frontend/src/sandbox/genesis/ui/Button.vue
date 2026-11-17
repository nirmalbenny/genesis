<script setup>
import { computed } from "vue";

const props = defineProps({
  variant: { type: String, default: "default" }, // default | secondary | outline | ghost | destructive | link
  size: { type: String, default: "default" }, // default | sm | lg | icon | icon-sm
  as: { type: String, default: "button" },
  type: { type: String, default: "button" },
});
const VARIANTS = { default: "primary", secondary: "secondary", outline: "outline", ghost: "ghost", destructive: "danger", link: "link" };
const SIZES = { default: "", sm: "sm", lg: "lg", icon: "icon", "icon-sm": "icon sm" };
const classes = computed(() => ["btn", VARIANTS[props.variant] ?? "primary", SIZES[props.size] ?? ""]);
</script>

<template>
<component :is="as" :type="as === 'button' ? type : undefined" :class="classes"><slot /></component>
</template>
