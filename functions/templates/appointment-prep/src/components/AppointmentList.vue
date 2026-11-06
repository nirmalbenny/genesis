<script setup>
import { fmtTime, parseDate, statusClass } from "../utils.js";

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
      <ul>
        <li v-for="ev in g.items" :key="ev.id">
          <button
            type="button"
            class="item"
            :class="{ active: ev.id === selectedId }"
            @click="$emit('select', ev.id)"
          >
            <span class="time">{{ fmtTime(parseDate(ev.startTime)) }}</span>
            <span class="body">
              <span class="title">{{ ev.title || "Untitled appointment" }}</span>
              <span class="cal muted">{{ calendarNames[ev.calendarId] || "Unknown calendar" }}</span>
            </span>
            <span v-if="ev.appointmentStatus" class="badge" :class="statusClass(ev.appointmentStatus)">
              {{ ev.appointmentStatus }}
            </span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.groups {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.day {
  margin: 0 0 8px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
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
  color: var(--navy);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
}
.item:hover {
  border-color: var(--muted);
}
.item.active {
  border-color: var(--accent);
  box-shadow: inset 3px 0 0 var(--accent);
}
.time {
  font-weight: 700;
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
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cal {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>