<script setup>
defineProps({ title: { type: String, default: "Nothing here yet" }, description: { type: String, default: "" } });
</script>

<template>
<div class="empty stack" style="align-items: center">
  <strong v-if="title" style="color: var(--text)">{{ title }}</strong>
  <span v-if="description">{{ description }}</span>
  <slot />
</div>
</template>
