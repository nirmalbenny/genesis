<script setup>
import { ref, onMounted, computed } from "vue";
import { getContact, contactName } from "../genesis/hl.js";
import { fmtDate } from "../utils.js";
import LoadState from "./LoadState.vue";

const props = defineProps({ contactId: { type: String, default: "" } });

const contact = ref(null);
const loading = ref(false);
const error = ref("");

const name = computed(() => {
  const c = contact.value;
  if (!c) return "";
  return contactName(c) || c.email || "Unnamed contact";
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
    contact.value = (await getContact(props.contactId)) || null;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <el-card>
    <template #header><span class="head">Contact</span></template>
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
        <div class="who">
          <el-avatar>{{ name.charAt(0).toUpperCase() }}</el-avatar>
          <strong class="name">{{ name }}</strong>
        </div>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="Email">{{ contact.email || "—" }}</el-descriptions-item>
          <el-descriptions-item label="Phone">{{ contact.phone || "—" }}</el-descriptions-item>
          <el-descriptions-item label="Company">{{ contact.companyName || "—" }}</el-descriptions-item>
          <el-descriptions-item label="Source">{{ contact.source || "—" }}</el-descriptions-item>
          <el-descriptions-item label="Date added">{{ fmtDate(contact.dateAdded) }}</el-descriptions-item>
          <el-descriptions-item label="Tags">
            <span v-if="tags.length" class="tags">
              <el-tag v-for="t in tags" :key="t" type="info" size="small">{{ t }}</el-tag>
            </span>
            <span v-else>—</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </LoadState>
  </el-card>
</template>

<style scoped>
.head {
  font-weight: 600;
}
.who {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.name {
  font-size: 18px;
  word-break: break-word;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
