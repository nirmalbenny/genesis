<script setup>
import { computed, onMounted, watch } from "vue";
import SectionCard from "./SectionCard.vue";
import { hlGet, LOCATION_ID } from "../api.js";
import { useResource } from "../useResource.js";
import { toDate, formatTime } from "../utils.js";

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

  const results = await Promise.allSettled(
    calendars.map((cal) =>
      hlGet("/calendars/events", {
        locationId: LOCATION_ID,
        calendarId: cal.id,
        startTime: start.getTime(),
        endTime: end.getTime(),
      })
    )
  );

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

function statusClass(s) {
  const v = String(s || "").toLowerCase();
  if (v === "confirmed" || v === "showed") return "ok";
  if (v === "cancelled" || v === "noshow" || v === "invalid") return "bad";
  return "neutral";
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
    empty-icon="📅"
    :badge="events.length"
    @retry="load"
  >
    <p v-if="data && data.warning" class="warn">{{ data.warning }}</p>
    <ul class="list">
      <li v-for="(ev, i) in events" :key="ev.id || i" class="row">
        <div class="time">
          <strong>{{ formatTime(ev.startTime) || "—" }}</strong>
          <span v-if="formatTime(ev.endTime)">{{ formatTime(ev.endTime) }}</span>
        </div>
        <div class="info">
          <p class="title">{{ ev.title || "Untitled appointment" }}</p>
          <p class="meta">{{ ev.calendarName }}</p>
        </div>
        <span class="status" :class="statusClass(ev.appointmentStatus)">{{ statusLabel(ev.appointmentStatus) }}</span>
      </li>
    </ul>
  </SectionCard>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border: 1px solid #eaeef3;
  border-radius: 8px;
}
.time {
  display: flex;
  flex-direction: column;
  min-width: 76px;
  font-size: 13px;
  color: #516f90;
}
.time strong {
  color: #213343;
  font-size: 15px;
}
.info {
  flex: 1;
  min-width: 0;
}
.title {
  margin: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  margin: 2px 0 0;
  font-size: 13px;
  color: #516f90;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  white-space: nowrap;
}
.status.ok {
  background: #e6f6ee;
  color: #1a7f4b;
}
.status.bad {
  background: #fdebe7;
  color: #b3361a;
}
.status.neutral {
  background: #eef1f5;
  color: #516f90;
}
.warn {
  margin: 0 0 12px;
  font-size: 13px;
  color: #8a5a00;
  background: #fff7e0;
  border: 1px solid #f3dd9b;
  border-radius: 8px;
  padding: 8px 12px;
}
@media (max-width: 480px) {
  .row {
    flex-wrap: wrap;
  }
  .time {
    flex-direction: row;
    gap: 6px;
    min-width: 100%;
  }
  .info {
    flex-basis: 60%;
  }
}
</style>