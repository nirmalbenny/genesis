import { ref, computed } from "vue";
import { hlGet, LOCATION_ID, toDate } from "./genesis/hl.js";
import { dayKey, fmtDay } from "./utils.js";

export const DAYS = 14;

export function useAppointments() {
  const calendars = ref([]);
  const events = ref([]);
  const loading = ref(false);
  const error = ref("");
  const warning = ref("");
  const calendarFilter = ref("all");

  const calendarNames = computed(() => {
    const map = {};
    for (const c of calendars.value) map[c.id] = c.name || "Untitled calendar";
    return map;
  });

  const filtered = computed(() =>
    calendarFilter.value === "all"
      ? events.value
      : events.value.filter((e) => e.calendarId === calendarFilter.value)
  );

  const groups = computed(() => {
    const map = new Map();
    for (const ev of filtered.value) {
      const d = toDate(ev.startTime);
      const key = dayKey(d);
      if (!map.has(key)) map.set(key, { key, label: fmtDay(d), items: [] });
      map.get(key).items.push(ev);
    }
    return [...map.values()];
  });

  async function load() {
    loading.value = true;
    error.value = "";
    warning.value = "";
    events.value = [];
    try {
      const cal = await hlGet("/calendars/", { locationId: LOCATION_ID });
      calendars.value = Array.isArray(cal.calendars) ? cal.calendars : [];
      if (!calendars.value.length) return;

      const start = Date.now();
      const end = start + DAYS * 24 * 60 * 60 * 1000;
      const results = await Promise.allSettled(
        calendars.value.map((c) =>
          hlGet("/calendars/events", {
            locationId: LOCATION_ID,
            calendarId: c.id,
            startTime: start,
            endTime: end,
          })
        )
      );

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length === results.length) throw failures[0].reason;
      if (failures.length) {
        warning.value = `Some calendars could not be loaded: ${failures[0].reason?.message || "unknown error"}`;
      }

      const seen = new Set();
      const merged = [];
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        const list = Array.isArray(r.value.events) ? r.value.events : [];
        for (const ev of list) {
          if (!ev || !ev.id || seen.has(ev.id)) continue;
          seen.add(ev.id);
          merged.push({ ...ev, calendarId: ev.calendarId || calendars.value[i].id });
        }
      });
      merged.sort((a, b) => {
        const ta = toDate(a.startTime)?.getTime() ?? Infinity;
        const tb = toDate(b.startTime)?.getTime() ?? Infinity;
        return ta - tb;
      });
      events.value = merged;
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  return { calendars, events, loading, error, warning, calendarFilter, calendarNames, filtered, groups, load };
}
