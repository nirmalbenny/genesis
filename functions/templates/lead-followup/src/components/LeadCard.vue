<script setup>
import { computed } from "vue";
import { formatDate, formatDateTime, relativeTime } from "../utils.js";

const props = defineProps({
  card: { type: Object, required: true },
});

const preview = computed(() => {
  const s = String(props.card.lastMessageBody || "").replace(/\s+/g, " ").trim();
  if (!s) return "No message text";
  return s.length > 110 ? s.slice(0, 110) + "…" : s;
});
</script>

<template>
  <el-card shadow="hover" class="lead">
    <div class="top">
      <strong class="name">{{ card.name }}</strong>
      <el-tag v-if="card.unread > 0" type="danger" size="small" effect="dark">{{ card.unread }} unread</el-tag>
    </div>
    <div class="muted">Source: {{ card.source }}</div>

    <div v-if="card.tags.length" class="tags">
      <el-tag v-for="t in card.tags" :key="t" size="small" type="info">{{ t }}</el-tag>
    </div>

    <div v-if="card.column === 'conversation'" class="block">
      <div>“{{ preview }}”</div>
      <div v-if="card.lastMessageDate" class="muted">{{ relativeTime(card.lastMessageDate) }}</div>
    </div>

    <div v-if="card.column === 'booked' && card.appointment" class="block">
      <div class="muted">Appointment</div>
      <el-text type="primary" tag="b">{{ formatDateTime(card.appointment.startTime) }}</el-text>
      <div v-if="card.appointment.title" class="muted">{{ card.appointment.title }}</div>
    </div>

    <div class="muted">Added {{ formatDate(card.dateAdded) }}</div>
  </el-card>
</template>

<style scoped>
.lead :deep(.el-card__body) {
  display: grid;
  gap: 8px;
  padding: 14px;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.name {
  overflow-wrap: anywhere;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.block {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 8px 10px;
  display: grid;
  gap: 2px;
  overflow-wrap: anywhere;
}
</style>
