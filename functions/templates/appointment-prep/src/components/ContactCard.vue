<script setup>
import { ref, onMounted, computed } from "vue";
import { hlGet } from "../api.js";
import { fmtDate } from "../utils.js";
import LoadState from "./LoadState.vue";

const props = defineProps({ contactId: { type: String, default: "" } });

const contact = ref(null);
const loading = ref(false);
const error = ref("");

const name = computed(() => {
  const c = contact.value;
  if (!c) return "";
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return full || c.contactName || c.email || "Unnamed contact";
});

const tags = computed(() => (Array.isArray(contact.value?.tags) ? contact.value.tags : []));

async function load() {
  if (!props.contactId) {
    contact.value = null;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const data = await hlGet(`/contacts/${encodeURIComponent(props.contactId)}`);
    contact.value = data.contact || null;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="card">
    <h3>Contact</h3>
    <LoadState
      :loading="loading"
      :error="error"
      :empty="!contact"
      loading-text="Loading contact…"
      empty-title="No contact linked"
      empty-text="This appointment isn't linked to a contact, or the contact could not be found."
      @retry="load"
    >
      <div v-if="contact">
        <p class="name">{{ name }}</p>
        <dl>
          <dt>Email</dt>
          <dd>{{ contact.email || "—" }}</dd>
          <dt>Phone</dt>
          <dd>{{ contact.phone || "—" }}</dd>
          <dt>Company</dt>
          <dd>{{ contact.companyName || "—" }}</dd>
          <dt>Source</dt>
          <dd>{{ contact.source || "—" }}</dd>
          <dt>Date added</dt>
          <dd>{{ fmtDate(contact.dateAdded) }}</dd>
          <dt>Tags</dt>
          <dd>
            <span v-if="tags.length" class="chips">
              <span v-for="t in tags" :key="t" class="chip">{{ t }}</span>
            </span>
            <span v-else>—</span>
          </dd>
        </dl>
      </div>
    </LoadState>
  </section>
</template>

<style scoped>
h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.name {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 700;
}
dl {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 8px 12px;
  margin: 0;
}
dt {
  color: var(--muted);
  font-size: 14px;
}
dd {
  margin: 0;
  word-break: break-word;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
@media (max-width: 420px) {
  dl {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  dd {
    margin-bottom: 8px;
  }
}
</style>