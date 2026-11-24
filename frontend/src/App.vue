<script setup lang="ts">
import NotificationToasts from '@/components/NotificationToasts.vue'
import { useAuth } from '@/composables/useAuth'

const { user, emailVerified } = useAuth()
</script>

<template>
  <RouterView />
  <!-- Build notifications as toasts, on every page, once the account can use Genesis -->
  <NotificationToasts v-if="user && emailVerified" />
</template>
