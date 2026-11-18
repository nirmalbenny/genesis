<template>
  <div class="page">
    <header>
      <h1>Customer 360<template v-if="LOCATION_NAME"> · {{ LOCATION_NAME }}</template></h1>
      <p class="muted">A complete view of each contact: profile, conversations and appointments.</p>
    </header>

    <div class="layout">
      <aside class="left">
        <ContactSearch v-model="selectedId" @picked="onPicked" />
      </aside>

      <section ref="detail" class="right">
        <template v-if="selectedId">
          <ProfileCard :contact-id="selectedId" />
          <ConversationsPanel :contact-id="selectedId" />
          <AppointmentsPanel :contact-id="selectedId" />
        </template>
        <el-card v-else shadow="never">
          <el-empty description="Select a contact to see their profile, conversations and appointments." />
        </el-card>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { LOCATION_NAME } from "./genesis/hl.js";
import ContactSearch from "./components/ContactSearch.vue";
import ProfileCard from "./components/ProfileCard.vue";
import ConversationsPanel from "./components/ConversationsPanel.vue";
import AppointmentsPanel from "./components/AppointmentsPanel.vue";

const selectedId = ref(null);
const detail = ref(null);

function onPicked() {
  if (window.innerWidth < 860) {
    nextTick(() => {
      if (detail.value && detail.value.scrollIntoView) {
        detail.value.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
}
</script>

<style scoped>
h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 600;
}
.muted {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  align-items: start;
  margin-top: 16px;
}
.right {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  scroll-margin-top: 12px;
}
@media (min-width: 860px) {
  .layout {
    grid-template-columns: 340px minmax(0, 1fr);
  }
  .left {
    position: sticky;
    top: 16px;
  }
}
</style>
