import { contactName, toDate } from "./genesis/hl.js";

// Turns loaded contacts, conversations and appointments into board cards.
export function buildCards(contacts, conversations, events) {
  const convByContact = new Map();
  for (const conv of conversations) {
    if (!conv || !conv.contactId) continue;
    const existing = convByContact.get(conv.contactId);
    if (!existing) {
      convByContact.set(conv.contactId, { latest: conv, unread: Number(conv.unreadCount) || 0 });
    } else {
      existing.unread += Number(conv.unreadCount) || 0;
      const a = toDate(conv.lastMessageDate);
      const b = toDate(existing.latest.lastMessageDate);
      if (a && (!b || a > b)) existing.latest = conv;
    }
  }

  const now = Date.now();
  const apptByContact = new Map();
  for (const ev of events) {
    if (!ev || !ev.contactId) continue;
    const status = String(ev.appointmentStatus || "").toLowerCase();
    if (status === "cancelled" || status === "canceled") continue;
    const start = toDate(ev.startTime);
    if (!start || start.getTime() < now) continue;
    const existing = apptByContact.get(ev.contactId);
    if (!existing || start < toDate(existing.startTime)) apptByContact.set(ev.contactId, ev);
  }

  return contacts
    .filter((c) => c && c.id)
    .map((c) => {
      const conv = convByContact.get(c.id);
      const appt = apptByContact.get(c.id);
      return {
        id: c.id,
        name: contactName(c) || c.email || c.phone || "Unnamed lead",
        email: c.email || "",
        phone: c.phone || "",
        source: c.source || "Unknown",
        tags: Array.isArray(c.tags) ? c.tags.filter(Boolean) : [],
        dateAdded: c.dateAdded,
        column: appt ? "booked" : conv ? "conversation" : "first",
        appointment: appt || null,
        lastMessageBody: conv ? conv.latest.lastMessageBody : "",
        lastMessageDate: conv ? conv.latest.lastMessageDate : null,
        unread: conv ? conv.unread : 0,
      };
    });
}

export function matchesSearch(card, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [card.name, card.email, card.phone, card.source, card.lastMessageBody, card.appointment && card.appointment.title, ...card.tags]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}
