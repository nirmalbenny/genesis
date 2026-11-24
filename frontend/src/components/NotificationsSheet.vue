<script setup lang="ts">
import { Bell, Check } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import NotificationIcon from '@/components/NotificationIcon.vue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useNotifications, type AppNotification } from '@/composables/useNotifications'
import { timeAgo } from '@/lib/time'

/**
 * The bell in the top bar and the side panel it opens: unread build notifications, newest first. Marking one read
 * takes it out of the panel; finished builds stay listed on the Builds page.
 */
const router = useRouter()
const { items, unread, markRead } = useNotifications()
const open = ref(false)
const unreadItems = computed(() => items.value.filter((n) => !n.read))

function go(n: AppNotification) {
  open.value = false
  if (!n.read) markRead([n.id])
  router.push(n.href)
}
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    class="relative size-10 rounded-lg text-white hover:bg-white/10 hover:text-white"
    :aria-label="unread ? `Notifications, ${unread} unread` : 'Notifications'"
    @click="open = true"
  >
    <Bell class="size-5" />
    <span v-if="unread" class="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">
      {{ unread > 9 ? '9+' : unread }}
    </span>
  </Button>

  <Sheet v-model:open="open">
    <SheetContent side="right" class="w-full gap-0 p-0 sm:max-w-sm">
      <SheetHeader class="border-b border-border px-5 py-4">
        <div class="flex items-center justify-between gap-3 pr-8">
          <SheetTitle>Notifications</SheetTitle>
          <Button v-if="unread" variant="ghost" size="sm" class="h-7 text-xs text-primary hover:text-primary" @click="markRead()">Mark all as read</Button>
        </div>
        <SheetDescription class="sr-only">Builds that finished</SheetDescription>
      </SheetHeader>

      <div v-if="!unreadItems.length" class="px-5 py-10 text-center">
        <p class="text-sm text-muted-foreground">You're all caught up. You'll hear here when a build finishes.</p>
        <RouterLink to="/builds" class="mt-2 inline-block text-sm font-medium text-primary hover:underline" @click="open = false">See all builds</RouterLink>
      </div>
      <ul v-else class="grid min-h-0 overflow-y-auto">
        <li v-for="n in unreadItems" :key="n.id" class="flex items-start border-b border-border last:border-0">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-start gap-3 py-3.5 pl-5 text-left outline-none transition-colors hover:bg-secondary/60 focus-visible:bg-secondary"
            @click="go(n)"
          >
            <span class="mt-0.5"><NotificationIcon :kind="n.kind" /></span>
            <span class="grid min-w-0 flex-1 gap-0.5">
              <span class="text-sm font-semibold leading-5">{{ n.title }}</span>
              <span v-if="n.body" class="line-clamp-2 text-[13px] leading-5 text-muted-foreground">{{ n.body }}</span>
              <span class="text-xs text-muted-foreground">{{ timeAgo(n.createdAt) }}</span>
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            class="mr-3 mt-2.5 size-8 shrink-0 text-muted-foreground hover:text-foreground"
            :title="'Mark as read'"
            :aria-label="`Mark as read: ${n.title}`"
            @click="markRead([n.id])"
          >
            <Check class="size-4" />
          </Button>
        </li>
      </ul>
    </SheetContent>
  </Sheet>
</template>
