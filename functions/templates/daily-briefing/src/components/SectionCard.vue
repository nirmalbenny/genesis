<script setup>
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from "../genesis/ui";

defineProps({
  title: { type: String, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: "Nothing to show." },
  emptyIcon: { type: String, default: "✨" },
  badge: { type: [Number, String], default: null },
});
defineEmits(["retry"]);
</script>

<template>
<Card>
  <CardHeader class="row">
    <CardTitle>{{ title }}</CardTitle>
    <Badge v-if="badge !== null && badge !== undefined && !loading && !error" variant="secondary">{{ badge }}</Badge>
  </CardHeader>

  <CardContent>
    <div v-if="loading" class="stack" aria-busy="true">
      <Skeleton v-for="n in 3" :key="n" style="height: 46px" />
      <span class="sr-only">Loading…</span>
    </div>

    <Alert v-else-if="error" variant="destructive">
      <AlertDescription class="stack" style="align-items: flex-start">
        <span>{{ error }}</span>
        <Button size="sm" @click="$emit('retry')">Retry</Button>
      </AlertDescription>
    </Alert>

    <EmptyState v-else-if="empty" :title="emptyIcon" :description="emptyText" />

    <slot v-else />
  </CardContent>
</Card>
</template>
