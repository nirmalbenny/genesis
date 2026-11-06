<script setup>
import LeadCard from "./LeadCard.vue";

defineProps({
  title: { type: String, required: true },
  hint: { type: String, default: "" },
  cards: { type: Array, required: true },
  filtering: { type: Boolean, default: false },
});
</script>

<template>
  <section class="column">
    <header class="head">
      <h2>{{ title }}</h2>
      <span class="count">{{ cards.length }}</span>
    </header>
    <p v-if="hint" class="hint">{{ hint }}</p>

    <div class="list">
      <LeadCard v-for="c in cards" :key="c.id" :card="c" />
      <p v-if="!cards.length" class="empty">
        {{ filtering ? "No leads match your search." : "Nothing here right now." }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.column {
  background: #eaf0f6;
  border-radius: 10px;
  padding: 14px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h2 {
  margin: 0;
  font-size: 16px;
  color: #213343;
}
.count {
  background: #fff;
  border: 1px solid #dfe3eb;
  color: #213343;
  font-weight: 600;
  font-size: 13px;
  min-width: 28px;
  text-align: center;
  padding: 2px 8px;
  border-radius: 999px;
}
.hint {
  margin: 0;
  font-size: 13px;
  color: #516f90;
}
.list {
  display: grid;
  gap: 12px;
  margin-top: 6px;
}
.empty {
  margin: 0;
  padding: 20px 12px;
  text-align: center;
  color: #516f90;
  font-size: 14px;
  border: 1px dashed #c5d0de;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.5);
}
</style>
