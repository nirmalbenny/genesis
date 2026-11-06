<script setup>
import { computed } from "vue";
import { dayKey, dayLabel } from "../utils.js";
import TimelineItem from "./TimelineItem.vue";

const props = defineProps({ items: { type: Array, required: true } });

// Future appointments are shown first, soonest on top; everything else is history.
const upcoming = computed(() =>
  props.items
    .filter((i) => i.type === "appointment" && i.date && i.date.getTime() > Date.now())
    .sort((a, b) => a.date - b.date),
);

// History: newest day first; inside a day, oldest first so conversations read naturally.
const history = computed(() => {
  const groups = new Map();
  for (const item of props.items) {
    if (upcoming.value.includes(item)) continue;
    const key = dayKey(item.date);
    if (!groups.has(key)) groups.set(key, { key, label: dayLabel(item.date), date: item.date, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()]
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0)) }));
});
</script>

<template>
  <div class="timeline">
    <section v-if="upcoming.length" class="block">
      <h3 class="block-title">Upcoming</h3>
      <ul class="upcoming">
        <TimelineItem v-for="it in upcoming" :key="it.id" :item="it" upcoming />
      </ul>
    </section>

    <section v-if="history.length" class="block">
      <h3 class="block-title">History</h3>
      <div v-for="g in history" :key="g.key" class="day">
        <div class="day-header"><span>{{ g.label }}</span></div>
        <ul class="thread">
          <TimelineItem v-for="it in g.items" :key="it.id" :item="it" />
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.block-title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  color: #7c98b6;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.upcoming {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.day-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  justify-content: center;
  padding: 10px 0;
  background: linear-gradient(#f5f8fa 70%, rgba(245, 248, 250, 0));
}
.day-header span {
  padding: 3px 12px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #dfe3eb;
  font-size: 12px;
  font-weight: 600;
  color: #516f90;
}
.thread {
  list-style: none;
  margin: 0;
  padding: 4px 0 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
