<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { hlGet } from "../api.js";
import { LOCATION_ID } from "../hl.config.js";
import { avatarColor, contactDisplayName, initials } from "../utils.js";
import StatusBlock from "./StatusBlock.vue";

defineProps({ selectedId: { type: String, default: "" } });
const emit = defineEmits(["select", "loaded"]);

const query = ref("");
const contacts = ref([]);
const loading = ref(false);
const error = ref("");

let reqId = 0;
let timer = null;
let lastKey = null;

function effectiveKey() {
  const q = query.value.trim();
  return q.length >= 3 ? q : "";
}

async function load() {
  const id = ++reqId;
  const key = effectiveKey();
  lastKey = key;
  loading.value = true;
  error.value = "";
  try {
    const params = { locationId: LOCATION_ID, limit: 20 };
    if (key) {
      params.query = key;
    } else {
      params.sortBy = "date_added";
      params.order = "desc";
    }
    const data = await hlGet("/contacts/", params);
    if (id !== reqId) return;
    contacts.value = Array.isArray(data.contacts) ? data.contacts : [];
    emit("loaded", contacts.value);
  } catch (e) {
    if (id !== reqId) return;
    contacts.value = [];
    error.value = e.message;
  } finally {
    if (id === reqId) loading.value = false;
  }
}

watch(query, () => {
  clearTimeout(timer);
  if (effectiveKey() === lastKey) return;
  timer = setTimeout(load, 300);
});

onMounted(load);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <aside class="sidebar">
    <div class="search">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input
        id="contact-search"
        v-model="query"
        type="search"
        placeholder="Search contacts"
        aria-label="Search contacts by name, email or phone"
        autocomplete="off"
      />
    </div>
    <p class="hint">
      {{ effectiveKey() ? `Results for “${effectiveKey()}”` : query.trim() ? "Type 3+ characters to search" : "Newest contacts" }}
    </p>

    <StatusBlock v-if="loading" state="loading" message="Loading contacts…" />
    <StatusBlock v-else-if="error" state="error" title="Couldn't load contacts" :message="error" @retry="load" />
    <StatusBlock
      v-else-if="!contacts.length"
      state="empty"
      title="No contacts found"
      :message="effectiveKey() ? 'Try a different search term.' : 'This location has no contacts yet.'"
    />
    <ul v-else class="list">
      <li v-for="c in contacts" :key="c.id">
        <button type="button" class="row" :class="{ active: c.id === selectedId }" @click="emit('select', c)">
          <span class="avatar" :style="{ background: avatarColor(contactDisplayName(c)) }">{{ initials(contactDisplayName(c)) }}</span>
          <span class="info">
            <span class="name">{{ contactDisplayName(c) }}</span>
            <span class="sub">{{ c.companyName || c.email || c.phone || "No email or phone" }}</span>
          </span>
        </button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border-right: 1px solid #dfe3eb;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 16px 0;
  padding: 0 12px;
  height: 40px;
  border: 1px solid #dfe3eb;
  border-radius: 8px;
  color: #516f90;
  background: #f5f8fa;
}
.search:focus-within {
  border-color: #ff5c35;
  box-shadow: 0 0 0 3px rgba(255, 92, 53, 0.15);
  background: #fff;
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: #213343;
  outline: none;
}
.hint {
  margin: 12px 16px 6px;
  font-size: 11px;
  font-weight: 600;
  color: #7c98b6;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0 8px 16px;
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  background: transparent;
  border: 0;
  border-radius: 8px;
  padding: 9px 10px;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.row:hover {
  background: #f5f8fa;
}
.row:focus-visible {
  outline: 2px solid #ff5c35;
  outline-offset: -2px;
}
.row.active {
  background: #fff1ee;
}
.row.active .name {
  color: #ff5c35;
}
.avatar {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
}
.info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  font-size: 12px;
  color: #516f90;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
