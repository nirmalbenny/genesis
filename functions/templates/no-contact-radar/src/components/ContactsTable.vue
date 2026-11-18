<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { relativeFromDays, formatDate, initialOf } from "../utils.js";

defineProps({
  rows: { type: Array, required: true },
});

const mq = window.matchMedia("(max-width: 640px)");
const isPhone = ref(mq.matches);
const onChange = (e) => (isPhone.value = e.matches);
onMounted(() => mq.addEventListener("change", onChange));
onUnmounted(() => mq.removeEventListener("change", onChange));
</script>

<template>
  <el-table :data="rows" row-key="id">
    <el-table-column label="Contact" min-width="200">
      <template #default="{ row }">
        <div class="who">
          <el-avatar :size="36">{{ initialOf(row.name) }}</el-avatar>
          <div class="info">
            <div class="name">{{ row.name }}</div>
            <div class="sub">{{ row.email || "No email" }}</div>
            <div class="sub">{{ row.phone || "No phone" }}</div>
            <div v-if="isPhone && row.tags.length" class="tags">
              <el-tag v-for="t in row.tags.slice(0, 3)" :key="t" size="small" type="info">{{ t }}</el-tag>
              <el-tag v-if="row.tags.length > 3" size="small" type="info">+{{ row.tags.length - 3 }}</el-tag>
            </div>
          </div>
        </div>
      </template>
    </el-table-column>

    <el-table-column v-if="!isPhone" label="Tags" min-width="180">
      <template #default="{ row }">
        <div v-if="row.tags.length" class="tags">
          <el-tag v-for="t in row.tags.slice(0, 4)" :key="t" size="small" type="info">{{ t }}</el-tag>
          <el-tag v-if="row.tags.length > 4" size="small" type="info">+{{ row.tags.length - 4 }}</el-tag>
        </div>
        <span v-else class="sub">No tags</span>
      </template>
    </el-table-column>

    <el-table-column label="Last conversation" :min-width="isPhone ? 120 : 160">
      <template #default="{ row }">
        <el-tag v-if="row.lastDate === null" type="danger" effect="dark">Never</el-tag>
        <div v-else :title="formatDate(row.lastDate)" class="name">{{ relativeFromDays(row.days) }}</div>
        <div class="sub">
          {{ row.lastDate === null ? "No conversation found" : row.days + (row.days === 1 ? " day" : " days") + " since" }}
        </div>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.who {
  display: flex;
  align-items: center;
  gap: 12px;
}
.info {
  min-width: 0;
}
.name {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.sub {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
</style>
