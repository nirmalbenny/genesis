<template>
  <div class="card search">
    <h2 class="card-title">
      Contacts
      <span v-if="total !== null" class="count">{{ total }}</span>
    </h2>

    <input
      v-model="query"
      class="input"
      type="search"
      placeholder="Search by name, email or phone"
      aria-label="Search contacts"
    />
    <p v-if="hint" class="hint muted">{{ hint }}</p>
    <p v-else class="hint muted">{{ effective ? `Results for “${effective}”` : "20 newest contacts" }}</p>

    <StateBlock
      :loading="loading"
      :error="error"
      :empty="!contacts.length"
      :empty-text="effective ? `No contacts match “${effective}”.` : 'No contacts found in this location yet.'"
      loading-text="Loading contacts…"
      @retry="load(true)"
    >
      <ul class="list">
        <li v-for="c in contacts" :key="c.id">
          <button
            class="item"
            :class="{ active: c.id === modelValue }"
            @click="pick(c.id)"
          >
            <span class="avatar">{{ initials(c) }}</span>
            <span class="info">
              <span class="name">{{ displayName(c) }}</span>
              <span class="sub">{{ c.email || c.phone || "No email or phone" }}</span>
            </span>
          </button>
        </li>
      </ul>

      <div v-if="moreError" class="more-error">{{ moreError }}</div>
      <button v-if="hasMore" class="btn ghost more" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? "Loading…" : moreError ? "Retry" : "Load more" }}
      </button>
    </StateBlock>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { hl, LOCATION_ID } from "../api.js";
import { displayName, initials } from "../utils.js";
import StateBlock from "./StateBlock.vue";

const props = defineProps({ modelValue: { type: String, default: null } });
const emit = defineEmits(["update:modelValue", "picked"]);

const PAGE = 20;
const query = ref("");
const contacts = ref([]);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref("");
const moreError = ref("");
const total = ref(null);
const cursor = ref(null);
const hasMore = ref(false);

let reqId = 0;
let timer = null;

const trimmed = computed(() => query.value.trim());
const effective = computed(() => (trimmed.value.length >= 3 ? trimmed.value : ""));
const hint = computed(() =>
  trimmed.value.length > 0 && trimmed.value.length < 3
    ? "Type at least 3 characters to search."
    : ""
);

function buildParams() {
  const p = { locationId: LOCATION_ID, limit: PAGE };
  if (effective.value) p.query = effective.value;
  else {
    p.sortBy = "date_added";
    p.order = "desc";
  }
  return p;
}

function readMeta(data, list) {
  const meta = data.meta || {};
  total.value = typeof meta.total === "number" ? meta.total : null;
  cursor.value = meta.startAfterId ? { id: meta.startAfterId, ts: meta.startAfter } : null;
  hasMore.value = !!cursor.value && list.length >= PAGE;
}

async function load(reset) {
  const id = ++reqId;
  loading.value = true;
  error.value = "";
  moreError.value = "";
  if (reset) contacts.value = [];
  try {
    const data = await hl("/contacts/", buildParams());
    if (id !== reqId) return;
    const list = Array.isArray(data.contacts) ? data.contacts : [];
    contacts.value = list;
    readMeta(data, list);
    if (!props.modelValue && list.length) emit("update:modelValue", list[0].id);
  } catch (e) {
    if (id !== reqId) return;
    error.value = e.message;
  } finally {
    if (id === reqId) loading.value = false;
  }
}

async function loadMore() {
  if (!cursor.value || loadingMore.value) return;
  const id = reqId;
  loadingMore.value = true;
  moreError.value = "";
  try {
    const params = buildParams();
    params.startAfterId = cursor.value.id;
    if (cursor.value.ts) params.startAfter = cursor.value.ts;
    const data = await hl("/contacts/", params);
    if (id !== reqId) return;
    const list = Array.isArray(data.contacts) ? data.contacts : [];
    const seen = new Set(contacts.value.map((c) => c.id));
    contacts.value = contacts.value.concat(list.filter((c) => !seen.has(c.id)));
    readMeta(data, list);
  } catch (e) {
    if (id !== reqId) return;
    moreError.value = e.message;
  } finally {
    loadingMore.value = false;
  }
}

function pick(id) {
  emit("update:modelValue", id);
  emit("picked", id);
}

watch(effective, () => {
  clearTimeout(timer);
  timer = setTimeout(() => load(true), 350);
});

onMounted(() => load(true));
onBeforeUnmount(() => clearTimeout(timer));
</script>

<style scoped>
.input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--navy);
  background: #fff;
  outline: none;
}

.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.hint {
  margin: 8px 0 8px;
  font-size: 0.8rem;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 60vh;
  overflow-y: auto;
}

.item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  background: #fff;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
  color: var(--navy);
}

.item:hover {
  background: var(--bg);
}

.item.active {
  background: var(--accent-soft);
  border-color: var(--accent);
}

.avatar {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item.active .avatar {
  background: var(--accent);
  color: #fff;
}

.info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  font-size: 0.85rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more {
  width: 100%;
  margin-top: 10px;
}

.more-error {
  margin-top: 10px;
  color: #b3261e;
  font-size: 0.85rem;
  word-break: break-word;
}
</style>