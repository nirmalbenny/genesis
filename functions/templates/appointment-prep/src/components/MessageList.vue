<script setup>
import { ref, onMounted } from "vue";
import { hlGet, LOCATION_ID } from "../genesis/hl.js";
import LoadState from "./LoadState.vue";
import MessageThread from "./MessageThread.vue";

const props = defineProps({ contactId: { type: String, default: "" } });

const conversationId = ref("");
const loading = ref(false);
const error = ref("");

async function load() {
  conversationId.value = "";
  if (!props.contactId) return;
  loading.value = true;
  error.value = "";
  try {
    const conv = await hlGet("/conversations/search", {
      locationId: LOCATION_ID,
      contactId: props.contactId,
      limit: 1,
      sortBy: "last_message_date",
      sort: "desc",
    });
    const latest = Array.isArray(conv.conversations) ? conv.conversations[0] : null;
    conversationId.value = latest && latest.id ? latest.id : "";
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
    <template #header><span class="head">Recent messages</span></template>
    <LoadState
      :loading="loading"
      :error="error"
      :empty="!conversationId"
      loading-text="Loading messages…"
      empty-title="No messages yet"
      empty-text="There is no conversation history with this contact."
      @retry="load"
    >
      <MessageThread :conversation-id="conversationId" />
    </LoadState>
  </el-card>
</template>

<style scoped>
.head {
  font-weight: 600;
}
</style>
