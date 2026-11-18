<template>
  <el-empty v-if="!items.length" :description="emptyText" :image-size="50" />
  <el-timeline v-else>
    <el-timeline-item
      v-for="e in items"
      :key="e.id"
      :timestamp="fmtDateTime(e.when)"
      :type="upcoming ? 'primary' : ''"
      placement="top"
    >
      <div class="what">
        <span>{{ e.title || "Untitled appointment" }}</span>
        <el-tag v-if="e.appointmentStatus" size="small" :type="statusType(e.appointmentStatus)">
          {{ e.appointmentStatus }}
        </el-tag>
      </div>
    </el-timeline-item>
  </el-timeline>
</template>

<script setup>
import { fmtDateTime } from "../utils.js";

defineProps({
  items: { type: Array, required: true },
  emptyText: { type: String, default: "Nothing here." },
  upcoming: Boolean,
});

function statusType(s) {
  return (
    { confirmed: "success", showed: "success", new: "primary", noshow: "danger", cancelled: "info", invalid: "warning" }[
      s
    ] || "info"
  );
}
</script>

<style scoped>
.what {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  word-break: break-word;
}
</style>
