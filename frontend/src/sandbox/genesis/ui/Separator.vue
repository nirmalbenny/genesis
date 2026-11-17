<script setup>
defineProps({ orientation: { type: String, default: "horizontal" } }); // horizontal | vertical
</script>

<template>
<div role="separator" :aria-orientation="orientation" :class="['separator', orientation === 'vertical' && 'vertical']" />
</template>
