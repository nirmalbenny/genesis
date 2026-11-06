<template>
  <div class="card">
    <StateBlock
      :loading="loading"
      :error="error"
      :empty="!contact"
      empty-text="This contact could not be found."
      loading-text="Loading profile…"
      @retry="load"
    >
      <div v-if="contact" class="head">
        <span class="avatar">{{ initials(contact) }}</span>
        <div class="title">
          <h2>{{ displayName(contact) }}</h2>
          <p v-if="contact.companyName" class="muted">{{ contact.companyName }}</p>
        </div>
      </div>

      <dl v-if="contact" class="grid">
        <div>
          <dt>Email</dt>
          <dd>{{ contact.email || "—" }}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{{ contact.phone || "—" }}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{{ contact.source || "—" }}</dd>
        </div>
        <div>
          <dt>Date added</dt>
          <dd>{{ fmtDate(contact.dateAdded) }}</dd>
        </div>
        <div class="wide">
          <dt>Address</dt>
          <dd>{{ address || "—" }}</dd>
        </div>
        <div class="wide">
          <dt>Tags</dt>
          <dd>
            <span v-if="tags.length" class="tags">
              <span v-for="t in tags" :key="t" class="badge tag">{{ t }}</span>
            </span>
            <span v-else>—</span>
          </dd>
        </div>
      </dl>
    </StateBlock>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { hl } from "../api.js";
import { displayName, initials, fmtDate } from "../utils.js";
import StateBlock from "./StateBlock.vue";

const props = defineProps({ contactId: { type: String, required: true } });

const contact = ref(null);
const loading = ref(false);
const error = ref("");
let reqId = 0;

const tags = computed(() =>
  Array.isArray(contact.value && contact.value.tags)
    ? contact.value.tags.filter(Boolean).map(String)
    : []
);

const address = computed(() => {
  const c = contact.value;
  if (!c) return "";
  const line2 = [c.city, c.state, c.postalCode].filter(Boolean).join(", ");
  return [c.address1, line2, c.country].filter(Boolean).join(" · ");
});

async function load() {
  const id = ++reqId;
  loading.value = true;
  error.value = "";
  contact.value = null;
  try {
    const data = await hl(`/contacts/${encodeURIComponent(props.contactId)}`);
    if (id !== reqId) return;
    contact.value = data.contact || null;
  } catch (e) {
    if (id !== reqId) return;
    error.value = e.message;
  } finally {
    if (id === reqId) loading.value = false;
  }
}

watch(() => props.contactId, load, { immediate: true });
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.avatar {
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 1.2rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.title {
  min-width: 0;
}

.title h2 {
  margin: 0;
  font-size: 1.35rem;
  word-break: break-word;
}

.title p {
  margin: 2px 0 0;
}

.grid {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
}

.grid .wide {
  grid-column: 1 / -1;
}

dt {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-bottom: 2px;
}

dd {
  margin: 0;
  word-break: break-word;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
}

@media (max-width: 520px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>