<script setup lang="ts">
import { ArrowUp } from '@lucide/vue'

// Illustrative figures for the product demo; not real data.
const bars = [38, 52, 46, 64, 58, 76, 88]
</script>

<template>
  <figure
    class="auth-demo grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
    aria-label="Example: a prompt asking for a sales performance dashboard, Genesis building it, and the finished dashboard"
  >
    <!-- 1. Prompt -->
    <div class="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-3">
      <span class="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-white/80">You</span>
      <p class="min-w-0 flex-1 text-[13px] leading-5 text-white/90">Build a sales performance dashboard from my HighLevel data.</p>
      <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-white"><ArrowUp class="size-4" /></span>
    </div>

    <!-- 2. Genesis builds -->
    <div class="flex items-center gap-2.5 px-1">
      <span class="grid size-5 shrink-0 place-items-center rounded-[5px] bg-white/10 ring-1 ring-white/15">
        <i class="size-1.5 rotate-45 rounded-[1px] bg-[#4ade80]" />
      </span>
      <span class="text-[12px] text-white/60">Genesis is building your app</span>
      <span class="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10">
        <span class="progress absolute inset-y-0 left-0 rounded-full bg-primary" />
      </span>
    </div>

    <!-- 3. Working app -->
    <div class="rounded-xl bg-white p-3.5 text-ink-100 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div class="flex items-center justify-between">
        <p class="text-[13px] font-semibold">Sales performance</p>
        <span class="inline-flex items-center gap-1 rounded-full bg-ok-100 px-2 py-0.5 text-[10px] font-semibold text-ok-500">
          <span class="size-1.5 rounded-full bg-ok-500" />Live
        </span>
      </div>
      <div class="mt-3 grid grid-cols-[1fr_1fr_1.4fr] gap-2.5">
        <div class="rounded-lg border border-border p-2.5">
          <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total leads</p>
          <p class="mt-0.5 text-lg font-bold leading-6">2,480</p>
        </div>
        <div class="rounded-lg border border-border p-2.5">
          <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Conversion</p>
          <p class="mt-0.5 text-lg font-bold leading-6">18.6%</p>
        </div>
        <div class="flex items-end gap-1 rounded-lg border border-border p-2.5" aria-hidden="true">
          <span
            v-for="(h, i) in bars"
            :key="i"
            class="flex-1 rounded-sm"
            :class="i === bars.length - 1 ? 'bg-primary' : 'bg-[#ffd3c7]'"
            :style="{ height: `${h * 0.42}px` }"
          />
        </div>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.progress {
  width: 62%;
  animation: build 2.6s ease-in-out infinite;
}
@keyframes build {
  0% { width: 8%; }
  70% { width: 92%; }
  100% { width: 92%; }
}
@media (prefers-reduced-motion: reduce) {
  .progress { animation: none; }
}
</style>
