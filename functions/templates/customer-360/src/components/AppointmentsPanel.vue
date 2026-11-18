<template>
  <el-card shadow="never">
    <template #header>
      <div class="head">
        <span class="title">Appointments</span>
        <el-tag v-if="!loading && !error" size="small" type="info" round>{{ events.length }}</el-tag>
      </div>
    </template>

    <StateBlock
      :loading="loading"
      :error="error"
      :empty="!events.length"
      empty-text="No appointments for this contact."
      loading-text="Loading appointments…"
      @retry="load"
    >
      <h3 class="sub">Upcoming ({{ upcoming.length }})</h3>
      <AppointmentList :items="upcoming" upcoming empty-text="No upcoming appointments." />

      <h3 class="sub">Past ({{ past.length }})</h3>
      <AppointmentList :items="past" empty-text="No past appointments." />
    </StateBlock>
  </el-card>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { contactAppointments, toDate } from "../genesis/hl.js";
import StateBlock from "./StateBlock.vue";
import AppointmentList from "./AppointmentList.vue";

const props = defineProps({ contactId: { type: String, required: true } });

const events = ref([]);
const loading = ref(false);
const error = ref("");
let reqId = 0;

const withTime = computed(() =>
  events.value.map((e) => {
    const d = e.start instanceof Date ? e.start : toDate(e.start || e.startTime);
    return { ...e, when: d, ts: d ? d.getTime() : null };
  })
);

const upcoming = computed(() => {
  const now = Date.now();
  return withTime.value.filter((e) => e.ts !== null && e.ts >= now).sort((a, b) => a.ts - b.ts);
});

const past = computed(() => {
  const now = Date.now();
  return withTime.value
    .filter((e) => e.ts === null || e.ts < now)
    .sort((a, b) => (b.ts ?? -Infinity) - (a.ts ?? -Infinity));
});

async function load() {
  const id = ++reqId;
  loading.value = true;
  error.value = "";
  events.value = [];
  try {
    const list = await contactAppointments(props.contactId);
    if (id !== reqId) return;
    events.value = Array.isArray(list) ? list : [];
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
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title {
  font-weight: 600;
}
.sub {
  margin: 8px 0;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--el-text-color-secondary);
}
</style>
