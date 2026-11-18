<script setup>
import { computed } from "vue";
import { Message, Phone } from "@element-plus/icons-vue";
import { contactName } from "../genesis/hl.js";
import { initials, relative, dayLabel, timeLabel } from "../utils.js";

const props = defineProps({
  contact: { type: Object, required: true },
  /** { messages, appointments, next: Date|null, last: Date|null } once the timeline has loaded. */
  stats: { type: Object, default: null },
});
const name = computed(() => contactName(props.contact));
const tags = computed(() => (Array.isArray(props.contact.tags) ? props.contact.tags.filter((t) => t !== "genesis-demo") : []));
const place = computed(() => [props.contact.address1, props.contact.city].filter(Boolean).join(", "));

const nextText = computed(() =>
  props.stats && props.stats.next ? `${dayLabel(props.stats.next)}, ${timeLabel(props.stats.next)}` : "None booked",
);
const lastText = computed(() => (props.stats && props.stats.last ? relative(props.stats.last) : "No activity"));
const valueStyle = { fontSize: "18px", fontWeight: 600 };
</script>

<template>
  <el-card shadow="never">
    <div class="who">
      <el-avatar :size="56">{{ initials(name) }}</el-avatar>
      <div class="id">
        <h2>{{ name }}</h2>
        <p v-if="contact.companyName || place || contact.source" class="sub">
          <span v-if="contact.companyName">{{ contact.companyName }}</span>
          <span v-if="place">{{ place }}</span>
          <span v-if="contact.source">via {{ contact.source }}</span>
        </p>
        <div class="links">
          <el-link v-if="contact.email" :href="`mailto:${contact.email}`" :icon="Message" underline="never">{{ contact.email }}</el-link>
          <el-link v-if="contact.phone" :href="`tel:${contact.phone}`" :icon="Phone" underline="never">{{ contact.phone }}</el-link>
        </div>
        <div v-if="tags.length" class="tags">
          <el-tag v-for="t in tags" :key="t" type="info" size="small">{{ t }}</el-tag>
        </div>
      </div>
    </div>

    <el-divider />

    <el-row :gutter="12" class="stats">
      <el-col :xs="12" :sm="6">
        <el-statistic title="Messages" :value="stats ? stats.messages : 0" :formatter="stats ? undefined : () => '–'" :value-style="valueStyle" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-statistic title="Appointments" :value="stats ? stats.appointments : 0" :formatter="stats ? undefined : () => '–'" :value-style="valueStyle" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-statistic title="Next appointment" :value="0" :formatter="() => nextText" :value-style="{ ...valueStyle, fontSize: '15px' }" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-statistic title="Last activity" :value="0" :formatter="() => lastText" :value-style="{ ...valueStyle, fontSize: '15px' }" />
      </el-col>
    </el-row>
  </el-card>
</template>

<style scoped>
.who {
  display: flex;
  gap: 16px;
}
.id {
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.sub {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.links,
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 10px;
}
.tags {
  gap: 6px;
}
.stats .el-col {
  margin-bottom: 8px;
}
</style>
