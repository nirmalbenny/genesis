<script setup>
import { computed } from "vue";
import { toDate } from "../genesis/hl.js";
import { fmtDay, fmtTime, statusType, capitalize } from "../utils.js";
import ContactCard from "./ContactCard.vue";
import MessageList from "./MessageList.vue";

const props = defineProps({
  appointment: { type: Object, required: true },
  calendarName: { type: String, default: "" },
});

const start = computed(() => toDate(props.appointment.startTime));
const end = computed(() => toDate(props.appointment.endTime));
</script>

<template>
  <div class="sheet">
    <el-card>
      <template #header>
        <div class="head">
          <span class="title">{{ appointment.title || "Untitled appointment" }}</span>
          <el-tag v-if="appointment.appointmentStatus" :type="statusType(appointment.appointmentStatus)">
            {{ capitalize(appointment.appointmentStatus) }}
          </el-tag>
        </div>
      </template>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="When">
          <template v-if="start">
            {{ fmtDay(start) }}, {{ fmtTime(start) }}<template v-if="end"> – {{ fmtTime(end) }}</template>
          </template>
          <template v-else>Time not set</template>
        </el-descriptions-item>
        <el-descriptions-item label="Calendar">{{ calendarName || "Unknown calendar" }}</el-descriptions-item>
        <el-descriptions-item v-if="appointment.address" label="Address">
          {{ appointment.address }}
        </el-descriptions-item>
        <el-descriptions-item v-if="appointment.notes" label="Notes">
          <span class="notes">{{ appointment.notes }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

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
}
.title {
  font-size: 18px;
  font-weight: 600;
  word-break: break-word;
}
.notes {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
