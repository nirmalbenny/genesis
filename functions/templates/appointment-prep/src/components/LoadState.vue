<script setup>
import { Alert, AlertDescription, AlertTitle, Button, EmptyState, Loading } from "../genesis/ui";

defineProps({
  loading: Boolean,
  error: { type: String, default: "" },
  empty: Boolean,
  loadingText: { type: String, default: "Loading…" },
  emptyTitle: { type: String, default: "Nothing here yet" },
  emptyText: { type: String, default: "" },
});
defineEmits(["retry"]);
</script>

<template>
  <Loading v-if="loading" :text="loadingText" />
  <Alert v-else-if="error" variant="destructive">
    <AlertTitle>Something went wrong</AlertTitle>
    <AlertDescription class="stack" style="align-items: flex-start">
      <span style="word-break: break-word">{{ error }}</span>
      <Button size="sm" @click="$emit('retry')">Retry</Button>
    </AlertDescription>
  </Alert>
  <EmptyState v-else-if="empty" :title="emptyTitle" :description="emptyText" />
  <slot v-else />
</template>
