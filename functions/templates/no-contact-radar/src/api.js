import { HL_PROXY, PREVIEW_TOKEN, LOCATION_ID } from "./hl.config.js";

async function hlGet(path) {
  const base = String(HL_PROXY || "").replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(base + path, {
      headers: { Authorization: `Bearer ${PREVIEW_TOKEN}` },
    });
  } catch (e) {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const msg = data && data.error && data.error.message;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data || {};
}

export async function fetchContacts() {
  const qs = new URLSearchParams({
    locationId: LOCATION_ID,
    limit: "100",
    sortBy: "date_added",
    order: "desc",
  });
  const data = await hlGet(`/contacts/?${qs.toString()}`);
  return Array.isArray(data.contacts) ? data.contacts : [];
}

export async function fetchConversations() {
  const qs = new URLSearchParams({
    locationId: LOCATION_ID,
    limit: "100",
    sortBy: "last_message_date",
    sort: "desc",
  });
  const data = await hlGet(`/conversations/search?${qs.toString()}`);
  return Array.isArray(data.conversations) ? data.conversations : [];
}
