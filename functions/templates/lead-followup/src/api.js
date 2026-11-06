import { HL_PROXY, PREVIEW_TOKEN, LOCATION_ID } from "./hl.config.js";

async function hlGet(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const base = String(HL_PROXY || "").replace(/\/+$/, "");
  const url = `${base}${path}${qs.toString() ? "?" + qs.toString() : ""}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${PREVIEW_TOKEN}` },
    });
  } catch (e) {
    throw new Error("Network error: could not reach the HighLevel proxy.");
  }

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }

  if (!res.ok || (body && body.error)) {
    const msg =
      (body && body.error && (body.error.message || body.error)) ||
      `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : "Request failed");
  }
  return body || {};
}

export async function loadContacts() {
  const data = await hlGet("/contacts/", {
    locationId: LOCATION_ID,
    sortBy: "date_added",
    order: "desc",
    limit: 50,
  });
  return Array.isArray(data.contacts) ? data.contacts : [];
}

export async function loadConversations() {
  const data = await hlGet("/conversations/search", {
    locationId: LOCATION_ID,
    limit: 100,
    sortBy: "last_message_date",
    sort: "desc",
  });
  return Array.isArray(data.conversations) ? data.conversations : [];
}

export async function loadAppointments() {
  const calData = await hlGet("/calendars/", { locationId: LOCATION_ID });
  const calendars = (Array.isArray(calData.calendars) ? calData.calendars : []).filter(
    (c) => c && c.id && c.isActive !== false
  );
  const now = Date.now();
  const end = now + 30 * 24 * 60 * 60 * 1000;

  const results = await Promise.all(
    calendars.map((c) =>
      hlGet("/calendars/events", {
        locationId: LOCATION_ID,
        calendarId: c.id,
        startTime: now,
        endTime: end,
      })
    )
  );

  const events = [];
  for (const r of results) {
    if (Array.isArray(r.events)) events.push(...r.events);
  }
  return events;
}
