<script setup>
import { ref, computed } from "vue";
import { Button } from "./genesis/ui";
import StatCard from "./components/StatCard.vue";
import AppointmentsSection from "./components/AppointmentsSection.vue";
import ConversationsSection from "./components/ConversationsSection.vue";
import LeadsSection from "./components/LeadsSection.vue";

const refreshKey = ref(0);
const updatedAt = ref(new Date());

const apptCount = ref(null);
const unreadCount = ref(null);
const leadCount = ref(null);

const now = new Date();
const dateText = now.toLocaleDateString([], {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
});

function refresh() {
  refreshKey.value++;
  updatedAt.value = new Date();
}

const updatedText = computed(() =>
  updatedAt.value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
);
</script>

<template>
<div class="page">
  <header class="header">
    <div class="stack" style="gap: 4px">
      <p class="date">{{ dateText }}</p>
      <h1>{{ greeting }} 👋</h1>
      <p class="muted">Here's your daily briefing. Last refreshed at {{ updatedText }}.</p>
    </div>
    <Button @click="refresh">↻ Refresh</Button>
  </header>

  <div class="stats">
    <StatCard label="Appointments today" :value="apptCount" />
    <StatCard label="Unread conversations" :value="unreadCount" />
    <StatCard label="New leads (7 days)" :value="leadCount" />
  </div>

  <div class="sections">
    <div class="full">
      <AppointmentsSection :refresh-key="refreshKey" @count="apptCount = $event" />
    </div>
    <ConversationsSection :refresh-key="refreshKey" @count="unreadCount = $event" />
    <LeadsSection :refresh-key="refreshKey" @count="leadCount = $event" />
  </div>
</div>
</template>

<style scoped>
.page {
  max-width: 1080px;
}
.date {
  color: var(--primary);
  font-weight: 600;
  letter-spacing: 0.02em;
}
h1 {
  font-size: 28px;
}
.sections {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: start;
}
.full {
  grid-column: 1 / -1;
}
@media (max-width: 900px) {
  .sections {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  h1 {
    font-size: 24px;
  }
}
</style>
