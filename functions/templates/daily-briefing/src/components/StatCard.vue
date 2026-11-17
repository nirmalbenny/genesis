<script setup>
import { Stat } from "../genesis/ui";

defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: null },
});
</script>

<template>
<Stat :label="label" :value="value === null || value === undefined ? '—' : value" />
</template>
