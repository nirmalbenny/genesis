<template>
  <div class="card">
    <h2 class="card-title">
      Appointments
      <span v-if="!loading && !error" class="count">{{ events.length }}</span>
    </h2>

    <StateBlock
      :loading="loading"
      :error="error"
      :empty="!events.length"
      empty-text="No appointments for this contact."
      loading-text="Loading appointments…"
      @retry="load"
    >
      <div class="group">
        <h3 class="sub">Upcoming <span class="count">{{ upcoming.length }}</span></h3>
        <p v-if="!upcoming.length" class="muted none">No upcoming appointments.</p>
        <ul v-else class="list">
          <li v-for="e in upcoming" :key="e.id" class="appt up">
            <div class="when">{{ fmtDateTime(e.startTime) }}</div>
            <div class="what">
              <span class="t">{{ e.title || "Untitled appointment" }}</span>
              <span v-if="e.appointmentStatus" class="badge">{{ e.appointmentStatus }}</span>
            </div>
          </li>
        </ul>
      </div>

      <div class="group">
        <h3 class="sub">Past <span class="count">{{ past.length }}</span></h3>
        <p v-if="!past.length" class="muted none">No past appointments.</p>
        <ul v-else class="list">
          <li v-for="e in past" :key="e.id" class="appt">
            <div class="when">{{ fmtDateTime(e.startTime) }}</div>
            <div class="what">
              <span class="t">{{ e.title || "Untitled appointment" }}</span>
              <span v-if="e.appointmentStatus" class="badge">{{ e.appointmentStatus }}</span>
            </div>
          </li>
        </ul>
      </div>
    </StateBlock>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { hl } from "../api.js";
import { fmtDateTime, toDate } from "../utils.js";
import StateBlock from "./StateBlock.vue";

const props = defineProps({ contactId: { type: String, required: true } });

const events = ref([]);
const loading = ref(false);
const error = ref("");
let reqId = 0;

function time(e) {
  const d = toDate(e && e.startTime);
  return d ? d.getTime() : null;
}

const upcoming = computed(() => {
  const now = Date.now();
  return events.value
    .filter((e) => time(e) !== null && time(e) >= now)
    .sort((a, b) => time(a) - time(b));
});

const past = computed(() => {
  const now = Date.now();
  return events.value
    .filter((e) => time(e) === null || time(e) < now)
    .sort((a, b) => (time(b) ?? -Infinity) - (time(a) ?? -Infinity));
});

async function load() {
  const id = ++reqId;
  loading.value = true;
  error.value = "";
  events.value = [];
  try {
    const data = await hl(`/contacts/${encodeURIComponent(props.contactId)}/appointments`);
    if (id !== reqId) return;
    events.value = Array.isArray(data.events) ? data.events : [];
  } catch (e) {
    if (id !== reqId) return;
    error.value = e.message;
  } finally {
    if (id === reqId) loading.value = false;
  }
}

watch(() => props.contactId, load, { immediate: true });
</script>

<style scoped>
.group + .group {
  margin-top: 20px;
}

.sub {
  margin: 0 0 8px;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 8px;
}

.none {
  margin: 0;
  font-size: 0.9rem;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.appt {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  border: 1px solid var(--border);
  border-left: 4px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}

.appt.up {
  border-left-color: var(--accent);
}

.when {
  font-weight: 600;
}

.what {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.t {
  color: var(--muted);
  word-break: break-word;
}
</style>