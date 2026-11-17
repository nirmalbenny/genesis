<template>
  <Loading v-if="loading" :text="loadingText" />
  <Alert v-else-if="error" variant="destructive">
    <AlertDescription class="stack" style="align-items: flex-start">
      <span style="word-break: break-word">{{ error }}</span>
      <Button size="sm" @click="$emit('retry')">Retry</Button>
    </AlertDescription>
  </Alert>
  <EmptyState v-else-if="empty" title="" :description="emptyText" />
  <slot v-else />
</template>

<script setup>
import { Alert, AlertDescription, Button, EmptyState, Loading } from "../genesis/ui";

defineProps({
  loading: Boolean,
  error: { type: String, default: "" },
  empty: Boolean,
  loadingText: { type: String, default: "Loading…" },
  emptyText: { type: String, default: "Nothing to show yet." },
});
defineEmits(["retry"]);
</script>
