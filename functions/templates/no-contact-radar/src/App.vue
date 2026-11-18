<script setup>
import { ref, computed, watch } from "vue";
import { usePager, contactName, toDate, LOCATION_NAME } from "./genesis/hl.js";
import { daysSince } from "./utils.js";
import ControlsBar from "./components/ControlsBar.vue";
import ContactsTable from "./components/ContactsTable.vue";
import StatusBlock from "./components/StatusBlock.vue";
import LoadMoreBar from "./components/LoadMoreBar.vue";

const OPTIONS = [7, 14, 30, 90];

const days = ref(30);
const includeNever = ref(true);
const query = ref("");
const now = ref(Date.now());

const contactsPager = usePager("contacts", { sortBy: "date_added", order: "desc", limit: 100 });
const convPager = usePager("conversations", { limit: 100 });

const contacts = computed(() => contactsPager.items.value || []);
const conversations = computed(() => convPager.items.value || []);

watch([contacts, conversations], () => {
  now.value = Date.now();
});

const loadingFirst = computed(
  () =>
    (contactsPager.loading.value && !contacts.value.length && !contactsPager.error.value) ||
    (convPager.loading.value && !conversations.value.length && !convPager.error.value)
);

// contactId -> latest lastMessageDate (ms)
const lastByContact = computed(() => {
  const map = new Map();
  for (const conv of conversations.value) {
    if (!conv || !conv.contactId) continue;
    const ts = toDate(conv.lastMessageDate)?.getTime();
    if (!Number.isFinite(ts)) continue;
    const prev = map.get(conv.contactId);
    if (prev === undefined || ts > prev) map.set(conv.contactId, ts);
  }
  return map;
});

const allRows = computed(() =>
  contacts.value
    .filter((c) => c && c.id)
    .map((c) => {
      const lastDate = lastByContact.value.has(c.id) ? lastByContact.value.get(c.id) : null;
      return {
        id: c.id,
        name: contactName(c) || c.email || c.phone || "Unnamed contact",
        email: c.email || "",
        phone: c.phone || "",
        tags: Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === "string") : [],
        added: toDate(c.dateAdded)?.getTime() ?? null,
        lastDate,
        days: daysSince(lastDate, now.value),
      };
    })
);

const overdueRows = computed(() =>
  allRows.value.filter((r) => (r.lastDate === null ? includeNever.value : r.days >= days.value))
);

const visibleRows = computed(() => {
  const q = query.value.trim().toLowerCase();
  let rows = overdueRows.value;
  if (q) {
    rows = rows.filter((r) =>
      [r.name, r.email, r.phone, ...r.tags].some((s) => String(s).toLowerCase().includes(q))
    );
  }
  return [...rows].sort((a, b) => {
    // Never contacted = most overdue; among them, oldest contact first.
    if (a.lastDate === null && b.lastDate === null) {
      return (a.added ?? Infinity) - (b.added ?? Infinity);
    }
    if (a.lastDate === null) return -1;
    if (b.lastDate === null) return 1;
    return a.lastDate - b.lastDate;
  });
});

const neverCount = computed(() => overdueRows.value.filter((r) => r.lastDate === null).length);

const emptyMessage = computed(() => {
  if (!allRows.value.length) {
    return { title: "No contacts found", message: "This location has no contacts yet." };
  }
  if (query.value.trim() && overdueRows.value.length) {
    return { title: "No matches", message: "No overdue contacts match your filter." };
  }
  return {
    title: "Everyone is in touch",
    message: `Every contact has had a conversation in the last ${days.value} days.`,
  };
});
</script>

<template>
  <div class="page">
    <div>
      <h1>No-Contact Radar<template v-if="LOCATION_NAME"> · {{ LOCATION_NAME }}</template></h1>
      <p class="lead">Find contacts you haven't talked to in a while.</p>
    </div>

    <ControlsBar
      v-model:days="days"
      v-model:includeNever="includeNever"
      v-model:query="query"
      :options="OPTIONS"
    />

    <p class="lead small">
      Based on the contacts and conversations loaded so far (the latest 100 of each to start with).
    </p>

    <StatusBlock
      v-if="contactsPager.error.value"
      kind="error"
      title="Couldn't load contacts"
      :message="contactsPager.error.value.message"
      @retry="contactsPager.reset()"
    />
    <StatusBlock
      v-if="convPager.error.value"
      kind="error"
      title="Couldn't load conversations"
      :message="convPager.error.value.message"
      @retry="convPager.reset()"
    />

    <StatusBlock
      v-if="loadingFirst"
      kind="loading"
      title="Scanning your contacts…"
    />

    <template v-else-if="!contactsPager.error.value && !convPager.error.value">
      <StatusBlock
        v-if="!visibleRows.length"
        kind="empty"
        :title="emptyMessage.title"
        :message="emptyMessage.message"
      />
      <el-card v-else shadow="never">
        <template #header>
          <strong>{{ visibleRows.length }}</strong>
          {{ visibleRows.length === 1 ? "contact" : "contacts" }} to reach out to
          <span class="lead small">
            · {{ neverCount }} never contacted · {{ allRows.length }} contacts loaded
          </span>
        </template>
        <ContactsTable :rows="visibleRows" />
      </el-card>

      <el-card shadow="never">
        <div class="loaders">
          <LoadMoreBar
            noun="contacts"
            :loaded="contacts.length"
            :total="contactsPager.total.value"
            :has-more="contactsPager.hasMore.value"
            :loading="contactsPager.loading.value"
            @more="contactsPager.loadMore()"
          />
          <LoadMoreBar
            noun="conversations"
            :loaded="conversations.length"
            :total="convPager.total.value"
            :has-more="convPager.hasMore.value"
            :loading="convPager.loading.value"
            @more="convPager.loadMore()"
          />
        </div>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 600;
}
.lead {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.small {
  font-size: 13px;
}
.loaders {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
