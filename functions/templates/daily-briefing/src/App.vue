<script setup>
import { ref, computed } from "vue";
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
    <div class="wrap">
      <header class="header">
        <div class="titles">
          <p class="date">{{ dateText }}</p>
          <h1>{{ greeting }} 👋</h1>
          <p class="sub">Here's your daily briefing. Last refreshed at {{ updatedText }}.</p>
        </div>
        <button class="btn" type="button" @click="refresh">↻ Refresh</button>
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
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f5f8fa;
  color: #213343;
  padding: 32px 16px 56px;
}
.wrap {
  max-width: 1080px;
  margin: 0 auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.titles {
  min-width: 0;
}
.date {
  margin: 0 0 4px;
  color: #ff5c35;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.02em;
}
h1 {
  margin: 0 0 6px;
  font-size: 28px;
  line-height: 1.2;
}
.sub {
  margin: 0;
  color: #516f90;
  font-size: 14px;
}
.btn {
  background: #ff5c35;
  color: #fff;
  border: 1px solid #ff5c35;
  border-radius: 8px;
  padding: 10px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover {
  background: #e84e29;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.sections {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
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
  .stats {
    grid-template-columns: 1fr;
  }
  h1 {
    font-size: 24px;
  }
  .page {
    padding: 20px 12px 40px;
  }
}
</style>