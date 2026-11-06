<script setup>
import { computed } from "vue";
import { formatDate, formatDateTime, relativeTime } from "../utils.js";

const props = defineProps({
  card: { type: Object, required: true },
});

const tags = computed(() => (Array.isArray(props.card.tags) ? props.card.tags : []));
const preview = computed(() => {
  const body = props.card.lastMessageBody;
  if (!body) return "No message text";
  const s = String(body).replace(/\s+/g, " ").trim();
  return s.length > 110 ? s.slice(0, 110) + "…" : s || "No message text";
});
</script>

<template>
  <article class="card">
    <header class="top">
      <h3 class="name">{{ card.name }}</h3>
      <span v-if="card.unread > 0" class="badge" :title="`${card.unread} unread`">
        {{ card.unread }} unread
      </span>
    </header>

    <p class="meta">Source: {{ card.source }}</p>

    <div v-if="tags.length" class="tags">
      <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
    </div>

    <div v-if="card.column === 'conversation'" class="block">
      <p class="preview">“{{ preview }}”</p>
      <p v-if="card.lastMessageDate" class="meta">{{ relativeTime(card.lastMessageDate) }}</p>
    </div>

    <div v-if="card.column === 'booked' && card.appointment" class="block booked">
      <span class="label">Appointment</span>
      <span class="when">{{ formatDateTime(card.appointment.startTime) }}</span>
      <span v-if="card.appointment.title" class="meta">{{ card.appointment.title }}</span>
    </div>

    <footer class="meta added">Added {{ formatDate(card.dateAdded) }}</footer>
  </article>
</template>

<style scoped>
.card {
  background: #fff;
  border: 1px solid #dfe3eb;
  border-radius: 10px;
  padding: 16px;
  display: grid;
  gap: 10px;
  min-width: 0;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.name {
  margin: 0;
  font-size: 16px;
  color: #213343;
  overflow-wrap: anywhere;
}
.badge {
  background: #ff5c35;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.meta {
  margin: 0;
  font-size: 13px;
  color: #516f90;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag {
  background: #eef3f8;
  color: #516f90;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  overflow-wrap: anywhere;
}
.block {
  background: #f5f8fa;
  border-radius: 8px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}
.preview {
  margin: 0;
  font-size: 14px;
  color: #213343;
  overflow-wrap: anywhere;
}
.booked .label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #516f90;
}
.booked .when {
  color: #ff5c35;
  font-weight: 600;
  font-size: 14px;
}
.added {
  padding-top: 2px;
}
</style>
