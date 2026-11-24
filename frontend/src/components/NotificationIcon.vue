<script setup lang="ts">
import { CircleAlert, CircleCheck, CircleX, Columns2 } from '@lucide/vue'
import type { NotificationKind } from '@/composables/useNotifications'

/** The icon of a build notification, by how the build ended. */
defineProps<{ kind: NotificationKind }>()
</script>

<template>
  <Columns2 v-if="kind === 'versions_ready'" class="size-4 shrink-0 text-primary" aria-hidden="true" />
  <CircleCheck v-else-if="kind === 'build_done'" class="size-4 shrink-0 text-ok-500" aria-hidden="true" />
  <CircleAlert v-else-if="kind === 'build_partial'" class="size-4 shrink-0 text-warn-500" aria-hidden="true" />
  <CircleX v-else class="size-4 shrink-0 text-destructive" aria-hidden="true" />
</template>
