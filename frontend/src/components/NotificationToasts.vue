<script setup lang="ts">
import { X } from '@lucide/vue'
import { useRouter } from 'vue-router'
import NotificationIcon from '@/components/NotificationIcon.vue'
import { Button } from '@/components/ui/button'
import { useNotifications, type AppNotification } from '@/composables/useNotifications'

/**
 * Toasts for notifications that arrive while a page is open (top right, under the top bar; gone after 10 s, kept in
 * the panel). Clicking one opens where it leads and marks it read; the close button only dismisses it.
 */
const router = useRouter()
const { toasts, dismiss, markRead } = useNotifications()

function open(n: AppNotification) {
  dismiss(n.id)
  markRead([n.id])
  router.push(n.href)
}
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-16 z-50 grid w-[min(360px,calc(100vw-2rem))] gap-2" role="region" aria-label="Notifications" aria-live="polite">
    <div
      v-for="n in toasts"
      :key="n.id"
      class="pointer-events-auto relative rounded-xl border border-border bg-card shadow-[0_12px_32px_rgba(33,51,67,0.18)] transition-colors hover:bg-secondary/40"
    >
      <button type="button" class="flex w-full items-start gap-3 rounded-xl p-4 pr-11 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50" @click="open(n)">
        <span class="mt-0.5"><NotificationIcon :kind="n.kind" /></span>
        <span class="grid min-w-0 flex-1 gap-0.5">
          <span class="text-sm font-semibold leading-5">{{ n.title }}</span>
          <span v-if="n.body" class="line-clamp-2 text-[13px] leading-5 text-muted-foreground">{{ n.body }}</span>
        </span>
      </button>
      <Button variant="ghost" size="icon" class="absolute right-2 top-2 size-7" aria-label="Dismiss notification" @click="dismiss(n.id)">
        <X class="size-4" />
      </Button>
    </div>
  </div>
</template>
