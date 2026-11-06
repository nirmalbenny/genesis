<script setup>
import { ref, computed, onMounted, nextTick } from "vue";
import { hlGet, LOCATION_ID } from "./api.js";
import { parseDate, dayKey, fmtDay } from "./utils.js";
import LoadState from "./components/LoadState.vue";
import AppointmentList from "./components/AppointmentList.vue";
import PrepSheet from "./components/PrepSheet.vue";

const DAYS = 14;

const calendars = ref([]);
const events = ref([]);
const loading = ref(false);
const error = ref("");
const warning = ref("");
const calendarFilter = ref("all");
const selectedId = ref("");
const sheetEl = ref(null);

const calendarNames = computed(() => {
  const map = {};
  for (const c of calendars.value) map[c.id] = c.name || "Untitled calendar";
  return map;
});

const filtered = computed(() =>
  calendarFilter.value === "all"
    ? events.value
    : events.value.filter((e) => e.calendarId === calendarFilter.value)
);

const groups = computed(() => {
  const map = new Map();
  for (const ev of filtered.value) {
    const d = parseDate(ev.startTime);
    const key = dayKey(d);
    if (!map.has(key)) map.set(key, { key, label: fmtDay(d), items: [] });
    map.get(key).items.push(ev);
  }
  return [...map.values()];
});

const selected = computed(() => filtered.value.find((e) => e.id === selectedId.value) || null);

async function load() {
  loading.value = true;
  error.value = "";
  warning.value = "";
  events.value = [];
  try {
    const cal = await hlGet("/calendars/", { locationId: LOCATION_ID });
    calendars.value = Array.isArray(cal.calendars) ? cal.calendars : [];
    if (!calendars.value.length) return;

    const start = Date.now();
    const end = start + DAYS * 24 * 60 * 60 * 1000;
    const results = await Promise.allSettled(
      calendars.value.map((c) =>
        hlGet("/calendars/events", {
          locationId: LOCATION_ID,
          calendarId: c.id,
          startTime: start,
          endTime: end,
        })
      )
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length === results.length) {
      throw failures[0].reason;
    }
    if (failures.length) {
      warning.value = `Some calendars could not be loaded: ${failures[0].reason?.message || "unknown error"}`;
    }

    const seen = new Set();
    const merged = [];
    results.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const list = Array.isArray(r.value.events) ? r.value.events : [];
      for (const ev of list) {
        if (!ev || !ev.id || seen.has(ev.id)) continue;
        seen.add(ev.id);
        merged.push({ ...ev, calendarId: ev.calendarId || calendars.value[i].id });
      }
    });
    merged.sort((a, b) => {
      const ta = parseDate(a.startTime)?.getTime() ?? Infinity;
      const tb = parseDate(b.startTime)?.getTime() ?? Infinity;
      return ta - tb;
    });
    events.value = merged;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function select(id) {
  selectedId.value = id;
  await nextTick();
  if (window.innerWidth < 860 && sheetEl.value) {
    sheetEl.value.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="top">
      <div>
        <h1>Appointment Prep Sheet</h1>
        <p class="muted">Upcoming appointments for the next {{ 14 }} days, with context on each contact.</p>
      </div>
      <button class="btn" type="button" :disabled="loading" @click="load">Refresh</button>
    </header>

    <div class="layout">
      <aside class="left">
        <div v-if="calendars.length" class="filter">
          <label for="cal">Calendar</label>
          <select id="cal" v-model="calendarFilter">
            <option value="all">All calendars</option>
            <option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.name || "Untitled calendar" }}</option>
          </select>
        </div>

        <p v-if="warning" class="warning">{{ warning }}</p>

        <LoadState
          :loading="loading"
          :error="error"
          :empty="!filtered.length"
          loading-text="Loading appointments…"
          :empty-title="events.length ? 'No appointments on this calendar' : 'No upcoming appointments'"
          :empty-text="
            events.length
              ? 'Try choosing a different calendar.'
              : 'Appointments booked in your HighLevel calendars over the next 14 days will appear here.'
          "
          @retry="load"
        >
          <AppointmentList
            :groups="groups"
            :selected-id="selectedId"
            :calendar-names="calendarNames"
            @select="select"
          />
        </LoadState>
      </aside>

      <section ref="sheetEl" class="right">
        <PrepSheet
          v-if="selected"
          :key="selected.id"
          :appointment="selected"
          :calendar-name="calendarNames[selected.calendarId] || ''"
        />
        <div v-else class="card placeholder">
          <strong>Select an appointment</strong>
          <span class="muted">Choose an appointment on the left to see its prep sheet.</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 20px 48px;
}
.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
}
h1 {
  margin: 0 0 4px;
  font-size: 26px;
}
.top p {
  margin: 0;
}
.layout {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 24px;
  align-items: start;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.right {
  min-width: 0;
  scroll-margin-top: 16px;
}
.filter {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.filter label {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
select {
  font: inherit;
  color: var(--navy);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  width: 100%;
}
select:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.warning {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff3e0;
  color: #b25e00;
  font-size: 14px;
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  padding: 48px 20px;
}
@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 480px) {
  .page {
    padding: 20px 12px 32px;
  }
  h1 {
    font-size: 22px;
  }
  .top {
    flex-direction: column;
  }
}
</style>