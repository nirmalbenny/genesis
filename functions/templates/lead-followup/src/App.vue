<script setup>
import { reactive, computed, onMounted, ref } from "vue";
import { loadContacts, loadConversations, loadAppointments } from "./api.js";
import { contactDisplayName, parseDate } from "./utils.js";
import BoardColumn from "./components/BoardColumn.vue";
import SourceStatus from "./components/SourceStatus.vue";

const loaders = {
  contacts: loadContacts,
  conversations: loadConversations,
  appointments: loadAppointments,
};

const sources = reactive({
  contacts: { key: "contacts", label: "Contacts (50 newest)", status: "idle", error: "", data: [] },
  conversations: { key: "conversations", label: "Conversations (up to 100)", status: "idle", error: "", data: [] },
  appointments: { key: "appointments", label: "Appointments (next 30 days)", status: "idle", error: "", data: [] },
});

const search = ref("");

async function run(key) {
  const s = sources[key];
  s.status = "loading";
  s.error = "";
  try {
    s.data = await loaders[key]();
    s.status = "ready";
  } catch (e) {
    s.error = (e && e.message) || "Something went wrong.";
    s.status = "error";
  }
}

function loadAll() {
  return Promise.all(Object.keys(loaders).map(run));
}

onMounted(loadAll);

const sourceList = computed(() => Object.values(sources));
const allReady = computed(() => sourceList.value.every((s) => s.status === "ready"));
const anyLoading = computed(() => sourceList.value.some((s) => s.status === "loading" || s.status === "idle"));

const cards = computed(() => {
  if (!allReady.value) return [];

  const convByContact = new Map();
  for (const conv of sources.conversations.data) {
    if (!conv || !conv.contactId) continue;
    const existing = convByContact.get(conv.contactId);
    if (!existing) {
      convByContact.set(conv.contactId, { latest: conv, unread: Number(conv.unreadCount) || 0 });
    } else {
      existing.unread += Number(conv.unreadCount) || 0;
      const a = parseDate(conv.lastMessageDate);
      const b = parseDate(existing.latest.lastMessageDate);
      if (a && (!b || a > b)) existing.latest = conv;
    }
  }

  const now = Date.now();
  const apptByContact = new Map();
  for (const ev of sources.appointments.data) {
    if (!ev || !ev.contactId) continue;
    const status = String(ev.appointmentStatus || "").toLowerCase();
    if (status === "cancelled" || status === "canceled") continue;
    const start = parseDate(ev.startTime);
    if (!start || start.getTime() < now) continue;
    const existing = apptByContact.get(ev.contactId);
    if (!existing || start < parseDate(existing.startTime)) apptByContact.set(ev.contactId, ev);
  }

  return sources.contacts.data
    .filter((c) => c && c.id)
    .map((c) => {
      const conv = convByContact.get(c.id);
      const appt = apptByContact.get(c.id);
      const column = appt ? "booked" : conv ? "conversation" : "first";
      return {
        id: c.id,
        name: contactDisplayName(c),
        email: c.email || "",
        phone: c.phone || "",
        source: c.source || "Unknown",
        tags: Array.isArray(c.tags) ? c.tags.filter(Boolean) : [],
        dateAdded: c.dateAdded,
        column,
        appointment: appt || null,
        lastMessageBody: conv ? conv.latest.lastMessageBody : "",
        lastMessageDate: conv ? conv.latest.lastMessageDate : null,
        unread: conv ? conv.unread : 0,
      };
    });
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return cards.value;
  return cards.value.filter((c) =>
    [c.name, c.email, c.phone, c.source, c.lastMessageBody, c.appointment && c.appointment.title, ...c.tags]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q))
  );
});

const first = computed(() => filtered.value.filter((c) => c.column === "first"));
const conversation = computed(() => filtered.value.filter((c) => c.column === "conversation"));
const booked = computed(() =>
  filtered.value
    .filter((c) => c.column === "booked")
    .sort((a, b) => parseDate(a.appointment.startTime) - parseDate(b.appointment.startTime))
);
const filtering = computed(() => search.value.trim().length > 0);
</script>

<template>
  <div class="page">
    <header class="top">
      <div>
        <h1>Lead Follow-up Board</h1>
        <p class="note">Based on the 50 newest leads</p>
      </div>
      <div class="tools">
        <input
          v-model="search"
          class="search"
          type="search"
          placeholder="Search name, tag, source, message…"
          aria-label="Search leads"
        />
        <button class="btn" type="button" :disabled="anyLoading" @click="loadAll">
          {{ anyLoading ? "Loading…" : "Refresh" }}
        </button>
      </div>
    </header>

    <SourceStatus v-if="!allReady" :sources="sourceList" @retry="run" />

    <section v-else-if="!sources.contacts.data.length" class="empty-state">
      <h2>No leads yet</h2>
      <p>New contacts added to this location will show up here.</p>
    </section>

    <div v-else class="board">
      <BoardColumn
        title="Needs first touch"
        hint="No conversation yet"
        :cards="first"
        :filtering="filtering"
      />
      <BoardColumn
        title="In conversation"
        hint="Talking, nothing booked"
        :cards="conversation"
        :filtering="filtering"
      />
      <BoardColumn
        title="Booked"
        hint="Upcoming appointment in the next 30 days"
        :cards="booked"
        :filtering="filtering"
      />
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f5f8fa;
  color: #213343;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  padding: 32px 24px 48px;
  box-sizing: border-box;
}
.top {
  max-width: 1200px;
  margin: 0 auto 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
  align-items: flex-end;
  justify-content: space-between;
}
h1 {
  margin: 0;
  font-size: 26px;
}
.note {
  margin: 4px 0 0;
  color: #516f90;
  font-size: 14px;
}
.tools {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  flex: 1 1 320px;
  justify-content: flex-end;
}
.search {
  flex: 1 1 220px;
  max-width: 360px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #dfe3eb;
  border-radius: 8px;
  font: inherit;
  color: #213343;
  background: #fff;
}
.search:focus {
  outline: 2px solid #ff5c35;
  outline-offset: -1px;
}
.btn {
  background: #ff5c35;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: #e84f2b;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.board {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  align-items: start;
}
.empty-state {
  max-width: 640px;
  margin: 0 auto;
  background: #fff;
  border: 1px solid #dfe3eb;
  border-radius: 10px;
  padding: 40px 24px;
  text-align: center;
}
.empty-state h2 {
  margin: 0 0 8px;
}
.empty-state p {
  margin: 0;
  color: #516f90;
}
@media (max-width: 900px) {
  .board {
    grid-template-columns: minmax(0, 1fr);
  }
  .tools {
    justify-content: flex-start;
  }
  .search {
    max-width: none;
  }
}
@media (max-width: 480px) {
  .page {
    padding: 20px 12px 32px;
  }
  h1 {
    font-size: 22px;
  }
}
</style>
