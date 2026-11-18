import { ref } from "vue";
import { hlGet, LOCATION_ID } from "./genesis/hl.js";

const DAY = 24 * 60 * 60 * 1000;

// Appointments in the next 30 days, across all active calendars.
export function useAppointments() {
  const events = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const loaded = ref(false);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const calData = await hlGet("/calendars/", { locationId: LOCATION_ID });
      const calendars = (Array.isArray(calData && calData.calendars) ? calData.calendars : []).filter(
        (c) => c && c.id && c.isActive !== false
      );
      const now = Date.now();
      const all = [];
      for (const c of calendars) {
        const r = await hlGet("/calendars/events", {
          locationId: LOCATION_ID,
          calendarId: c.id,
          startTime: now,
          endTime: now + 30 * DAY,
        });
        if (r && Array.isArray(r.events)) all.push(...r.events);
      }
      events.value = all;
      loaded.value = true;
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  }

  return { events, loading, error, loaded, load };
}
