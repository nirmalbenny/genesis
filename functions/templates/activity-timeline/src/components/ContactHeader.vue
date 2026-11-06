<script setup>
import { computed } from "vue";
import { avatarColor, contactDisplayName, initials, relative, dayLabel, timeLabel } from "../utils.js";

const props = defineProps({
  contact: { type: Object, required: true },
  /** { messages, appointments, next: Date|null, last: Date|null } once the timeline has loaded. */
  stats: { type: Object, default: null },
});
const name = computed(() => contactDisplayName(props.contact));
const tags = computed(() => (Array.isArray(props.contact.tags) ? props.contact.tags.filter((t) => t !== "genesis-demo") : []));
const place = computed(() => [props.contact.address1, props.contact.city].filter(Boolean).join(", "));
</script>

<template>
  <section class="profile">
    <div class="who">
      <span class="avatar" :style="{ background: avatarColor(name) }">{{ initials(name) }}</span>
      <div class="id">
        <h2>{{ name }}</h2>
        <p class="sub">
          <span v-if="contact.companyName">{{ contact.companyName }}</span>
          <span v-if="place">{{ place }}</span>
          <span v-if="contact.source">via {{ contact.source }}</span>
        </p>
        <div class="contact-links">
          <a v-if="contact.email" :href="`mailto:${contact.email}`" class="pill">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
            {{ contact.email }}
          </a>
          <a v-if="contact.phone" :href="`tel:${contact.phone}`" class="pill">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
            {{ contact.phone }}
          </a>
        </div>
        <div v-if="tags.length" class="tags">
          <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
        </div>
      </div>
    </div>

    <dl class="stats">
      <div>
        <dt>Messages</dt>
        <dd>{{ stats ? stats.messages : "–" }}</dd>
      </div>
      <div>
        <dt>Appointments</dt>
        <dd>{{ stats ? stats.appointments : "–" }}</dd>
      </div>
      <div>
        <dt>Next appointment</dt>
        <dd :class="{ muted: !stats || !stats.next }">
          <template v-if="stats && stats.next">{{ dayLabel(stats.next) }}, {{ timeLabel(stats.next) }}</template>
          <template v-else>None booked</template>
        </dd>
      </div>
      <div>
        <dt>Last activity</dt>
        <dd :class="{ muted: !stats || !stats.last }">{{ stats && stats.last ? relative(stats.last) : "No activity" }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.profile {
  background: #fff;
  border: 1px solid #dfe3eb;
  border-radius: 12px;
  overflow: hidden;
}
.who {
  display: flex;
  gap: 16px;
  padding: 20px;
}
.avatar {
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
}
.id {
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.25;
}
.sub {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 4px 0 0;
  color: #516f90;
  font-size: 14px;
}
.sub span + span::before {
  content: "·";
  margin-right: 12px;
  color: #b0c1d4;
}
.contact-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid #dfe3eb;
  border-radius: 999px;
  font-size: 13px;
  color: #213343;
  text-decoration: none;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill:hover {
  border-color: #ff5c35;
  color: #ff5c35;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.tag {
  padding: 2px 8px;
  border-radius: 4px;
  background: #eef3f7;
  color: #33475b;
  font-size: 12px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  border-top: 1px solid #dfe3eb;
  background: #fafbfc;
}
.stats div {
  padding: 12px 20px;
  min-width: 0;
}
.stats div + div {
  border-left: 1px solid #dfe3eb;
}
dt {
  font-size: 11px;
  font-weight: 600;
  color: #7c98b6;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
dd {
  margin: 2px 0 0;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
dd.muted {
  color: #7c98b6;
  font-weight: 500;
}
@media (max-width: 640px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stats div:nth-child(3) {
    border-left: 0;
  }
  .stats div:nth-child(n + 3) {
    border-top: 1px solid #dfe3eb;
  }
}
</style>
