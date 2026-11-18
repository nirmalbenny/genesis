<script setup>
import { computed, onMounted, watch } from "vue";
import SectionCard from "./SectionCard.vue";
import { hlGet, LOCATION_ID, toDate } from "../genesis/hl.js";
import { useResource } from "../useResource.js";
import { formatTime } from "../utils.js";

const props = defineProps({ refreshKey: { type: Number, default: 0 } });
const emit = defineEmits(["count"]);

async function fetchToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const calData = await hlGet("/calendars/", { locationId: LOCATION_ID });
  const calendars = (Array.isArray(calData.calendars) ? calData.calendars : []).filter(
    (c) => c && c.id && c.isActive !== false
  );

  const results = [];
  for (const cal of calendars) {
    try {
      const value = await hlGet("/calendars/events", {
        locationId: LOCATION_ID,
        calendarId: cal.id,
        startTime: start.getTime(),
        endTime: end.getTime(),
      });
      results.push({ status: "fulfilled", value });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }

  const failures = results.filter((r) => r.status === "rejected");
  if (calendars.length > 0 && failures.length === calendars.length) {
    throw failures[0].reason;
  }

  const seen = new Set();
  const events = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const list = Array.isArray(r.value.events) ? r.value.events : [];
    for (const ev of list) {
      if (!ev) continue;
      const key = ev.id || `${ev.calendarId}-${ev.startTime}-${ev.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ...ev, calendarName: calendars[i].name || "Calendar" });
    }
  });

  events.sort((a, b) => {
    const ta = toDate(a.startTime);
    const tb = toDate(b.startTime);
    return (ta ? ta.getTime() : Infinity) - (tb ? tb.getTime() : Infinity);
  });

  return {
    events,
    warning: failures.length
      ? `${failures.length} calendar(s) could not be loaded: ${(failures[0].reason && failures[0].reason.message) || "unknown error"}`
      : "",
  };
}

const { data, loading, error, load } = useResource(fetchToday);
const events = computed(() => (data.value ? data.value.events : []));

onMounted(load);
watch(() => props.refreshKey, load);
watch(
  [data, loading, error],
  () => {
    emit("count", !loading.value && !error.value && data.value ? events.value.length : null);
  },
  { immediate: true }
);

function statusType(s) {
  const v = String(s || "").toLowerCase();
  if (v === "confirmed" || v === "showed") return "success";
  if (v === "cancelled" || v === "noshow" || v === "invalid") return "danger";
  return "info";
}
function statusLabel(s) {
  if (!s) return "Unknown";
  const t = String(s).replace(/([a-z])([A-Z])/g, "$1 $2");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
</script>

<template>
<SectionCard
  title="Today's appointments"
  :loading="loading"
  :error="error"
  :empty="events.length === 0"
  empty-text="No appointments scheduled for today."
  :badge="events.length"
  @retry="load"
>
  <el-alert v-if="data && data.warning" type="warning" show-icon :closable="false" :title="data.warning" class="warn" />
  <div v-for="(ev, i) in events" :key="ev.id || i" class="item">
    <div class="time">
      <strong>{{ formatTime(ev.startTime) || "—" }}</strong>
      <span v-if="formatTime(ev.endTime)" class="muted">{{ formatTime(ev.endTime) }}</span>
    </div>
    <div class="info">
      <div class="title">{{ ev.title || "Untitled appointment" }}</div>
      <div class="muted">{{ ev.calendarName }}</div>
    </div>
    <el-tag :type="statusType(ev.appointmentStatus)">{{ statusLabel(ev.appointmentStatus) }}</el-tag>
  </div>
</SectionCard>
</template>

<style scoped>
.warn {
  margin-bottom: 12px;
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.item:last-child {
  border-bottom: 0;
}
.time {
  display: flex;
  flex-direction: column;
  min-width: 76px;
}
.info {
  flex: 1;
  min-width: 0;
}
.title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
@media (max-width: 480px) {
  .item {
    flex-wrap: wrap;
  }
  .time {
    flex-direction: row;
    gap: 6px;
    min-width: 100%;
  }
}
</style>
