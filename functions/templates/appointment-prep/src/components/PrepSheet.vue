<script setup>
import { computed } from "vue";
import { fmtDay, fmtTime, parseDate, statusClass } from "../utils.js";
import ContactCard from "./ContactCard.vue";
import MessageList from "./MessageList.vue";

const props = defineProps({
  appointment: { type: Object, required: true },
  calendarName: { type: String, default: "" },
});

const start = computed(() => parseDate(props.appointment.startTime));
const end = computed(() => parseDate(props.appointment.endTime));
</script>

<template>
  <div class="sheet">
    <section class="card">
      <div class="head">
        <h2>{{ appointment.title || "Untitled appointment" }}</h2>
        <span v-if="appointment.appointmentStatus" class="badge" :class="statusClass(appointment.appointmentStatus)">
          {{ appointment.appointmentStatus }}
        </span>
      </div>
      <dl>
        <dt>When</dt>
        <dd>
          <template v-if="start">
            {{ fmtDay(start) }}, {{ fmtTime(start) }}<template v-if="end"> – {{ fmtTime(end) }}</template>
          </template>
          <template v-else>Time not set</template>
        </dd>
        <dt>Calendar</dt>
        <dd>{{ calendarName || "Unknown calendar" }}</dd>
        <template v-if="appointment.address">
          <dt>Address</dt>
          <dd>{{ appointment.address }}</dd>
        </template>
        <template v-if="appointment.notes">
          <dt>Notes</dt>
          <dd class="notes">{{ appointment.notes }}</dd>
        </template>
      </dl>
    </section>

    <ContactCard :key="'c-' + appointment.id" :contact-id="appointment.contactId || ''" />
    <MessageList :key="'m-' + appointment.id" :contact-id="appointment.contactId || ''" />
  </div>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
h2 {
  margin: 0;
  font-size: 20px;
  word-break: break-word;
}
dl {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 8px 12px;
  margin: 0;
}
dt {
  color: var(--muted);
  font-size: 14px;
}
dd {
  margin: 0;
  word-break: break-word;
}
.notes {
  white-space: pre-wrap;
}
@media (max-width: 420px) {
  dl {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  dd {
    margin-bottom: 8px;
  }
}
</style>