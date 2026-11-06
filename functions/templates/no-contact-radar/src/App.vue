<script setup>
import { ref, computed, onMounted } from "vue";
import { fetchContacts, fetchConversations } from "./api.js";
import { parseDate, contactDisplayName, daysSince, DAY_MS } from "./utils.js";
import ControlsBar from "./components/ControlsBar.vue";
import ContactRow from "./components/ContactRow.vue";
import StatusBlock from "./components/StatusBlock.vue";

const OPTIONS = [7, 14, 30, 90];

const days = ref(30);
const includeNever = ref(true);
const query = ref("");
const now = ref(Date.now());

const contacts = ref([]);
const contactsState = ref("loading"); // loading | ready | error
const contactsError = ref("");

const conversations = ref([]);
const convState = ref("loading");
const convError = ref("");

async function loadContacts() {
  contactsState.value = "loading";
  contactsError.value = "";
  try {
    contacts.value = await fetchContacts();
    now.value = Date.now();
    contactsState.value = "ready";
  } catch (e) {
    contactsError.value = (e && e.message) || "Something went wrong.";
    contactsState.value = "error";
  }
}

async function loadConversations() {
  convState.value = "loading";
  convError.value = "";
  try {
    conversations.value = await fetchConversations();
    now.value = Date.now();
    convState.value = "ready";
  } catch (e) {
    convError.value = (e && e.message) || "Something went wrong.";
    convState.value = "error";
  }
}

onMounted(() => {
  loadContacts();
  loadConversations();
});

const ready = computed(() => contactsState.value === "ready" && convState.value === "ready");

// contactId -> latest lastMessageDate (ms)
const lastByContact = computed(() => {
  const map = new Map();
  for (const conv of conversations.value) {
    if (!conv || !conv.contactId) continue;
    const ts = parseDate(conv.lastMessageDate);
    if (ts === null) continue;
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
        name: contactDisplayName(c),
        email: c.email || "",
        phone: c.phone || "",
        tags: Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === "string") : [],
        added: parseDate(c.dateAdded),
        lastDate,
        days: daysSince(lastDate, now.value),
      };
    })
);

const overdueRows = computed(() => {
  const cutoff = days.value;
  return allRows.value.filter((r) =>
    r.lastDate === null ? includeNever.value : r.days >= cutoff
  );
});

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
  <main class="page">
    <div class="wrap">
      <header class="head">
        <h1>No-Contact Radar</h1>
        <p class="lead">Find contacts you haven't talked to in a while.</p>
      </header>

      <ControlsBar
        v-model:days="days"
        v-model:includeNever="includeNever"
        v-model:query="query"
        :options="OPTIONS"
      />

      <p class="note">Based on the latest 100 contacts and conversations</p>

      <StatusBlock
        v-if="contactsState === 'error'"
        kind="error"
        title="Couldn't load contacts"
        :message="contactsError"
        @retry="loadContacts"
      />
      <StatusBlock
        v-if="convState === 'error'"
        kind="error"
        title="Couldn't load conversations"
        :message="convError"
        @retry="loadConversations"
      />

      <StatusBlock
        v-if="
          contactsState !== 'error' &&
          convState !== 'error' &&
          (contactsState === 'loading' || convState === 'loading')
        "
        kind="loading"
        title="Scanning your contacts…"
        message="Loading contacts and conversations"
      />

      <template v-if="ready">
        <StatusBlock
          v-if="!visibleRows.length"
          kind="empty"
          :title="emptyMessage.title"
          :message="emptyMessage.message"
        />
        <section v-else class="card">
          <div class="summary">
            <strong>{{ visibleRows.length }}</strong>
            {{ visibleRows.length === 1 ? "contact" : "contacts" }} to reach out to
            <span class="muted">
              · {{ neverCount }} never contacted · {{ allRows.length }} contacts loaded
            </span>
          </div>
          <ul class="list">
            <ContactRow v-for="r in visibleRows" :key="r.id" :row="r" />
          </ul>
        </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f5f8fa;
  color: #213343;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  padding: 32px 16px 48px;
  box-sizing: border-box;
}
.wrap {
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head h1 {
  margin: 0 0 4px;
  font-size: 26px;
}
.lead {
  margin: 0;
  color: #516f90;
}
.note {
  margin: 0;
  font-size: 13px;
  color: #516f90;
}
.card {
  background: #fff;
  border: 1px solid #dfe3eb;
  border-radius: 10px;
  overflow: hidden;
}
.summary {
  padding: 14px 20px;
  border-bottom: 1px solid #dfe3eb;
  background: #fff;
}
.summary strong {
  color: #ff5c35;
}
.muted {
  color: #516f90;
  font-size: 13px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
@media (max-width: 480px) {
  .page {
    padding: 20px 12px 32px;
  }
  .head h1 {
    font-size: 22px;
  }
}
</style>
