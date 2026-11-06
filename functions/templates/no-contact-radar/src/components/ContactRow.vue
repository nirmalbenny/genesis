<script setup>
import { computed } from "vue";
import { relativeFromDays, formatDate } from "../utils.js";

const props = defineProps({
  row: { type: Object, required: true },
});

const never = computed(() => props.row.lastDate === null);
const relative = computed(() => relativeFromDays(props.row.days));
const exact = computed(() => formatDate(props.row.lastDate));
const initial = computed(() => ((props.row.name || "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase());
const tags = computed(() => (Array.isArray(props.row.tags) ? props.row.tags.slice(0, 4) : []));
const extraTags = computed(() =>
  Array.isArray(props.row.tags) ? Math.max(0, props.row.tags.length - 4) : 0
);
</script>

<template>
  <li class="row">
    <div class="avatar" aria-hidden="true">{{ initial }}</div>

    <div class="who">
      <div class="name">{{ row.name }}</div>
      <div class="sub">{{ row.email || "No email" }}</div>
      <div class="sub">{{ row.phone || "No phone" }}</div>
    </div>

    <div class="tags">
      <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
      <span v-if="extraTags" class="tag more">+{{ extraTags }}</span>
      <span v-if="!tags.length" class="sub">No tags</span>
    </div>

    <div class="last">
      <span v-if="never" class="badge">Never</span>
      <span v-else class="rel" :title="exact">{{ relative }}</span>
      <span class="sub">
        {{ never ? "No conversation found" : row.days + (row.days === 1 ? " day" : " days") + " since" }}
      </span>
    </div>
  </li>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 40px minmax(0, 2fr) minmax(0, 1.5fr) minmax(0, 1.2fr);
  gap: 16px;
  align-items: center;
  padding: 14px 20px;
  border-top: 1px solid #dfe3eb;
}
.row:first-child {
  border-top: 0;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #fff1ed;
  color: #ff5c35;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.name {
  font-weight: 600;
  color: #213343;
  overflow-wrap: anywhere;
}
.sub {
  color: #516f90;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag {
  background: #eaf0f6;
  color: #33475b;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.tag.more {
  background: #f5f8fa;
  color: #516f90;
}
.last {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.rel {
  font-weight: 600;
  color: #213343;
}
.badge {
  background: #ff5c35;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 999px;
}

@media (max-width: 720px) {
  .row {
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 10px 14px;
    padding: 14px 16px;
  }
  .tags,
  .last {
    grid-column: 2;
  }
}
</style>
