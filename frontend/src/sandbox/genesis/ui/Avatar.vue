<script setup>
import { computed } from "vue";

const props = defineProps({ name: { type: String, default: "" }, src: { type: String, default: "" } });
const initials = computed(() =>
  props.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?",
);
</script>

<template>
<span class="avatar" :title="name || undefined">
  <img v-if="src" :src="src" :alt="name" />
  <template v-else>{{ initials }}</template>
</span>
</template>
