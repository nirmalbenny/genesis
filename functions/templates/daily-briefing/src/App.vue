<script setup>
import { ref, computed } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { LOCATION_NAME } from "./genesis/hl.js";
import StatCard from "./components/StatCard.vue";
import AppointmentsSection from "./components/AppointmentsSection.vue";
import ConversationsSection from "./components/ConversationsSection.vue";
import LeadsSection from "./components/LeadsSection.vue";

const refreshKey = ref(0);
const updatedAt = ref(new Date());

const apptCount = ref(null);
const unreadCount = ref(null);
const leadCount = ref(null);

const dateText = new Date().toLocaleDateString([], {
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
  <header class="head">
    <div>
      <p class="date">{{ dateText }}<template v-if="LOCATION_NAME"> · {{ LOCATION_NAME }}</template></p>
      <h1>{{ greeting }}</h1>
      <p class="muted">Here's your daily briefing. Last refreshed at {{ updatedText }}.</p>
    </div>
    <el-button :icon="Refresh" @click="refresh">Refresh</el-button>
  </header>

  <el-row :gutter="16">
    <el-col :xs="24" :sm="8" class="cell"><StatCard label="Appointments today" :value="apptCount" /></el-col>
    <el-col :xs="24" :sm="8" class="cell"><StatCard label="Unread conversations" :value="unreadCount" /></el-col>
    <el-col :xs="24" :sm="8" class="cell"><StatCard label="New leads (7 days)" :value="leadCount" /></el-col>
  </el-row>

  <el-row :gutter="16">
    <el-col :span="24" class="cell">
      <AppointmentsSection :refresh-key="refreshKey" @count="apptCount = $event" />
    </el-col>
    <el-col :xs="24" :md="12" class="cell">
      <ConversationsSection :refresh-key="refreshKey" @count="unreadCount = $event" />
    </el-col>
    <el-col :xs="24" :md="12" class="cell">
      <LeadsSection :refresh-key="refreshKey" @count="leadCount = $event" />
    </el-col>
  </el-row>
</div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
h1 {
  margin: 4px 0;
  font-size: 24px;
  font-weight: 600;
}
.date {
  margin: 0;
  color: var(--el-color-primary);
  font-weight: 600;
}
.muted {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.cell {
  margin-bottom: 16px;
}
</style>
