<script setup>
import { ref, computed } from "vue";
import { hlGet } from "./api.js";
import { LOCATION_ID } from "./hl.config.js";
import { parseDate } from "./utils.js";
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

function messageChannel(m) {
  const t = m && m.messageType ? String(m.messageType) : "";
  if (!t) return "";
  const s = t.replace(/^TYPE_/i, "").replace(/[_-]+/g, " ").toLowerCase();
  return s.toUpperCase() === s.toUpperCase() && s.length <= 5
    ? s.toUpperCase()
    : s.charAt(0).toUpperCase() + s.slice(1);
}

async function loadTimeline() {
  if (!contact.value) return;
  const id = ++reqId;
  const contactId = contact.value.id;
  loading.value = true;
  error.value = "";
  items.value = [];
  try {
    const messagesPromise = (async () => {
      const convData = await hlGet("/conversations/search", {
        locationId: LOCATION_ID,
        contactId,
        limit: 20,
        sortBy: "last_message_date",
        sort: "desc",
      });
      const convs = (
        Array.isArray(convData.conversations) ? convData.conversations : []
      ).slice(0, 3);
      const results = await Promise.all(
        convs.map((c) =>
          hlGet(`/conversations/${encodeURIComponent(c.id)}/messages`, {
            limit: 20,
          })
        )
      );
      const all = [];
      results.forEach((r) => {
        const list = r && r.messages && r.messages.messages;
        if (Array.isArray(list)) all.push(...list);
      });
      return all;
    })();

    const apptPromise = hlGet(
      `/contacts/${encodeURIComponent(contactId)}/appointments`
    );

    const [messages, apptData] = await Promise.all([messagesPromise, apptPromise]);
    if (id !== reqId) return;

    const merged = [];
    const seen = new Set();
    messages.forEach((m, i) => {
      // Activity entries (e.g. "appointment booked") duplicate the appointment itself.
      if (!m || /^TYPE_ACTIVITY/i.test(String(m.messageType || ""))) return;
      const key = "m-" + (m.id || `idx${i}`);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push({
        id: key,
        type: m.direction === "inbound" ? "inbound" : "outbound",
        date: parseDate(m.dateAdded),
        body: m.body ? String(m.body) : "",
        channel: messageChannel(m),
      });
    });
    const events = Array.isArray(apptData.events) ? apptData.events : [];
    events.forEach((e, i) => {
      if (!e) return;
      merged.push({
        id: "a-" + (e.id || `idx${i}`),
        type: "appointment",
        date: parseDate(e.startTime),
        title: e.title ? String(e.title) : "",
        status: e.appointmentStatus || "",
      });
    });

    merged.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date - a.date;
    });
    items.value = merged;
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
  const appts = items.value.length - msgs;
  return { all: items.value.length, messages: msgs, appointments: appts };
});

const stats = computed(() => {
  if (loading.value || error.value) return null;
  const now = Date.now();
  const appts = items.value.filter((i) => i.type === "appointment");
  const next = appts.filter((a) => a.date && a.date.getTime() > now).sort((a, b) => a.date - b.date)[0];
  const last = items.value.filter((i) => i.date && i.date.getTime() <= now).sort((a, b) => b.date - a.date)[0];
  return { messages: items.value.length - appts.length, appointments: appts.length, next: next?.date ?? null, last: last?.date ?? null };
});

const filtered = computed(() => {
  if (filter.value === "messages")
    return items.value.filter((i) => i.type !== "appointment");
  if (filter.value === "appointments")
    return items.value.filter((i) => i.type === "appointment");
  return items.value;
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div>
        <h1>Activity Timeline</h1>
        <p>Every message and appointment for a contact, in one place.</p>
      </div>
      <button v-if="contact" type="button" class="refresh" :disabled="loading" @click="loadTimeline">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></svg>
        Refresh
      </button>
    </header>

    <div class="layout">
      <ContactPicker class="side" :selected-id="contact ? contact.id : ''" @select="onSelect" @loaded="onContactsLoaded" />

      <main class="main">
        <StatusBlock
          v-if="!contact"
          state="empty"
          title="Select a contact"
          message="Pick someone from the list to see their messages and appointments."
        />

        <template v-else>
          <ContactHeader :contact="contact" :stats="stats" />

          <section class="activity">
            <div class="activity-head">
              <h2>Activity</h2>
              <FilterChips v-if="items.length" v-model="filter" :counts="counts" />
            </div>

            <StatusBlock v-if="loading" state="loading" message="Loading activity…" />
            <StatusBlock v-else-if="error" state="error" title="Couldn't load the timeline" :message="error" @retry="loadTimeline" />
            <StatusBlock
              v-else-if="!items.length"
              state="empty"
              title="No activity yet"
              message="Messages and appointments with this contact will show up here."
            />
            <StatusBlock
              v-else-if="!filtered.length"
              state="empty"
              :title="filter === 'messages' ? 'No messages' : 'No appointments'"
              message="Nothing matches this filter. Try another one."
            />
            <Timeline v-else :items="filtered" />
          </section>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f8fa;
  color: #213343;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  background: #fff;
  border-bottom: 1px solid #dfe3eb;
}
.topbar h1 {
  margin: 0;
  font-size: 18px;
}
.topbar p {
  margin: 0;
  font-size: 13px;
  color: #516f90;
}
.refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid #dfe3eb;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #213343;
  cursor: pointer;
}
.refresh:hover:not(:disabled) {
  border-color: #ff5c35;
  color: #ff5c35;
}
.refresh:disabled {
  opacity: 0.5;
  cursor: default;
}
.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
}
.main {
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px 48px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.main > * {
  flex: none; /* never squash the profile card when the activity list is long */
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
}
.activity-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}
.activity-head h2 {
  margin: 0;
  font-size: 16px;
}
@media (max-width: 760px) {
  .app {
    height: auto;
    min-height: 100vh;
  }
  .layout {
    grid-template-columns: 1fr;
  }
  .side {
    max-height: 300px;
    border-right: 0;
    border-bottom: 1px solid #dfe3eb;
  }
  .main {
    overflow: visible;
    padding: 16px 12px 40px;
  }
}
</style>
