<template>
  <el-card shadow="never">
    <StateBlock
      :loading="loading"
      :error="error"
      :empty="!contact"
      empty-text="This contact could not be found."
      loading-text="Loading profile…"
      @retry="load"
    >
      <div v-if="contact" class="head">
        <el-avatar :size="56">{{ initials(contact) }}</el-avatar>
        <div class="title">
          <h2>{{ contactName(contact) }}</h2>
          <div v-if="contact.companyName" class="muted">{{ contact.companyName }}</div>
        </div>
      </div>

      <el-descriptions v-if="contact" :column="isPhone ? 1 : 2" border>
        <el-descriptions-item label="Email">{{ contact.email || "—" }}</el-descriptions-item>
        <el-descriptions-item label="Phone">{{ contact.phone || "—" }}</el-descriptions-item>
        <el-descriptions-item label="Source">{{ contact.source || "—" }}</el-descriptions-item>
        <el-descriptions-item label="Date added">{{ fmtDate(contact.dateAdded) }}</el-descriptions-item>
        <el-descriptions-item label="Address" :span="isPhone ? 1 : 2">{{ address || "—" }}</el-descriptions-item>
        <el-descriptions-item label="Tags" :span="isPhone ? 1 : 2">
          <div v-if="tags.length" class="tags">
            <el-tag v-for="t in tags" :key="t" size="small">{{ t }}</el-tag>
          </div>
          <span v-else>—</span>
        </el-descriptions-item>
      </el-descriptions>
    </StateBlock>
  </el-card>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { call, contactName } from "../genesis/hl.js";
import { initials, fmtDate, useIsPhone } from "../utils.js";
import StateBlock from "./StateBlock.vue";

const props = defineProps({ contactId: { type: String, required: true } });

const isPhone = useIsPhone();
const contact = ref(null);
const loading = ref(false);
const error = ref("");
let reqId = 0;

const tags = computed(() =>
  Array.isArray(contact.value && contact.value.tags) ? contact.value.tags.filter(Boolean).map(String) : []
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
    const data = await call("getContact", { contactId: props.contactId });
    if (id !== reqId) return;
    contact.value = (data && (data.contact || data)) || null;
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
  margin-bottom: 16px;
}
.title {
  min-width: 0;
}
.title h2 {
  margin: 0;
  font-size: 20px;
  word-break: break-word;
}
.muted {
  color: var(--el-text-color-secondary);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
