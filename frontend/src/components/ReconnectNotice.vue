<script setup lang="ts">
import { KeyRound } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { useHl } from '@/composables/useHl'
import { describeMissing, missingAccess } from '@/lib/scopes'

/** Shown when the HighLevel connection lacks scopes a resource needs (e.g. one added after the user connected). */
const { hl, busy, connect } = useHl()
const missing = computed(() => describeMissing(missingAccess(hl.value?.scopes)))
</script>

<template>
  <div v-if="hl && missing" class="flex items-center gap-3 bg-warn-100 px-4 py-2 text-[13px]" role="status">
    <KeyRound class="size-4 shrink-0 text-warn-500" />
    <p class="flex-1"><b class="font-semibold">Reconnect HighLevel to enable {{ missing }}.</b> Your apps need this access.</p>
    <Button size="sm" variant="secondary" :disabled="busy !== null" @click="connect()">Reconnect</Button>
  </div>
</template>
