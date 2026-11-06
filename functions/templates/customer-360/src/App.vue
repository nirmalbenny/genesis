<template>
  <div class="page">
    <header class="top">
      <h1>Customer <span class="accent">360</span></h1>
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
        <div v-else class="card placeholder muted">
          Select a contact to see their profile, conversations and appointments.
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
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
.page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 28px 20px 48px;
}

.top {
  margin-bottom: 24px;
}

.top h1 {
  margin: 0 0 4px;
  font-size: 1.7rem;
}

.top p {
  margin: 0;
}

.accent {
  color: var(--accent);
}

.layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
  align-items: start;
}

.right {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  scroll-margin-top: 12px;
}

.placeholder {
  text-align: center;
  padding: 48px 20px;
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

@media (max-width: 480px) {
  .page {
    padding: 20px 12px 40px;
  }
}
</style>