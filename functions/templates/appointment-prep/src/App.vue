<script setup>
import { ref, computed, onMounted, nextTick } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { LOCATION_NAME } from "./genesis/hl.js";
import { useAppointments, DAYS } from "./useAppointments.js";
import LoadState from "./components/LoadState.vue";
import AppointmentList from "./components/AppointmentList.vue";
import PrepSheet from "./components/PrepSheet.vue";

const { calendars, events, loading, error, warning, calendarFilter, calendarNames, filtered, groups, load } =
  useAppointments();

const selectedId = ref("");
const sheetEl = ref(null);

const selected = computed(() => filtered.value.find((e) => e.id === selectedId.value) || null);

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
    <div class="top">
      <div>
        <h1>Appointment Prep Sheet<template v-if="LOCATION_NAME"> · {{ LOCATION_NAME }}</template></h1>
        <p class="sub">Upcoming appointments for the next {{ DAYS }} days, with context on each contact.</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="load">Refresh</el-button>
    </div>

    <div class="layout">
      <aside class="left">
        <el-select
          v-if="calendars.length"
          v-model="calendarFilter"
          placeholder="Calendar"
          aria-label="Calendar"
        >
          <el-option label="All calendars" value="all" />
          <el-option v-for="c in calendars" :key="c.id" :label="c.name || 'Untitled calendar'" :value="c.id" />
        </el-select>

        <el-alert v-if="warning" type="warning" show-icon :closable="false" :title="warning" />

        <LoadState
          :loading="loading"
          :error="error"
          :empty="!filtered.length"
          loading-text="Loading appointments…"
          :empty-title="events.length ? 'No appointments on this calendar' : 'No upcoming appointments'"
          :empty-text="
            events.length
              ? 'Try choosing a different calendar.'
              : `Appointments booked in your HighLevel calendars over the next ${DAYS} days will appear here.`
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
        <el-card v-else>
          <el-empty description="Choose an appointment on the left to see its prep sheet." />
        </el-card>
      </section>
    </div>
  </div>
</template>

<style scoped>
.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 600;
}
.sub {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.layout {
  display: grid;
  grid-template-columns: 380px 1fr;
  gap: 20px;
  align-items: start;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.right {
  min-width: 0;
  scroll-margin-top: 16px;
}
@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 480px) {
  .top {
    flex-direction: column;
  }
}
</style>
