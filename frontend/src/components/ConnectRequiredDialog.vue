<script setup lang="ts">
import { Plug } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useConnectPrompt } from '@/composables/useConnectPrompt'
import { useHl } from '@/composables/useHl'

const { pendingApp, close } = useConnectPrompt()
const { busy, connect } = useHl()
</script>

<template>
  <Dialog :open="!!pendingApp" @update:open="(o) => { if (!o) close() }">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <span class="mb-1 grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Plug class="size-5" /></span>
        <DialogTitle>Connect a sub-account first</DialogTitle>
        <DialogDescription>
          “{{ pendingApp }}” runs on live HighLevel data, so it can't launch until a HighLevel sub-account is connected.
          Connect one now and your apps will be right here when you're back.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" @click="close()">Not now</Button>
        <Button :disabled="busy !== null" @click="connect()">{{ busy === 'connecting' ? 'Redirecting…' : 'Connect HighLevel' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
