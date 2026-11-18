<script setup>
import { computed } from "vue";
import { Calendar } from "@element-plus/icons-vue";
import { dayLabel, fullLabel, prettify, relative, timeLabel } from "../utils.js";

const props = defineProps({
  item: { type: Object, required: true },
  /** Rendered as a card in the "Upcoming" grid instead of inline in the thread. */
  upcoming: { type: Boolean, default: false },
});

const STATUS = {
  confirmed: ["Confirmed", "success"],
  new: ["Booked", "primary"],
  booked: ["Booked", "primary"],
  showed: ["Showed", "success"],
  completed: ["Completed", "success"],
  noshow: ["No-show", "danger"],
  cancelled: ["Cancelled", "info"],
  invalid: ["Invalid", "info"],
};
const status = computed(() => {
  const s = String(props.item.status || "").toLowerCase();
  const [label, type] = STATUS[s] || [prettify(s) || "Scheduled", "info"];
  return { label, type };
});
</script>

<template>
  <!-- Upcoming appointment card -->
  <li v-if="upcoming" class="up-card">
    <el-card shadow="never" :body-style="{ padding: '12px 14px' }">
      <div class="when">
        <span class="day">{{ dayLabel(item.date) }}</span>
        <span class="rel">{{ relative(item.date) }}</span>
      </div>
      <p class="title">{{ item.title || "Untitled appointment" }}</p>
      <div class="foot">
        <time :title="fullLabel(item.date)">{{ timeLabel(item.date) }}</time>
        <el-tag :type="status.type" size="small">{{ status.label }}</el-tag>
      </div>
    </el-card>
  </li>

  <!-- Past appointment, inline in the thread -->
  <li v-else-if="item.type === 'appointment'" class="event">
    <el-icon><Calendar /></el-icon>
    <span class="event-text"><b>{{ item.title || "Appointment" }}</b> · {{ timeLabel(item.date) }}</span>
    <el-tag :type="status.type" size="small">{{ status.label }}</el-tag>
  </li>

  <!-- Message bubble: customer on the left, team on the right -->
  <li v-else class="msg" :class="item.type">
    <div class="bubble">
      <p v-if="item.body" class="body">{{ item.body }}</p>
      <p v-else class="body empty">(No text content)</p>
    </div>
    <span class="meta" :title="fullLabel(item.date)">
      {{ item.type === "inbound" ? "Customer" : "Team" }}<template v-if="item.channel"> · {{ item.channel }}</template> · {{ timeLabel(item.date) }}
    </span>
  </li>
</template>

<style scoped>
.up-card {
  list-style: none;
}
.when {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.day {
  font-weight: 700;
  color: var(--el-color-primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.rel {
  color: var(--el-text-color-secondary);
}
.title {
  margin: 6px 0;
  font-weight: 600;
  font-size: 14px;
}
.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.event {
  align-self: center;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 6px 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 999px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.event-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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
  background: var(--el-fill-color-light);
  border-bottom-left-radius: 4px;
}
.msg.outbound .bubble {
  background: var(--el-color-primary);
  color: var(--app-on-primary);
  border-bottom-right-radius: 4px;
}
.body {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.body.empty {
  opacity: 0.7;
  font-style: italic;
}
.meta {
  margin-top: 3px;
  padding: 0 4px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
@media (max-width: 520px) {
  .msg {
    max-width: 92%;
  }
}
</style>
