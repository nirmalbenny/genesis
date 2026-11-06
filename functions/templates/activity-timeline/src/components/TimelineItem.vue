<script setup>
import { computed } from "vue";
import { dayLabel, fullLabel, prettify, relative, timeLabel } from "../utils.js";

const props = defineProps({
  item: { type: Object, required: true },
  /** Rendered as a card in the "Upcoming" grid instead of inline in the thread. */
  upcoming: { type: Boolean, default: false },
});

const STATUS = {
  confirmed: ["Confirmed", "#00a38d", "#e5f8f6"],
  new: ["Booked", "#007a8c", "#e5f5f8"],
  booked: ["Booked", "#007a8c", "#e5f5f8"],
  showed: ["Showed", "#00a38d", "#e5f8f6"],
  completed: ["Completed", "#00a38d", "#e5f8f6"],
  noshow: ["No-show", "#d9363e", "#fdecee"],
  cancelled: ["Cancelled", "#7c98b6", "#eef3f7"],
  invalid: ["Invalid", "#7c98b6", "#eef3f7"],
};
const status = computed(() => {
  const s = String(props.item.status || "").toLowerCase();
  const [label, color, bg] = STATUS[s] || [prettify(s) || "Scheduled", "#516f90", "#eef3f7"];
  return { label, color, bg };
});
</script>

<template>
  <!-- Upcoming appointment card -->
  <li v-if="upcoming" class="up-card">
    <div class="when">
      <span class="day">{{ dayLabel(item.date) }}</span>
      <span class="rel">{{ relative(item.date) }}</span>
    </div>
    <p class="title">{{ item.title || "Untitled appointment" }}</p>
    <div class="foot">
      <time :title="fullLabel(item.date)">{{ timeLabel(item.date) }}</time>
      <span class="status" :style="{ color: status.color, background: status.bg }">{{ status.label }}</span>
    </div>
  </li>

  <!-- Past appointment, inline in the thread -->
  <li v-else-if="item.type === 'appointment'" class="event">
    <span class="event-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
    </span>
    <span class="event-text"><b>{{ item.title || "Appointment" }}</b> · {{ timeLabel(item.date) }}</span>
    <span class="status" :style="{ color: status.color, background: status.bg }">{{ status.label }}</span>
  </li>

  <!-- Message bubble: customer on the left, team on the right -->
  <li v-else class="msg" :class="item.type">
    <div class="bubble">
      <p v-if="item.body" class="body">{{ item.body }}</p>
      <p v-else class="body muted">(No text content)</p>
    </div>
    <span class="meta" :title="fullLabel(item.date)">
      {{ item.type === "inbound" ? "Customer" : "Team" }}<template v-if="item.channel"> · {{ item.channel }}</template> · {{ timeLabel(item.date) }}
    </span>
  </li>
</template>

<style scoped>
/* Upcoming cards */
.up-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  background: #fff;
  border: 1px solid #dfe3eb;
  border-left: 3px solid #ff5c35;
  border-radius: 10px;
}
.when {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.when .day {
  font-weight: 700;
  color: #ff5c35;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.when .rel {
  color: #7c98b6;
}
.title {
  margin: 0;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.4;
}
.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #516f90;
}
.status {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

/* Inline past appointment */
.event {
  align-self: center;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 92%;
  padding: 6px 12px;
  border: 1px dashed #b0c1d4;
  border-radius: 999px;
  background: #fff;
  font-size: 13px;
  color: #33475b;
}
.event-icon {
  display: grid;
  place-items: center;
  color: #ff5c35;
}
.event-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Message bubbles */
.msg {
  display: flex;
  flex-direction: column;
  max-width: 78%;
}
.msg.inbound {
  align-self: flex-start;
  align-items: flex-start;
}
.msg.outbound {
  align-self: flex-end;
  align-items: flex-end;
}
.bubble {
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.45;
}
.msg.inbound .bubble {
  background: #fff;
  border: 1px solid #dfe3eb;
  border-bottom-left-radius: 4px;
}
.msg.outbound .bubble {
  background: #ff5c35;
  color: #fff;
  border-bottom-right-radius: 4px;
}
.body {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.body.muted {
  opacity: 0.7;
  font-style: italic;
}
.meta {
  margin-top: 3px;
  padding: 0 4px;
  font-size: 11px;
  color: #7c98b6;
}
@media (max-width: 520px) {
  .msg {
    max-width: 90%;
  }
}
</style>
