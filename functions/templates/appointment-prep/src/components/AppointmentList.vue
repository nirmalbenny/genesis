<script setup>
import { toDate } from "../genesis/hl.js";
import { fmtTime, statusType, capitalize } from "../utils.js";

defineProps({
  groups: { type: Array, required: true },
  selectedId: { type: String, default: "" },
  calendarNames: { type: Object, default: () => ({}) },
});
defineEmits(["select"]);
</script>

<template>
  <div class="groups">
    <section v-for="g in groups" :key="g.key" class="group">
      <h3 class="day">{{ g.label }}</h3>
      <div class="items">
        <button
          v-for="ev in g.items"
          :key="ev.id"
          type="button"
          class="item"
          :class="{ active: ev.id === selectedId }"
          @click="$emit('select', ev.id)"
        >
          <span class="time">{{ fmtTime(toDate(ev.startTime)) }}</span>
          <span class="body">
            <span class="title">{{ ev.title || "Untitled appointment" }}</span>
            <span class="cal">{{ calendarNames[ev.calendarId] || "Unknown calendar" }}</span>
          </span>
          <el-tag v-if="ev.appointmentStatus" :type="statusType(ev.appointmentStatus)" size="small">
            {{ capitalize(ev.appointmentStatus) }}
          </el-tag>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.day {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--el-text-color-secondary);
}
.items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  font: inherit;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  padding: 12px;
  cursor: pointer;
}
.item:hover {
  border-color: var(--el-color-primary-light-5);
}
.item.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.time {
  font-weight: 600;
  font-size: 13px;
  min-width: 66px;
}
.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
