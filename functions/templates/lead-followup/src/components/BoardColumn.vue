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
  <el-card shadow="never" class="column">
    <template #header>
      <div class="head">
        <strong>{{ title }}</strong>
        <el-tag round type="info">{{ cards.length }}</el-tag>
      </div>
      <div v-if="hint" class="hint">{{ hint }}</div>
    </template>

    <div class="list">
      <LeadCard v-for="c in cards" :key="c.id" :card="c" />
      <el-empty
        v-if="!cards.length"
        :image-size="60"
        :description="filtering ? 'No leads match your search.' : 'Nothing here right now.'"
      />
    </div>
  </el-card>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hint {
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.list {
  display: grid;
  gap: 12px;
}
</style>
