import { hlGet, contactAppointments, toDate, LOCATION_ID } from "./genesis/hl.js";

function messageChannel(m) {
  const t = m && m.messageType ? String(m.messageType) : "";
  if (!t) return "";
  const s = t.replace(/^TYPE_/i, "").replace(/[_-]+/g, " ").toLowerCase();
  return s.length <= 5 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1);
}

async function loadMessages(contactId) {
  const convData = await hlGet("/conversations/search", {
    locationId: LOCATION_ID,
    contactId,
    limit: 20,
    sortBy: "last_message_date",
    sort: "desc",
  });
  const convs = (Array.isArray(convData.conversations) ? convData.conversations : []).slice(0, 3);
  const results = [];
  for (const c of convs) {
    results.push(await hlGet(`/conversations/${encodeURIComponent(c.id)}/messages`, { limit: 20 }));
  }
  const all = [];
  results.forEach((r) => {
    const list = r && r.messages && r.messages.messages;
    if (Array.isArray(list)) all.push(...list);
  });
  return all;
}

/** Messages (latest 3 conversations) and appointments of a contact, newest first. */
export async function fetchTimeline(contactId) {
  const [messages, appts] = await Promise.all([loadMessages(contactId), contactAppointments(contactId)]);

  const merged = [];
  const seen = new Set();
  messages.forEach((m, i) => {
    // Activity entries (e.g. "appointment booked") duplicate the appointment itself.
    if (!m || /^TYPE_ACTIVITY/i.test(String(m.messageType || ""))) return;
    const key = "m-" + (m.id || `idx${i}`);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      id: key,
      type: m.direction === "inbound" ? "inbound" : "outbound",
      date: toDate(m.dateAdded),
      body: m.body ? String(m.body) : "",
      channel: messageChannel(m),
    });
  });
  const events = Array.isArray(appts) ? appts : (appts && appts.events) || [];
  events.forEach((e, i) => {
    if (!e) return;
    merged.push({
      id: "a-" + (e.id || `idx${i}`),
      type: "appointment",
      date: e.start || toDate(e.startTime),
      title: e.title ? String(e.title) : "",
      status: e.appointmentStatus || "",
    });
  });

  merged.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date - a.date;
  });
  return merged;
}
