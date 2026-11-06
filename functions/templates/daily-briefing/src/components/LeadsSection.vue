<script setup>
import { computed, onMounted, watch } from "vue";
import SectionCard from "./SectionCard.vue";
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
      <li v-for="(c, i) in leads" :key="c.id || i" class="row">
        <div class="avatar">{{ (contactDisplayName(c).match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase() }}</div>
        <div class="info">
          <div class="top">
            <p class="name">{{ contactDisplayName(c) }}</p>
            <span class="when">{{ relativeTime(c.dateAdded) }}</span>
          </div>
          <p class="source">{{ source(c) }}</p>
          <div v-if="tags(c).length" class="tags">
            <span v-for="t in tags(c).slice(0, 3)" :key="t" class="tag">{{ t }}</span>
            <span v-if="tags(c).length > 3" class="tag more">+{{ tags(c).length - 3 }}</span>
          </div>
        </div>
      </li>
    </ul>
  </SectionCard>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  gap: 12px;
  padding: 12px;
  border: 1px solid #eaeef3;
  border-radius: 8px;
}
.avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #eef1f5;
  color: #213343;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.info {
  flex: 1;
  min-width: 0;
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.name {
  margin: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when {
  flex: none;
  font-size: 12px;
  color: #516f90;
}
.source {
  margin: 2px 0 0;
  font-size: 13px;
  color: #516f90;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.tag {
  font-size: 12px;
  background: #eef1f5;
  color: #516f90;
  border-radius: 999px;
  padding: 2px 10px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag.more {
  background: #fff1ed;
  color: #ff5c35;
}
</style>