<script setup>
defineProps({ text: { type: String, default: "Loading…" } });
</script>

<template>
<div class="loading" role="status">{{ text }}</div>
</template>
