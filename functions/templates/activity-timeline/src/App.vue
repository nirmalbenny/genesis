<script setup>
import { ref, computed } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { LOCATION_NAME } from "./genesis/hl.js";
import { fetchTimeline } from "./timeline.js";
import ContactPicker from "./components/ContactPicker.vue";
import ContactHeader from "./components/ContactHeader.vue";
import FilterChips from "./components/FilterChips.vue";
import Timeline from "./components/Timeline.vue";
import StatusBlock from "./components/StatusBlock.vue";

const contact = ref(null);
const items = ref([]);
const loading = ref(false);
const error = ref("");
const filter = ref("all");

let reqId = 0;

async function loadTimeline() {
  if (!contact.value) return;
  const id = ++reqId;
  loading.value = true;
  error.value = "";
  items.value = [];
  try {
    const result = await fetchTimeline(contact.value.id);
    if (id !== reqId) return;
    items.value = result;
  } catch (e) {
    if (id !== reqId) return;
    error.value = e.message;
  } finally {
    if (id === reqId) loading.value = false;
  }
}

// Open the newest contact straight away instead of an empty screen.
function onContactsLoaded(list) {
  if (!contact.value && list.length) onSelect(list[0]);
}

function onSelect(c) {
  contact.value = c;
  filter.value = "all";
  loadTimeline();
}

const counts = computed(() => {
  const msgs = items.value.filter((i) => i.type !== "appointment").length;
  return { all: items.value.length, messages: msgs, appointments: items.value.length - msgs };
});

const stats = computed(() => {
  if (loading.value || error.value) return null;
  const now = Date.now();
  const appts = items.value.filter((i) => i.type === "appointment");
  const next = appts.filter((a) => a.date && a.date.getTime() > now).sort((a, b) => a.date - b.date)[0];
  const last = items.value.filter((i) => i.date && i.date.getTime() <= now).sort((a, b) => b.date - a.date)[0];
  return {
    messages: items.value.length - appts.length,
    appointments: appts.length,
    next: next?.date ?? null,
    last: last?.date ?? null,
  };
});

const filtered = computed(() => {
  if (filter.value === "messages") return items.value.filter((i) => i.type !== "appointment");
  if (filter.value === "appointments") return items.value.filter((i) => i.type === "appointment");
  return items.value;
});
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h1>Activity Timeline<template v-if="LOCATION_NAME"> · {{ LOCATION_NAME }}</template></h1>
        <p class="sub">Every message and appointment for a contact, in one place.</p>
      </div>
      <el-button v-if="contact" :icon="Refresh" :loading="loading" @click="loadTimeline">Refresh</el-button>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :md="9" :lg="7" class="col">
        <ContactPicker :selected-id="contact ? contact.id : ''" @select="onSelect" @loaded="onContactsLoaded" />
      </el-col>

      <el-col :xs="24" :md="15" :lg="17" class="col">
        <el-card v-if="!contact" shadow="never">
          <StatusBlock state="empty" title="Select a contact" message="Pick someone from the list to see their messages and appointments." />
        </el-card>

        <div v-else class="main">
          <ContactHeader :contact="contact" :stats="stats" />

          <el-card shadow="never">
            <template #header>
              <div class="activity-head">
                <span class="card-title">Activity</span>
                <FilterChips v-if="items.length" v-model="filter" :counts="counts" />
              </div>
            </template>

            <StatusBlock v-if="loading" state="loading" />
            <StatusBlock v-else-if="error" state="error" title="Couldn't load the timeline" :message="error" @retry="loadTimeline" />
            <StatusBlock v-else-if="!items.length" state="empty" title="No activity yet" message="Messages and appointments with this contact will show up here." />
            <StatusBlock
              v-else-if="!filtered.length"
              state="empty"
              :title="filter === 'messages' ? 'No messages' : 'No appointments'"
              message="Nothing matches this filter. Try another one."
            />
            <Timeline v-else :items="filtered" />
          </el-card>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.head h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.sub {
  margin: 2px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.col {
  margin-bottom: 16px;
}
.main {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.activity-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.card-title {
  font-weight: 600;
}
</style>
