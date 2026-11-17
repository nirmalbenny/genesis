<script setup>
import { computed, onMounted, watch } from "vue";
import SectionCard from "./SectionCard.vue";
import { Avatar, Badge } from "../genesis/ui";
import { hlGet, LOCATION_ID } from "../api.js";
import { useResource } from "../useResource.js";
import { relativeTime, toDate, contactDisplayName } from "../utils.js";

const props = defineProps({ refreshKey: { type: Number, default: 0 } });
const emit = defineEmits(["count"]);

const LIMIT = 20;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchLeads() {
  const res = await hlGet("/contacts/", {
    locationId: LOCATION_ID,
    sortBy: "date_added",
    order: "desc",
    limit: LIMIT,
  });
  const contacts = Array.isArray(res.contacts) ? res.contacts : [];
  const cutoff = Date.now() - WEEK_MS;
  const recent = contacts.filter((c) => {
    const d = toDate(c && c.dateAdded);
    return d && d.getTime() >= cutoff;
  });
  // If every fetched contact is recent, there may be more beyond the first page.
  const maybeMore = contacts.length >= LIMIT && recent.length === contacts.length;
  return { recent, maybeMore };
}

const { data, loading, error, load } = useResource(fetchLeads);
const leads = computed(() => (data.value ? data.value.recent : []));

onMounted(load);
watch(() => props.refreshKey, load);
watch(
  [data, loading, error],
  () => {
    if (loading.value || error.value || !data.value) {
      emit("count", null);
    } else {
      emit("count", data.value.maybeMore ? `${leads.value.length}+` : leads.value.length);
    }
  },
  { immediate: true }
);

function source(c) {
  return (c && (c.source || c.attributionSource?.medium)) || "Unknown source";
}
function tags(c) {
  return Array.isArray(c && c.tags) ? c.tags.filter(Boolean) : [];
}
</script>

<template>
<SectionCard
  title="New leads"
  :loading="loading"
  :error="error"
  :empty="leads.length === 0"
  empty-text="No new leads in the last 7 days."
  empty-icon="🌱"
  :badge="data && data.maybeMore ? leads.length + '+' : leads.length"
  @retry="load"
>
  <ul class="list">
    <li v-for="(c, i) in leads" :key="c.id || i" class="list-item" style="align-items: flex-start">
      <Avatar :name="contactDisplayName(c)" />
      <div class="info">
        <div class="row" style="justify-content: space-between; flex-wrap: nowrap">
          <p class="truncate name">{{ contactDisplayName(c) }}</p>
          <span class="small muted" style="flex: none">{{ relativeTime(c.dateAdded) }}</span>
        </div>
        <p class="truncate small muted">{{ source(c) }}</p>
        <div v-if="tags(c).length" class="row" style="margin-top: 6px; gap: 6px">
          <Badge v-for="t in tags(c).slice(0, 3)" :key="t" variant="secondary">{{ t }}</Badge>
          <Badge v-if="tags(c).length > 3" variant="outline">+{{ tags(c).length - 3 }}</Badge>
        </div>
      </div>
    </li>
  </ul>
</SectionCard>
</template>

<style scoped>
.info {
  flex: 1;
  min-width: 0;
}
.name {
  font-weight: 600;
}
</style>
