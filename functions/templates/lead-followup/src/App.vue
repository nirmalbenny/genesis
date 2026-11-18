<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { Search, Refresh } from "@element-plus/icons-vue";
import { usePager, LOCATION_NAME } from "./genesis/hl.js";
import { useAppointments } from "./useAppointments.js";
import { buildCards, matchesSearch } from "./board.js";
import { toDate } from "./genesis/hl.js";
import BoardColumn from "./components/BoardColumn.vue";
import SourceStatus from "./components/SourceStatus.vue";

const contacts = usePager("contacts", () => ({ sortBy: "date_added", order: "desc", limit: 50 }));
const conversations = usePager("conversations", () => ({ limit: 100 }));
const appts = useAppointments();

const search = ref("");

// A pager counts as "started" once it has begun loading at least once.
function useStarted(pager) {
  const started = ref(false);
  watch(pager.loading, (v) => { if (v) started.value = true; }, { immediate: true });
  return started;
}
const contactsStarted = useStarted(contacts);
const convStarted = useStarted(conversations);

function pagerStatus(pager, started) {
  if (!pager.items.value.length) {
    if (pager.error.value) return "error";
    if (!started.value || pager.loading.value) return "loading";
  }
  return "ready";
}

const sources = computed(() => [
  {
    key: "contacts",
    label: "Contacts (newest first)",
    status: pagerStatus(contacts, contactsStarted),
    error: contacts.error.value && contacts.error.value.message,
  },
  {
    key: "conversations",
    label: "Conversations (latest 100)",
    status: pagerStatus(conversations, convStarted),
    error: conversations.error.value && conversations.error.value.message,
  },
  {
    key: "appointments",
    label: "Appointments (next 30 days)",
    status: appts.error.value ? "error" : appts.loaded.value ? "ready" : "loading",
    error: appts.error.value && appts.error.value.message,
  },
]);

const allReady = computed(() => sources.value.every((s) => s.status === "ready"));
const anyLoading = computed(
  () => contacts.loading.value || conversations.loading.value || appts.loading.value
);

function retry(key) {
  if (key === "contacts") contacts.reset();
  else if (key === "conversations") conversations.reset();
  else appts.load();
}

function refreshAll() {
  contacts.reset();
  conversations.reset();
  appts.load();
}

onMounted(appts.load);

const cards = computed(() =>
  allReady.value ? buildCards(contacts.items.value, conversations.items.value, appts.events.value) : []
);
const filtered = computed(() => cards.value.filter((c) => matchesSearch(c, search.value)));
const first = computed(() => filtered.value.filter((c) => c.column === "first"));
const conversation = computed(() => filtered.value.filter((c) => c.column === "conversation"));
const booked = computed(() =>
  filtered.value
    .filter((c) => c.column === "booked")
    .sort((a, b) => toDate(a.appointment.startTime) - toDate(b.appointment.startTime))
);
const filtering = computed(() => search.value.trim().length > 0);

const loadedNote = computed(() => {
  const n = contacts.items.value.length;
  const t = contacts.total.value;
  return t ? `Based on the ${n} newest of ${t} contacts` : `Based on the ${n} newest contacts`;
});
</script>

<template>
  <div class="page">
    <div class="header">
      <div>
        <h1>Lead Follow-up Board<span v-if="LOCATION_NAME"> · {{ LOCATION_NAME }}</span></h1>
        <p class="note">{{ loadedNote }}</p>
      </div>
      <div class="tools">
        <el-input
          v-model="search"
          clearable
          :prefix-icon="Search"
          placeholder="Search name, tag, source, message…"
          aria-label="Search leads"
        />
        <el-button :icon="Refresh" :loading="anyLoading" @click="refreshAll">Refresh</el-button>
      </div>
    </div>

    <SourceStatus v-if="!allReady" :sources="sources" @retry="retry" />

    <el-card v-else-if="!contacts.items.value.length" shadow="never">
      <el-empty description="No leads yet. New contacts added to this location will show up here." />
    </el-card>

    <template v-else>
      <el-alert
        v-if="contacts.error.value"
        type="error"
        show-icon
        :closable="false"
        :title="contacts.error.value.message"
      />
      <el-row :gutter="16">
        <el-col :xs="24" :md="8" class="col">
          <BoardColumn title="Needs first touch" hint="No conversation yet" :cards="first" :filtering="filtering" />
        </el-col>
        <el-col :xs="24" :md="8" class="col">
          <BoardColumn title="In conversation" hint="Talking, nothing booked" :cards="conversation" :filtering="filtering" />
        </el-col>
        <el-col :xs="24" :md="8" class="col">
          <BoardColumn
            title="Booked"
            hint="Upcoming appointment in the next 30 days"
            :cards="booked"
            :filtering="filtering"
          />
        </el-col>
      </el-row>
      <div class="more">
        <span class="note">
          Showing {{ contacts.items.value.length }}<template v-if="contacts.total.value"> of {{ contacts.total.value }}</template> contacts
        </span>
        <el-button v-if="contacts.hasMore.value" :loading="contacts.loading.value" @click="contacts.loadMore()">
          Load more
        </el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  align-items: flex-end;
  justify-content: space-between;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.note {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.tools {
  display: flex;
  gap: 10px;
  flex: 1 1 320px;
  justify-content: flex-end;
}
.tools .el-input {
  max-width: 360px;
}
.col {
  margin-bottom: 16px;
}
.more {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: center;
}
.more .note {
  margin: 0;
}
@media (max-width: 640px) {
  .tools {
    justify-content: stretch;
  }
  .tools .el-input {
    max-width: none;
  }
}
</style>
